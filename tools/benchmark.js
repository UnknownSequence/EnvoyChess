/*
 * ============================================================================
 *  ENVOY CHESS — BOT BENCHMARK
 * ============================================================================
 *  Plays computer-vs-computer matches between search depths (1 = weak,
 *  2 = medium, 3 = strong) under different rule variants (tools/variants.js)
 *  and reports how often the stronger bot wins.
 *
 *    node tools/benchmark.js --variants chess,current,noSacrifice --pairs 10 --jobs 4
 *
 *  Options
 *    --variants a,b     variants from tools/variants.js     (default chess,current)
 *    --matchups A-B,..  player pairs, scores reported for B  (default d1-d2,d2-d3,d1-d3)
 *                       players: d1..d4 = normal bot searching 1..4 moves deep
 *                                rush1..rush4 = bot that sacrifices material and
 *                                marches its envoy at the enemy king
 *    --pairs N          openings per matchup; each opening is played twice
 *                       with colours swapped                 (default 10)
 *    --jobs N           games in parallel (CPU cores)        (default 2)
 *    --seed N           random seed for openings             (default 1)
 *    --out FILE         append raw results (JSON lines)      (default benchmark-results.jsonl)
 *    --summary FILE     only print the summary of an existing results file
 * ============================================================================
 */
'use strict';
var path = require('path'), fs = require('fs'), cp = require('child_process');
var MAX_PLY = 240;

function args() {
  var a = {}, v = process.argv.slice(2);
  for (var i = 0; i < v.length; i++) if (v[i].startsWith('--')) { a[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; }
  return a;
}

// ---------------------------------------------------------------- one game
function makeRng(seed) { var s = seed >>> 0 || 1; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

function playTask(t) {
  var Ebase = require('../js/engine.js'), AImod = require('../js/ai.js'), V = require('./variants.js');
  var E = Ebase.create(V[t.variant]()), AI = AImod.create(E), RUSH = AImod.create(E);
  var rnd = makeRng(t.seed);
  Math.random = rnd; // deterministic bot noise
  [AI, RUSH].forEach(function (bot) {
    [1, 2, 3, 4].forEach(function (d) { bot.CONFIG.levels['d' + d] = { depth: d, timeMs: 1e9, noise: 15, qDepth: 4 }; });
  });
  // The "rush" bot WANTS to lose material (negative piece value) and loves an envoy near the enemy king.
  RUSH.CONFIG.pieceScale = -60;
  RUSH.CONFIG.envoyNearKingBonus = 70;
  RUSH.CONFIG.mopUpEdge = 0; RUSH.CONFIG.mopUpKing = 0;
  function pick(name) { return name.indexOf('rush') === 0 ? { bot: RUSH, level: 'd' + name.slice(4) } : { bot: AI, level: name }; }
  // random 2-ply opening shared by both games of the pair
  var g0 = new E.Game(), op = [];
  for (var k = 0; k < 2; k++) {
    var ms = g0.legalMoves(), m = ms[Math.floor(rnd() * ms.length)];
    g0.move(m); op.push({ from: m.from, to: m.to, promotion: m.promotion || null, declare: m.declare || null });
  }
  var start = Date.now(), g = new E.Game();
  op.forEach(function (m) { g.move(m); });
  var white = t.white, black = t.black, pw = pick(white), pb = pick(black);
  var lead = [], envoyCaps = { w: 0, b: 0 }, envoyChecks = { w: 0, b: 0 }, firstLead3 = null, run = { c: null, n: 0 };
  while (!g.isOver() && g.moves.length < MAX_PLY) {
    var st = g.state(), seen = {};
    g.states.forEach(function (x) { seen[E.positionKey(x)] = 1; });
    var who = st.turn === 'w' ? pw : pb;
    var mv = g.move(who.bot.chooseMove(st, who.level, seen));
    if (mv.piece[1] === 'e') {
      if (mv.captured) envoyCaps[mv.piece[0]]++;
      if (/[+#]$/.test(mv.san)) envoyChecks[mv.piece[0]]++;
    }
    var ns = g.state(), d = E.strength(ns, 'w') - E.strength(ns, 'b');
    lead.push(d);
    var c = d >= 3 ? 'w' : d <= -3 ? 'b' : null;
    if (c && c === run.c) run.n++; else run = { c: c, n: c ? 1 : 0 };
    if (run.n >= 6 && !firstLead3) firstLead3 = { side: c, ply: g.moves.length };
  }
  var s = g.status(), last = g.moves[g.moves.length - 1];
  return {
    variant: t.variant, white: white, black: black, a: t.a, b: t.b, pair: t.pair,
    result: s.over ? s.result : '1/2-1/2', reason: s.over ? s.reason : 'move cap', plies: g.moves.length,
    envoyMate: s.reason === 'checkmate' && last.piece[1] === 'e',
    finalLead: lead[lead.length - 1] || 0,
    maxW: Math.max.apply(null, [0].concat(lead)), maxB: Math.max.apply(null, [0].concat(lead.map(function (x) { return -x; }))),
    envoyCaps: envoyCaps, envoyChecks: envoyChecks, firstLead3: firstLead3, ms: Date.now() - start
  };
}

// ---------------------------------------------------------------- summary
function elo(p) { if (p <= 0) return -Infinity; if (p >= 1) return Infinity; return -400 * Math.log10(1 / p - 1); }
function pct(x) { return (100 * x).toFixed(0) + '%'; }

function summarize(rows) {
  var groups = {};
  rows.forEach(function (r) {
    var a = r.a || 'd' + Math.min(+r.white.slice(1), +r.black.slice(1)), b = r.b || 'd' + Math.max(+r.white.slice(1), +r.black.slice(1));
    var key = r.variant + '  ' + a + ' vs ' + b;
    (groups[key] = groups[key] || []).push(r);
  });
  var lines = ['', 'variant / matchup (2nd = scored)  games  W-D-L (2nd)   score   Elo gap  envoy-mates  lead>=3 converted  avg plies  envoy caps/game'];
  Object.keys(groups).sort().forEach(function (k) {
    var g = groups[k], w = 0, d = 0, l = 0, em = 0, conv = 0, convN = 0, plies = 0, ecap = 0;
    g.forEach(function (r) {
      var strongWhite = r.b ? r.white === r.b : +r.white.slice(1) > +r.black.slice(1);
      var res = r.result === '1/2-1/2' ? 0.5 : (r.result === '1-0') === strongWhite ? 1 : 0;
      if (res === 1) w++; else if (res === 0) l++; else d++;
      if (r.envoyMate) em++;
      plies += r.plies;
      ecap += r.envoyCaps.w + r.envoyCaps.b;
      if (r.firstLead3) {
        convN++;
        var won = r.result === (r.firstLead3.side === 'w' ? '1-0' : '0-1');
        if (won) conv++;
      }
    });
    var n = g.length, score = (w + d / 2) / n, e = elo(score);
    lines.push((k + '                                   ').slice(0, 34) + ('' + n).padStart(5) + ('  ' + w + '-' + d + '-' + l).padEnd(16) +
      pct(score).padStart(6) + (isFinite(e) ? (e > 0 ? '+' : '') + e.toFixed(0) : (e > 0 ? '+inf' : '-inf')).padStart(10) +
      pct(em / n).padStart(13) + (convN ? pct(conv / convN) + ' of ' + convN : '-').padStart(19) + (plies / n).toFixed(0).padStart(11) + (ecap / n).toFixed(1).padStart(17));
  });
  lines.push('', 'score = points scored by the 2nd player of each matchup (the stronger bot); "lead>=3 converted" = games where one side was 3+ points of',
    'strength ahead for 6 plies in a row, and how often that side went on to win.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- main
if (process.argv[2] === '--worker') {
  process.on('message', function (t) { process.send(playTask(t)); });
} else {
  var a = args();
  if (a.summary) { console.log(summarize(fs.readFileSync(a.summary, 'utf8').trim().split('\n').map(JSON.parse))); process.exit(0); }
  var variants = (a.variants || 'chess,current').split(','), matchups = (a.matchups || 'd1-d2,d2-d3,d1-d3').split(',');
  var pairs = +(a.pairs || 10), jobs = +(a.jobs || 2), seed = +(a.seed || 1), out = a.out || 'benchmark-results.jsonl';
  var V = require('./variants.js');
  variants.forEach(function (v) { if (!V[v]) { console.error('Unknown variant ' + v + '. Known: ' + Object.keys(V).join(', ')); process.exit(1); } });
  var tasks = [];
  for (var p = 0; p < pairs; p++) variants.forEach(function (v) {
    matchups.forEach(function (mu) {
      var d = mu.split('-').map(function (x) { return /^\d+$/.test(x) ? 'd' + x : x; });
      var s = seed * 100003 + p * 7919 + (d[0] + d[1]).split('').reduce(function (h, ch) { return h * 31 + ch.charCodeAt(0) & 0xffff; }, 7);
      tasks.push({ variant: v, a: d[0], b: d[1], white: d[0], black: d[1], seed: s, pair: s });
      tasks.push({ variant: v, a: d[0], b: d[1], white: d[1], black: d[0], seed: s, pair: s });
    });
  });
  var total = tasks.length, done = 0, rows = [], t0 = Date.now();
  console.log('Playing ' + total + ' games on ' + jobs + ' cores...');
  for (var j = 0; j < Math.min(jobs, total); j++) (function () {
    var w = cp.fork(__filename, ['--worker']);
    function next() { var t = tasks.shift(); if (t) w.send(t); else w.kill(); }
    w.on('message', function (r) {
      rows.push(r); fs.appendFileSync(out, JSON.stringify(r) + '\n'); done++;
      if (done % Math.max(1, Math.round(total / 10)) === 0 && done < total) console.log('  ' + done + '/' + total + ' games, ' + ((Date.now() - t0) / 60000).toFixed(1) + ' min');
      if (done === total) console.log(summarize(rows));
      next();
    });
    next();
  })();
}
