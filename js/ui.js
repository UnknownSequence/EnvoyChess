/*
 * ============================================================================
 *  ENVOY CHESS — USER INTERFACE
 * ============================================================================
 *  Draws the board and panels, handles clicks / drags, and asks the engine
 *  for everything rule-related. No chess rules are decided in this file.
 * ============================================================================
 */
(function () {
  'use strict';

  var E = window.EnvoyEngine, R = window.EnvoyRules, P = window.EnvoyPieces, AI = window.EnvoyAI;
  var STORAGE_KEY = 'equalizer-chess-save';
  var sacMode = false;       // clicking one of your pieces sacrifices it
  var COLOR_NAME = { w: 'White', b: 'Black' };
  var MOVE_LETTER = { king: 'K', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', amazon: 'A', centaur: 'N+', dragonHorse: 'B+', dragonKing: 'R+', cardinal: 'NB' };

  // ------------------------------------------------------------------ state
  var settings = { mode: 'local', side: 'w', humanColor: 'w', level: 2, sound: true };
  var game = new E.Game();
  var orientation = 'w';
  var viewPly = null;        // null = live position, otherwise index into game.states
  var selected = -1;         // selected square
  var chosenDecl = null;     // declaration picked this turn (before moving)
  var drag = null;           // {from, x, y, moved, ghost, hover, wasSelected}
  var promo = null;          // {moves}
  var aiToken = 0, aiThinking = false;
  var legalCache = null;

  // ------------------------------------------------------------------ dom
  function $(id) { return document.getElementById(id); }
  var boardEl = $('board'), squaresEl = $('squares'), piecesEl = $('pieces');
  var squareEls = new Array(64);

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function bg(node, piece) { node.style.backgroundImage = P.url(piece); return node; }

  // ------------------------------------------------------------------ helpers
  function liveIndex() { return game.states.length - 1; }
  function viewIndex() { return viewPly === null ? liveIndex() : viewPly; }
  function isLive() { return viewPly === null || viewPly === liveIndex(); }
  function shownState() { return game.states[viewIndex()]; }
  function isHumanTurn() { return settings.mode === 'local' || game.state().turn === settings.humanColor; }
  function colOf(sq) { return orientation === 'w' ? (sq & 7) : 7 - (sq & 7); }
  function rowOf(sq) { return orientation === 'w' ? 7 - (sq >> 3) : (sq >> 3); }
  function movementName(m) { return (R.movementNames[m] || m); }
  function letterFor(info) { return info.pending ? '?' : (MOVE_LETTER[info.movement] || info.movement[0].toUpperCase()); }

  function needsDeclNow() {
    return isLive() && !game.isOver() && isHumanTurn() && E.needsDeclaration(game.state()) && chosenDecl === null;
  }
  function canInteract() {
    return isLive() && !game.isOver() && isHumanTurn() && !promo && !needsDeclNow() && !aiThinking;
  }
  function legalUI() {
    if (!legalCache) {
      var st = game.state(), ms = game.legalMoves();
      if (E.needsDeclaration(st)) ms = ms.filter(function (m) { return m.declare === chosenDecl; });
      legalCache = ms;
    }
    return legalCache;
  }
  function sacrificeFor(sq) {
    return legalUI().filter(function (m) { return m.sacrifice && m.from === sq; })[0] || null;
  }
  function canSacrifice() { return canInteract() && legalUI().some(function (m) { return m.sacrifice; }); }
  function setSacMode(on) {
    sacMode = !!on && canSacrifice();
    selected = -1;
    var b = $('btn-sac');
    if (b) b.classList.toggle('confirm', sacMode);
    if (sacMode) toast('Sacrifice: click one of your pieces to remove it (uses your turn). Click Sacrifice again to cancel.');
    renderSquares();
  }
  function dropMoves() { return canInteract() ? legalUI().filter(function (m) { return m.drop; }) : []; }
  function dropRange(c) { return ((R.envoyDrop && R.envoyDrop.ranks[c]) || []).map(function (r) { return 'a' + r + ' to h' + r; }).join(', '); }
  function dropRankText(c) { return 'rank ' + ((R.envoyDrop && R.envoyDrop.ranks[c]) || []).join(' or '); }
  function destsFrom(sq) {
    var out = [];
    legalUI().forEach(function (m) { if (m.from === sq && !m.sacrifice && out.indexOf(m.to) < 0) out.push(m.to); });
    return out;
  }

  // ------------------------------------------------------------------ board
  function buildSquares() {
    squaresEl.innerHTML = '';
    for (var row = 0; row < 8; row++) {
      for (var col = 0; col < 8; col++) {
        var file = orientation === 'w' ? col : 7 - col;
        var rank = orientation === 'w' ? 7 - row : row;
        var sq = rank * 8 + file;
        var d = el('div', 'sq ' + ((file + rank) % 2 === 0 ? 'dark' : 'light'));
        if (col === 7) d.appendChild(el('span', 'coord rank', String(rank + 1)));
        if (row === 7) d.appendChild(el('span', 'coord file', 'abcdefgh'[file]));
        squaresEl.appendChild(d);
        squareEls[sq] = d;
      }
    }
  }

  function renderSquares() {
    var st = shownState();
    var drops = dropMoves().map(function (m) { return m.to; });
    var dests = drops.length ? drops : (selected >= 0 && canInteract()) ? destsFrom(selected) : [];
    var checkSq = E.inCheck(st, st.turn) ? E.findKing(st, st.turn) : -1;
    for (var sq = 0; sq < 64; sq++) {
      var c = squareEls[sq].classList;
      c.toggle('last', !!st.lastMove && (st.lastMove.from === sq || st.lastMove.to === sq));
      c.toggle('selected', sq === selected);
      c.toggle('check', sq === checkSq);
      c.toggle('dest', dests.indexOf(sq) >= 0);
      c.toggle('occupied', !!st.board[sq]);
      c.toggle('hover', !!drag && drag.moved && drag.hover === sq);
      c.toggle('sac', sacMode && !!sacrificeFor(sq));
    }
    boardEl.classList.toggle('can-move', canInteract());
  }

  function renderPieces(anim) {
    var st = shownState(), map = {};
    piecesEl.innerHTML = '';
    for (var sq = 0; sq < 64; sq++) {
      var p = st.board[sq];
      if (!p) continue;
      var d = bg(el('div', 'piece'), p);
      d.style.left = colOf(sq) * 12.5 + '%';
      d.style.top = rowOf(sq) * 12.5 + '%';
      if (p[1] === 'e') {
        var info = E.envoyInfo(st, p[0]);
        d.classList.add('envoy');
        var badge = el('span', 'envoy-badge', letterFor(info));
        if (info.pending) badge.classList.add('pending');
        else if (info.canCapture) badge.classList.add('can-capture');
        if (info.cooldown > 0) { d.classList.add('cooling'); d.appendChild(el('span', 'envoy-cool', '⌛')); }
        badge.title = envoyText(st, p[0]).replace(/<[^>]+>/g, '');
        d.appendChild(badge);
      }
      if (drag && drag.moved && drag.from === sq) d.classList.add('ghosted');
      piecesEl.appendChild(d);
      map[sq] = d;
    }
    if (isLive()) dropMoves().forEach(function (m) {
      var g = bg(el('div', 'piece drop-ghost'), m.piece);
      g.style.left = colOf(m.to) * 12.5 + '%';
      g.style.top = rowOf(m.to) * 12.5 + '%';
      piecesEl.appendChild(g);
    });
    if (anim && anim.length) {
      anim.forEach(function (a) {
        var n = map[a.to];
        if (!n) return;
        n.style.transform = 'translate(' + (colOf(a.from) - colOf(a.to)) * 100 + '%,' + (rowOf(a.from) - rowOf(a.to)) * 100 + '%)';
      });
      void piecesEl.offsetWidth;
      requestAnimationFrame(function () {
        anim.forEach(function (a) {
          var n = map[a.to];
          if (n) { n.classList.add('anim'); n.style.transform = ''; }
        });
      });
    }
  }

  function moveAnimation(m, reverse) {
    var list = [{ from: m.from, to: m.to }];
    if (m.castle) {
      var rf = m.castle === 'K' ? m.from + 3 : m.from - 4, rt = m.castle === 'K' ? m.from + 1 : m.from - 1;
      list.push({ from: rf, to: rt });
    }
    if (reverse) list = list.map(function (a) { return { from: a.to, to: a.from }; });
    return list;
  }

  // ------------------------------------------------------------------ panels
  function envoyText(st, c) {
    if (st.inHand && st.inHand[c]) return '<span class="em">In hand</span> · ' + (st.turn === c ? 'place it on ' + dropRankText(c) + ' now' : 'placed on ' + dropRankText(c) + ' as the first move');
    if (!E.hasEnvoy(st, c)) return 'No envoy';
    var info = E.envoyInfo(st, c), parts = [];
    if (info.pending) {
      var opts = info.tier.options.map(movementName).join(' or ');
      if (R.envoy.chooseBy === 'move') parts.push('Moves like a <span class="em">' + opts + '</span> (not chosen yet: a knight jump or long diagonal move decides)');
      else parts.push(st.turn === c ? '<span class="em">Must declare: ' + opts + '</span>'
                               : '<span class="em">Undeclared</span> (checks as ' + info.tier.options.map(movementName).join(' + ') + ')');
    } else {
      parts.push('Moves like a <span class="em">' + movementName(info.movement) + '</span>' +
        (info.tier.movement === 'choice' ? (R.envoy.chooseBy === 'move' ? ' (chosen)' : ' (declared)') : ''));
    }
    if (heldBack(info)) parts.push('<span class="cool">' + (R.envoy.powerCap != null && !info.sacrificed ? 'power capped by its army' : 'own sacrifices don\'t power it') + '</span>');
    parts.push(info.canCapture ? '<span class="cap">can capture</span>' : 'cannot capture');
    if (R.envoy.capturable === 'whenArmed') parts.push(info.canCapture ? '<span class="cap">can be captured</span>' : 'immune');
    if (info.cooldown > 0) parts.push('<span class="cool">' + (st.turn === c ? 'frozen this turn' : 'frozen next turn') + '</span>');
    else if (R.envoy.cooldownTurns > 0 || R.envoy.tiers.some(function (t) { return t.cooldownTurns > 0; })) parts.push('ready');
    return parts.join(' · ');
  }

  /** Is this envoy weaker than the plain "behind by" would make it (own sacrifices / cap)? */
  function heldBack(info) {
    return info.powerDeficit < info.deficit &&
      (E.tierAt(info.deficit) !== info.tier || (info.deficit >= R.envoy.captureMinDeficit && !info.canCapture));
  }

  function playerLabel(c) {
    if (settings.mode === 'ai') return c === settings.humanColor ? 'You' : 'Computer · level ' + settings.level + (settings.level === 4 ? ' (trained)' : '');
    return 'Player';
  }

  function renderPlayer(node, c) {
    var st = shownState(), o = E.opp(c);
    var counts = { w: {}, b: {} };
    st.board.forEach(function (p) { if (p) counts[p[0]][p[1]] = (counts[p[0]][p[1]] || 0) + 1; });
    var mat = '';
    ['q', 'r', 'b', 'n', 'p'].forEach(function (t) {
      var diff = (counts[c][t] || 0) - (counts[o][t] || 0);
      for (var i = 0; i < diff; i++) {
        mat += '<span class="mini' + (i === 0 && mat ? ' gap' : '') + '" style=\'background-image:' + P.url(o + t) + '\'></span>';
      }
    });
    var lead = E.strength(st, c) - E.strength(st, o);
    if (lead > 0) mat += '<span class="score">+' + lead + '</span>';
    var thinking = aiThinking && game.state().turn === c && isLive() ? '<span class="thinking">thinking…</span>' : '';
    node.innerHTML =
      '<div class="player-line"><span class="player-dot ' + c + '"></span><span class="player-name">' + COLOR_NAME[c] +
      '</span><span class="player-tag">' + playerLabel(c) + '</span>' + thinking + '</div>' +
      '<div class="material">' + mat + '</div>' +
      '<div class="envoy-line"><span class="mini" style=\'background-image:' + P.url(c + 'e') + '\'></span><span>' + envoyText(st, c) + '</span></div>';
    node.classList.toggle('active', !game.isOver() && isLive() && game.state().turn === c);
  }

  function rangeText(tiers, i) {
    var lo = tiers[i].minDeficit, hi = i > 0 ? tiers[i - 1].minDeficit - 1 : Infinity;
    if (lo === -Infinity) return hi + ' or less';
    if (hi === Infinity) return lo + '+';
    return lo === hi ? String(lo) : lo + '–' + hi;
  }
  function tierMoveText(t) {
    if (t.movement === 'choice') return t.options.map(movementName).join(' or ') + ' <span style="color:var(--muted)">(' + (R.envoy.chooseBy === 'move' ? 'a knight jump or long diagonal decides' : 'declare') + ')</span>';
    return movementName(t.movement);
  }

  function renderLadder() {
    var st = shownState(), tiers = R.envoy.tiers;
    var sw = E.strength(st, 'w'), sb = E.strength(st, 'b');
    $('str-w').textContent = sw;
    $('str-b').textContent = sb;
    $('sb-fill').style.width = (sw + sb ? (sw / (sw + sb)) * 100 : 50) + '%';
    var tw = E.tierFor(st, 'w'), tb = E.tierFor(st, 'b');
    var html = '<tr><td class="range" style="border-top:0">Behind by</td><td class="mv" style="border-top:0;color:var(--muted)">Envoy moves like</td><td style="border-top:0"></td></tr>';
    tiers.forEach(function (t, i) {
      var who = (t === tw ? '<span class="chip w">W</span>' : '') + (t === tb ? '<span class="chip b">B</span>' : '');
      html += '<tr class="' + (who ? 'on' : '') + '"><td class="range">' + rangeText(tiers, i) + '</td><td class="mv">' +
        tierMoveText(t) + '</td><td class="who">' + who + '</td></tr>';
    });
    $('ladder').innerHTML = html;
  }

  function resultText(s) {
    var who = s.winner ? COLOR_NAME[s.winner] + ' wins' : 'Draw';
    var why = {
      checkmate: 'by checkmate', resignation: COLOR_NAME[E.opp(s.winner || 'w')] + ' resigned', stalemate: 'by stalemate',
      'fifty-move rule': 'by the fifty-move rule', 'threefold repetition': 'by threefold repetition', agreement: 'by agreement'
    }[s.reason] || s.reason;
    if (s.reason === 'resignation') return who + ' · ' + why;
    if (s.reason === 'only king and envoy left') {
      return who + ' · ' + COLOR_NAME[E.opp(s.winner)] + ' has only king and envoy left (sacrificing everything does not work!)';
    }
    return who + ' ' + why;
  }

  function renderMeta() {
    $('meta-sub').textContent = settings.mode === 'ai'
      ? 'Casual · vs Computer (level ' + settings.level + ') · you play ' + COLOR_NAME[settings.humanColor]
      : 'Casual · Two players on this device';
    var s = game.status(), st = game.state(), node = $('meta-status');
    node.className = 'meta-status';
    if (s.over) { node.textContent = resultText(s); node.classList.add('over'); }
    else {
      var txt = COLOR_NAME[st.turn] + ' to move';
      if (settings.mode === 'ai') txt = isHumanTurn() ? 'Your turn' : 'Computer is thinking…';
      if (E.needsDeclaration(st) && chosenDecl === null) txt += ' — declare the envoy first';
      if (st.inHand && st.inHand[st.turn]) txt += ' — place the envoy on ' + dropRankText(st.turn);
      if (s.check) { txt += ' · Check!'; node.classList.add('check'); }
      else if (s.mustCapture) txt += ' · a capture is compulsory';
      node.textContent = txt;
    }
    if (!isLive()) node.textContent += '  (viewing move ' + viewIndex() + ' of ' + liveIndex() + ')';
  }

  function renderMoves() {
    var box = $('moves'), html = '', moves = game.moves, first = game.states[0];
    var cur = viewIndex();
    if (!moves.length) html = '<div class="placeholder">No moves yet. White starts.</div>';
    var offset = first.turn === 'b' ? 1 : 0;
    for (var i = -offset; i < moves.length; i += 2) {
      html += '<div class="idx">' + (first.fullmove + Math.floor((i + offset) / 2)) + '</div>';
      for (var j = i; j < i + 2; j++) {
        if (j < 0 || j >= moves.length) { html += '<div class="mv empty">' + (j < 0 ? '…' : '') + '</div>'; continue; }
        var m = moves[j];
        var decl = m.declare ? '<span class="decl" title="' + (R.envoy.chooseBy === 'move' ? 'Envoy chose ' : 'Declared envoy movement: ') + movementName(m.declare) + '">E=' +
          (MOVE_LETTER[m.declare] || m.declare[0].toUpperCase()) + '</span>' : '';
        html += '<div class="mv' + (cur === j + 1 ? ' active' : '') + '" data-ply="' + (j + 1) + '">' + decl + m.san + '</div>';
      }
    }
    box.innerHTML = html;
    if (isLive()) box.scrollTop = box.scrollHeight;
    else {
      var a = box.querySelector('.active');
      if (a) a.scrollIntoView({ block: 'nearest' });
    }

    var s = game.status(), rb = $('result-box');
    if (s.over) {
      rb.classList.remove('hidden');
      rb.innerHTML = '<div class="score">' + s.result.replace('1/2', '½').replace('1/2', '½') + '</div><div class="why">' + resultText(s) + '</div>' +
        '<button class="btn-primary" id="btn-rematch">Rematch</button> <button class="btn-secondary" id="btn-new2">New game</button>';
      $('btn-rematch').onclick = rematch;
      $('btn-new2').onclick = openNewGame;
    } else rb.classList.add('hidden');

    var humanMoves = settings.mode === 'ai'
      ? moves.some(function (m) { return m.piece[0] === settings.humanColor; }) : moves.length > 0;
    $('btn-takeback').disabled = !humanMoves || aiThinking;
    var sacBtn = $('btn-sac');
    if (sacBtn) {
      sacBtn.disabled = !canSacrifice();
      sacBtn.title = sacBtn.disabled ? 'No sacrifice possible now (in check' + (R.forcedCapture ? ', a capture is compulsory' : '') + ', or not your turn)' : 'Remove one of your own pieces instead of moving (S)';
      if (sacBtn.disabled && sacMode) { sacMode = false; sacBtn.classList.remove('confirm'); }
    }
    $('btn-draw').disabled = s.over || !moves.length;
    $('btn-resign').disabled = s.over;
  }

  function renderDeclaration() {
    var ov = $('decl-overlay');
    if (!needsDeclNow()) { ov.classList.add('hidden'); return; }
    var st = game.state(), info = E.envoyInfo(st, st.turn);
    var btns = info.tier.options.map(function (o) {
      var hint = { knight: 'jumps in an L', bishop: 'slides diagonally', centaur: 'king step or L jump', dragonHorse: 'king step or diagonal slide' }[o] || '';
      var pic = { knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k', centaur: 'n', dragonHorse: 'b', dragonKing: 'r' }[o];
      return '<button data-decl="' + o + '"><span class="pic" style=\'background-image:' + (pic ? P.url(st.turn + pic) : P.url(st.turn + 'e')) +
        '\'></span>' + movementName(o) + '<small>' + hint + '</small></button>';
    }).join('');
    ov.innerHTML = '<div class="decl-box"><h2>' + COLOR_NAME[st.turn] + ' must declare the envoy</h2>' +
      '<p>' + COLOR_NAME[st.turn] + ' is behind by <b>' + info.deficit + '</b>. Choose how your envoy moves while you stay in this range. ' +
      'After declaring you may move the envoy or any other piece.</p><div class="decl-options">' + btns + '</div></div>';
    ov.classList.remove('hidden');
    ov.querySelectorAll('[data-decl]').forEach(function (b) {
      b.onclick = function () {
        chosenDecl = b.getAttribute('data-decl');
        legalCache = null;
        toast(COLOR_NAME[st.turn] + ' declares: envoy moves like a ' + movementName(chosenDecl));
        render();
      };
    });
  }

  function render(anim) {
    renderSquares();
    renderPieces(anim);
    var top = orientation === 'w' ? 'b' : 'w';
    renderPlayer($('player-top'), top);
    renderPlayer($('player-bottom'), E.opp(top));
    renderLadder();
    renderMeta();
    renderMoves();
    renderDeclaration();
    $('btn-sound').textContent = settings.sound ? '🔊' : '🔇';
  }

  // ------------------------------------------------------------------ toasts & sound
  function toast(msg) {
    var t = el('div', 'toast', msg);
    $('toasts').appendChild(t);
    setTimeout(function () { t.classList.add('fade'); }, 2600);
    setTimeout(function () { t.remove(); }, 3100);
  }

  var actx = null;
  function sound(kind) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (kind === 'end' || kind === 'check') {
        var o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime;
        o.frequency.value = kind === 'end' ? 523 : 880;
        g.gain.setValueAtTime(0.12, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
        o.connect(g).connect(actx.destination); o.start(); o.stop(t0 + 0.36);
        if (kind === 'check') return;
      }
      var len = 0.07, buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate), d = buf.getChannelData(0);
      var pow = kind === 'capture' ? 2 : 5;
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, pow);
      var src = actx.createBufferSource(), f = actx.createBiquadFilter(), gn = actx.createGain();
      src.buffer = buf; f.type = 'lowpass'; f.frequency.value = kind === 'capture' ? 2200 : 1300;
      gn.gain.value = kind === 'capture' ? 0.9 : 0.55;
      src.connect(f).connect(gn).connect(actx.destination); src.start();
    } catch (e) { /* sound is optional */ }
  }

  // ------------------------------------------------------------------ making moves
  function envoySnapshot(st) {
    var out = {};
    ['w', 'b'].forEach(function (c) {
      if (!E.hasEnvoy(st, c)) return;
      var i = E.envoyInfo(st, c);
      out[c] = { movement: i.movement, pending: i.pending, canCapture: i.canCapture, deficit: i.deficit, tier: i.tier, capped: heldBack(i), sacrificed: i.sacrificed, strength: i.strength };
    });
    return out;
  }

  function announceEnvoyChanges(before, after) {
    ['w', 'b'].forEach(function (c) {
      var a = before[c], b = after[c];
      if (!a || !b) return;
      if (b.capped && !a.capped) {
        toast(R.envoy.powerCap != null && !b.sacrificed
          ? COLOR_NAME[c] + '\'s envoy is capped by ' + COLOR_NAME[c] + '\'s remaining army (strength ' + b.strength + ').'
          : COLOR_NAME[c] + ' has sacrificed ' + b.sacrificed + ' points. Sacrificed material does not count for ' + COLOR_NAME[c] + '\'s own envoy, so it does not get stronger.');
      } else if (a.tier !== b.tier) {
        var what = b.pending ? (R.envoy.chooseBy === 'move' ? 'may now move like a ' + b.tier.options.map(movementName).join(' or ') + ' (a knight jump or long diagonal move decides)' : 'must now declare ' + b.tier.options.map(movementName).join(' or '))
                             : 'now moves like a ' + movementName(b.movement);
        var why = b.deficit > 0 ? ' (' + COLOR_NAME[c] + ' is ' + b.deficit + ' behind)' : '';
        toast(COLOR_NAME[c] + '\'s envoy ' + what + why);
      } else if (a.canCapture !== b.canCapture) {
        toast(COLOR_NAME[c] + '\'s envoy ' + (b.canCapture ? 'may now capture' : 'can no longer capture'));
      }
    });
  }

  function playMove(m, opts) {
    opts = opts || {};
    var before = envoySnapshot(game.state());
    var done = game.move({ from: m.from, to: m.to, promotion: m.promotion || null, declare: m.declare || null });
    if (!done) return false;
    selected = -1; chosenDecl = null; viewPly = null; legalCache = null; promo = null;
    $('promo').classList.add('hidden');
    sacMode = false;
    if ($('btn-sac')) $('btn-sac').classList.remove('confirm');
    if (done.sacrifice) {
      var foe = E.opp(done.piece[0]), frozen = R.sacrifice.freezeEnemyEnvoy && E.hasEnvoy(game.state(), foe);
      toast(COLOR_NAME[done.piece[0]] + ' sacrificed ' + (done.piece[1] === 'p' ? 'a pawn' : 'the ' + R.pieceNames[done.piece[1]].toLowerCase()) + ' on ' + E.sqName(done.from) +
        (frozen ? '. ' + COLOR_NAME[foe] + '\'s envoy is frozen and cannot move next turn' : ''));
    }
    if (done.declare && R.envoy.chooseBy === 'move') {
      toast(COLOR_NAME[done.piece[0]] + '\'s envoy moved like a ' + movementName(done.declare).toLowerCase() + ' and keeps that movement while the gap stays in this range');
    } else if (done.declare && settings.mode === 'ai' && done.piece[0] !== settings.humanColor) {
      toast('Computer declares: envoy moves like a ' + movementName(done.declare));
    }
    var s = game.status();
    sound(s.over ? 'end' : (done.captured || done.sacrifice) ? 'capture' : 'move');
    if (!s.over && s.check) sound('check');
    render(opts.noAnim ? null : moveAnimation(done));
    announceEnvoyChanges(before, envoySnapshot(game.state()));
    if (s.over) toast(resultText(s));
    else if (R.loseWithOnly && done.captured) {
      var victim = E.opp(done.piece[0]), left = E.spareCount(game.state(), victim);
      if (left === 1) toast('Careful: ' + COLOR_NAME[victim] + ' has one piece left besides king and envoy. Losing it loses the game.');
    }
    save();
    maybeComputerMove();
    return true;
  }

  function tryMove(from, to, opts) {
    var cands = legalUI().filter(function (m) { return m.from === from && m.to === to && !m.sacrifice; });
    if (!cands.length) return false;
    if (cands.length > 1 && cands[0].promotion) { openPromotion(cands); return true; }
    return playMove(cands[0], opts);
  }

  function openPromotion(cands) {
    promo = { moves: cands };
    var box = $('promo'), to = cands[0].to, col = colOf(to), row = rowOf(to), step = row === 0 ? 1 : -1;
    var order = ['q', 'n', 'r', 'b'].filter(function (t) { return R.promotionPieces.indexOf(t) >= 0; });
    R.promotionPieces.forEach(function (t) { if (order.indexOf(t) < 0) order.push(t); });
    box.innerHTML = '';
    order.forEach(function (t, i) {
      var c = bg(el('div', 'choice'), game.state().turn + t);
      c.style.left = col * 12.5 + '%';
      c.style.top = (row + i * step) * 12.5 + '%';
      c.onpointerdown = function (e) {
        e.stopPropagation();
        var m = promo.moves.filter(function (x) { return x.promotion === t; })[0];
        playMove(m, { noAnim: true });
      };
      box.appendChild(c);
    });
    box.onpointerdown = function (e) { e.stopPropagation(); promo = null; box.classList.add('hidden'); render(); };
    box.classList.remove('hidden');
    render();
  }

  // ------------------------------------------------------------------ computer
  function maybeComputerMove() {
    if (settings.mode !== 'ai' || game.isOver() || game.state().turn === settings.humanColor) return;
    var token = ++aiToken;
    aiThinking = true;
    render();
    setTimeout(function () {
      if (token !== aiToken) return;
      var seen = {};
      game.states.forEach(function (st) { seen[E.positionKey(st)] = true; });
      var m = AI.chooseMove(game.state(), settings.level, seen);
      if (token !== aiToken) return;
      aiThinking = false;
      if (m) playMove(m); else render();
    }, 350);
  }
  function cancelComputer() { aiToken++; aiThinking = false; }

  // ------------------------------------------------------------------ pointer input
  function squareAt(x, y) {
    var r = boardEl.getBoundingClientRect();
    var col = Math.floor((x - r.left) / r.width * 8), row = Math.floor((y - r.top) / r.height * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    var file = orientation === 'w' ? col : 7 - col, rank = orientation === 'w' ? 7 - row : row;
    return rank * 8 + file;
  }

  boardEl.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (!canInteract()) return;
    var sq = squareAt(e.clientX, e.clientY);
    if (sq < 0) return;
    var st = game.state(), p = st.board[sq];
    var drops = dropMoves();
    if (drops.length) {
      var dm = drops.filter(function (m) { return m.to === sq; })[0];
      if (dm) playMove(dm, { noAnim: true });
      else toast('First place your envoy: click one of the marked squares on ' + dropRankText(st.turn) + '.');
      return;
    }
    if (sacMode) {
      var sm = sacrificeFor(sq);
      if (sm) playMove(sm, { noAnim: true });
      else toast(p && p[0] === st.turn ? 'That piece cannot be sacrificed (kings and envoys cannot, and it may not expose your king).' : 'Click one of your own pieces to sacrifice it.');
      return;
    }
    if (selected >= 0 && destsFrom(selected).indexOf(sq) >= 0) { tryMove(selected, sq); return; }
    if (p && p[0] === st.turn && !destsFrom(sq).length && game.status().mustCapture) {
      toast('A capture is compulsory: one of your pieces can take a stronger piece.');
    }
    if (p && p[0] === st.turn) {
      var wasSelected = selected === sq;
      selected = sq;
      drag = { from: sq, x: e.clientX, y: e.clientY, moved: false, ghost: null, hover: -1, wasSelected: wasSelected };
      e.preventDefault();
    } else selected = -1;
    renderSquares();
  });

  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 5) return;
      drag.moved = true;
      var size = boardEl.getBoundingClientRect().width / 8;
      drag.ghost = bg(el('div', 'piece dragging'), game.state().board[drag.from]);
      drag.ghost.style.width = drag.ghost.style.height = size + 'px';
      document.body.appendChild(drag.ghost);
      renderPieces();
    }
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    var h = squareAt(e.clientX, e.clientY);
    if (h !== drag.hover) { drag.hover = h; renderSquares(); }
  });

  window.addEventListener('pointerup', function (e) {
    if (!drag) return;
    var d = drag, sq = squareAt(e.clientX, e.clientY);
    drag = null;
    if (d.ghost) d.ghost.remove();
    if (d.moved) {
      if (sq >= 0 && sq !== d.from && destsFrom(d.from).indexOf(sq) >= 0) { if (tryMove(d.from, sq, { noAnim: true })) return; }
      render();
      return;
    }
    if (d.wasSelected && sq === d.from) selected = -1;
    renderSquares();
  });

  // ------------------------------------------------------------------ navigation & actions
  function navigate(where) {
    var cur = viewIndex(), last = liveIndex(), target = cur;
    if (where === 'first') target = 0;
    else if (where === 'prev') target = Math.max(0, cur - 1);
    else if (where === 'next') target = Math.min(last, cur + 1);
    else if (where === 'last') target = last;
    else if (typeof where === 'number') target = where;
    if (target === cur) return;
    var anim = null;
    if (target === cur + 1) anim = moveAnimation(game.moves[cur]);
    else if (target === cur - 1) anim = moveAnimation(game.moves[target], true);
    viewPly = target === last ? null : target;
    selected = -1;
    render(anim);
  }

  function flip() {
    orientation = E.opp(orientation);
    buildSquares();
    render();
    save();
  }

  function takeback() {
    if (!game.moves.length) return;
    cancelComputer();
    if (settings.mode === 'ai') {
      do { game.undo(); } while (game.moves.length && game.state().turn !== settings.humanColor);
    } else game.undo();
    viewPly = null; selected = -1; chosenDecl = null; legalCache = null;
    render();
    save();
    maybeComputerMove();
  }

  function confirmButton(btn, label, action) {
    if (btn.classList.contains('confirm')) {
      btn.classList.remove('confirm'); btn.innerHTML = btn.dataset.label;
      action();
      return;
    }
    btn.dataset.label = btn.innerHTML;
    btn.classList.add('confirm');
    btn.innerHTML = label;
    setTimeout(function () { if (btn.classList.contains('confirm')) { btn.classList.remove('confirm'); btn.innerHTML = btn.dataset.label; } }, 3000);
  }

  $('btn-takeback').onclick = takeback;
  $('btn-sac').onclick = function () { setSacMode(!sacMode); };
  // ---------------------------------------------------------------- play by message (WhatsApp etc.)
  function shareText() {
    var st = game.state(), s = game.status();
    var line = s.over ? 'Envoy Chess game (finished: ' + resultText(s) + ').'
      : 'Envoy Chess: ' + COLOR_NAME[st.turn] + ' to move. Open the game, tap New game and paste this under "Continue a game".';
    return line + '\n' + game.pgn();
  }
  $('btn-pgn').onclick = function () {
    $('share-text').value = shareText();
    $('share-status').textContent = '';
    $('modal-share').classList.remove('hidden');
    copyShare();
  };
  function copyShare() {
    var ta = $('share-text'), text = ta.value;
    function manual() {
      ta.focus(); ta.select();
      $('share-status').textContent = 'Select the text and copy it (Cmd+C, or press and hold on a phone).';
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { $('share-status').textContent = 'Copied. Now paste it into WhatsApp.'; }, manual);
      } else manual();
    } catch (e) { manual(); }
  }
  $('btn-copy-share').onclick = copyShare;

  /** Reads a game written by game.pgn() (also with extra text around it). */
  function parseGameText(text) {
    var i = text.indexOf('[');
    if (i > 0) text = text.slice(i);
    var fen = (/\[FEN "([^"]+)"\]/.exec(text) || [])[1];
    var g;
    try { g = new E.Game(fen || undefined); } catch (e) { return { error: 'The starting position in that text is not valid.' }; }
    var body = text.replace(/\[[^\]]*\]/g, ' ').replace(/\{E=(\w+)\}/g, ' {E=$1} ');
    var tokens = body.split(/\s+/).filter(Boolean), decl = null, n = 0;
    for (var k = 0; k < tokens.length; k++) {
      var tok = tokens[k], dm = /^\{E=(\w+)\}$/.exec(tok);
      if (dm) { decl = dm[1]; continue; }
      if (/^\d+\.+$/.test(tok) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
      tok = tok.replace(/^\d+\.+/, '');
      if (!tok) continue;
      var st = g.state(), legal = g.legalMoves(), want = tok.replace(/[+#!?]+$/, '');
      var cands = legal.filter(function (x) {
        return (R.envoy.chooseBy === 'move' || (x.declare || null) === decl) && (x.castle || want.indexOf(E.sqName(x.sacrifice ? x.from : x.to)) >= 0);
      });
      var m = cands.filter(function (x) { return E.san(st, x, legal).replace(/[+#]$/, '') === want; })[0];
      if (!m) return { error: 'Could not read move ' + (n + 1) + ' ("' + tok + '"). Was the whole message pasted?' };
      g.move(m); decl = null; n++;
    }
    if (!n && !fen) return { error: 'No moves found. Paste the whole message your friend sent.' };
    return { game: g };
  }
  $('btn-load').onclick = function () {
    var r = parseGameText($('paste-pgn').value || '');
    if (r.error) { $('paste-error').textContent = r.error; return; }
    $('paste-error').textContent = '';
    $('paste-pgn').value = '';
    cancelComputer();
    settings.mode = 'local';
    game = r.game;
    viewPly = null; selected = -1; chosenDecl = null; legalCache = null; promo = null;
    orientation = game.state().turn;   // show the board from the side that moves next
    closeModals();
    buildSquares();
    render();
    save();
    var s = game.status();
    toast(s.over ? 'Game loaded. It is over: ' + resultText(s) : 'Game loaded. ' + COLOR_NAME[game.state().turn] + ' to move. After your move, tap Send.');
  };
  $('btn-resign').onclick = function () {
    var btn = this;
    confirmButton(btn, 'Confirm resign?', function () {
      cancelComputer();
      game.resign(settings.mode === 'ai' ? settings.humanColor : game.state().turn);
      sound('end'); render(); save();
    });
  };
  $('btn-draw').onclick = function () {
    var btn = this;
    if (settings.mode === 'ai') {
      var ev = AI.evaluate(game.state()) * (settings.humanColor === 'w' ? -1 : 1); // from computer's view
      if (ev < 40) { game.agreeDraw(); cancelComputer(); toast('Computer accepts the draw'); sound('end'); render(); save(); }
      else toast('Computer declines the draw');
      return;
    }
    confirmButton(btn, 'Both agree?', function () { game.agreeDraw(); sound('end'); render(); save(); });
  };
  document.querySelectorAll('[data-nav]').forEach(function (b) {
    b.onclick = function () { var n = b.getAttribute('data-nav'); if (n === 'flip') flip(); else navigate(n); };
  });
  $('moves').addEventListener('click', function (e) {
    var t = e.target.closest('[data-ply]');
    if (t) navigate(parseInt(t.getAttribute('data-ply'), 10));
  });
  $('btn-sound').onclick = function () { settings.sound = !settings.sound; render(); save(); };

  document.addEventListener('keydown', function (e) {
    if (document.querySelector('.modal:not(.hidden)')) { if (e.key === 'Escape') closeModals(); return; }
    if (e.key === 'ArrowLeft') navigate('prev');
    else if (e.key === 'ArrowRight') navigate('next');
    else if (e.key === 'Home' || e.key === 'ArrowUp') navigate('first');
    else if (e.key === 'End' || e.key === 'ArrowDown') navigate('last');
    else if (e.key === 'f' || e.key === 'F') flip();
    else if (e.key === 's' || e.key === 'S') setSacMode(!sacMode);
    else if (e.key === 'Escape' && sacMode) setSacMode(false);
    else return;
    e.preventDefault();
  });

  // ------------------------------------------------------------------ new game dialog
  var draft = {};
  function openNewGame() {
    draft = { mode: settings.mode, side: settings.side, level: String(settings.level) };
    syncSeg();
    $('modal-new').classList.remove('hidden');
  }
  function syncSeg() {
    var trained = AI.hasNetwork && AI.hasNetwork();
    $('level-trained').classList.toggle('hidden', !trained);
    if (!trained && String(draft.level) === '4') draft.level = '3';
    document.querySelectorAll('#modal-new .seg').forEach(function (seg) {
      var name = seg.getAttribute('data-name');
      seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-value') === String(draft[name])); });
    });
    document.querySelectorAll('#modal-new .ai-only').forEach(function (f) { f.classList.toggle('hidden', draft.mode !== 'ai'); });
  }
  document.querySelectorAll('#modal-new .seg button').forEach(function (b) {
    b.onclick = function () { draft[b.parentNode.getAttribute('data-name')] = b.getAttribute('data-value'); syncSeg(); };
  });
  $('btn-start').onclick = function () {
    settings.mode = draft.mode;
    settings.side = draft.side;
    settings.level = parseInt(draft.level, 10);
    settings.humanColor = draft.side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : draft.side;
    closeModals();
    startGame();
  };
  function startGame() {
    cancelComputer();
    game = new E.Game();
    viewPly = null; selected = -1; chosenDecl = null; legalCache = null; promo = null;
    $('promo').classList.add('hidden');
    orientation = settings.mode === 'ai' ? settings.humanColor : 'w';
    buildSquares();
    render();
    save();
    maybeComputerMove();
  }
  function rematch() {
    if (settings.mode === 'ai') settings.humanColor = E.opp(settings.humanColor);
    startGame();
  }
  function closeModals() { document.querySelectorAll('.modal').forEach(function (m) { m.classList.add('hidden'); }); }
  document.querySelectorAll('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m || e.target.hasAttribute('data-close')) closeModals(); });
  });
  $('btn-new').onclick = openNewGame;
  $('logo').onclick = function (e) { e.preventDefault(); };

  // ------------------------------------------------------------------ rules dialog (generated from rules.js)
  function buildRules() {
    var ev = R.envoy, tiers = ev.tiers, pic = function (p) { return '<span class="pic" style=\'background-image:' + P.url(p) + '\'></span>'; };
    var start = E.fromFEN(R.startFEN), envSq = { w: [], b: [] };
    start.board.forEach(function (p, i) { if (p && p[1] === 'e') envSq[p[0]].push(E.sqName(i)); });
    var vals = Object.keys(R.pieceValues).map(function (t) {
      return '<tr><td>' + pic('w' + t) + ' ' + R.pieceNames[t] + '</td><td>' + R.pieceValues[t] + '</td></tr>';
    }).join('');
    var tierRows = tiers.map(function (t, i) {
      return '<tr><td>' + rangeText(tiers, i) + '</td><td>' + tierMoveText(t) + '</td></tr>';
    }).join('');
    var cd = ev.cooldownTurns;
    var html =
      '<h2>' + pic('we') + ' ' + R.name + ' — rules</h2>' +
      '<p>Everything is normal chess (moves, check, checkmate, castling, en passant, promotion' + (R.draws.stalemate === 'loss' ? '' : ', stalemate') + ') except for one new piece: the <b>envoy</b> ' +
      pic('we') + pic('be') + ', drawn as an upside-down triangle.</p>' +
      (R.envoyDrop && R.envoyDrop.enabled && (start.inHand.w || start.inHand.b)
        ? '<h3>Setup</h3><p>The normal chess army, with every piece in its usual place. The envoys start <b>in hand</b>, off the board.</p>' +
          '<p><b>Placing the envoy:</b> White\'s first move is to place its envoy on any empty square of <b>' + dropRankText('w') + '</b> (' + dropRange('w') + '). ' +
          'Black\'s first move is to place its envoy on any empty square of <b>' + dropRankText('b') + '</b> (' + dropRange('b') + '). Normal play starts after that. ' +
          'Placing is written like <code>E@d3</code>.</p>'
        : '<h3>Setup</h3><p>White\'s envoy starts on <b>' + envSq.w.join(', ') + '</b> and Black\'s on <b>' + envSq.b.join(', ') +
          '</b>, replacing White\'s dark-squared bishop and Black\'s light-squared bishop. Everything else is the normal starting position.</p>') +
      '<h3>Strength</h3><p>A side\'s <b>strength</b> is the sum of its pieces\' values:</p><table><tr><th>Piece</th><th>Value</th></tr>' + vals + '</table>' +
      '<p>You are <b>behind</b> by (opponent\'s strength − your strength). Both sides start at ' + E.strength(start, 'w') + '.</p>' +
      '<h3>The envoy</h3><ul>' +
      (ev.capturable === 'whenArmed'
        ? '<li><b>Diplomatic immunity:</b> while its side is <i>not</i> behind, the envoy cannot be captured (and cannot capture). Once its side is behind enough to capture, it can also be captured like any piece.</li>'
        : ev.capturable ? '<li>The envoy can be captured like any other piece (it is worth 0 strength).</li>'
        : '<li><b>Diplomatic immunity:</b> the envoy can never be captured, not even by the other envoy.</li>') +
      (ev.minKingDistance ? '<li><b>Diplomatic distance:</b> the envoy may never move onto a square ' +
        (ev.minKingDistance === 2 ? '<b>next to the enemy king</b> (one square away in any direction, including diagonally)'
          : '<b>within ' + (ev.minKingDistance - 1 === 2 ? 'two' : ev.minKingDistance - 1) + ' squares of the enemy king</b> (in any direction, including diagonally), so there is always at least one empty square between them') +
        '. It can still attack the king from further away. Only the envoy is restricted: the enemy king may walk up to it, as long as it does not step onto a square the envoy attacks.</li>' : '') +
      '<li>It may capture enemy pieces <b>only while its side is behind</b>' +
      (ev.captureMinDeficit === 1 ? ' (has less strength than the opponent)' : ' by ' + ev.captureMinDeficit + ' or more') + '.</li>' +
      (ev.givesCheck === 'whenArmed'
        ? '<li>It may give check only while it is allowed to capture.</li>'
        : ev.givesCheck ? '<li>It <b>is allowed to give check</b>, even while it is not allowed to capture: a king may not move onto a square the enemy envoy attacks.' +
          (ev.capturable ? '' : ' Because the envoy cannot be captured, a check from it must be answered by moving the king or blocking.') + '</li>'
        : '<li>It <b>never gives check</b>: it can never check or checkmate the king, and the enemy king may stand right next to it. ' +
          (ev.capturable ? '' : 'The king still cannot capture it, so the king can never move onto the envoy\'s square. ') +
          'Its attacks do not count against the king at all: the king may step onto squares the envoy attacks, and may capture a piece standing next to it even if the envoy "guards" that piece. ' +
          '(For example, a queen next to the king that only the envoy guards is not checkmate: the king simply takes the queen.) ' +
          'The envoy can still help an attack by capturing defenders or standing on a square the king would like to escape to.</li>') +
      (cd > 0 ? '<li><b>Cooldown:</b> after the envoy moves, it must sit out your next ' + (cd === 1 ? 'turn' : cd + ' turns') +
        (ev.cooldownResetOnOpponentCapture ? ', <i>unless</i> your opponent captures one of your pieces in between, which makes it ready again at once' : '') + '.</li>' : '') +
      '<li>How it moves depends on how far behind its side is:</li></ul>' +
      '<table><tr><th>Behind by</th><th>Envoy moves like</th></tr>' + tierRows + '</table>' +
      '<p class="note">' + (tiers.some(function (t) { return t.movement === 'cardinal' || (t.options || []).indexOf('centaur') >= 0; })
        ? 'Each row can make every move of the rows below it, so the envoy only ever gains moves as its side falls further behind; it never swaps one ability for another. ' : '') +
      'Amazon = queen + knight. Being ahead or equal counts as "behind by 0 or less".</p>' +
      (!ev.ownSacrificesPower && R.sacrifice && R.sacrifice.enabled ? '<p><b>Counting "behind by" for your envoy:</b> material you <i>sacrificed yourself</i> is left out. ' +
        'Example: you sacrificed a rook (5) and are now 7 behind; your envoy moves as if you were 2 behind. Every piece your <i>opponent</i> captures counts in full, so losing material to captures always makes your envoy stronger (or keeps it the same). ' +
        'This stops a player from giving away all their pieces to get a huge envoy.</p>' : '') +
      (ev.powerCap != null ? '<p><b>Counting "behind by" for the envoy:</b> the gap can count for at most ' +
        (ev.powerCap === 1 ? 'your own remaining strength' : ev.powerCap + ' times your own remaining strength') +
        '. Example: your pieces add up to 3 and you are 20 behind; your envoy moves as if you were only 3 behind. This stops a player from giving away all their pieces to get a huge envoy. (Capturing still only needs your side to be behind.)</p>' : '') +
      (tiers.some(function (t) { return t.movement === 'choice'; }) ?
        (ev.chooseBy === 'move'
          ? (function () {
              var ct = tiers.filter(function (t) { return t.movement === 'choice'; })[0], names = ct.options.map(movementName);
              var shortN = ct.options.map(function (o) { return ({ centaur: 'king + knight', dragonHorse: 'king + bishop' })[o] || movementName(o).toLowerCase(); });
              var kingBoth = ct.options.indexOf('centaur') >= 0 && ct.options.indexOf('dragonHorse') >= 0;
              var i = tiers.indexOf(ct), range = rangeText(tiers, i).replace('–', ' or ');
              if (!kingBoth) return '<p><b>' + names.join(' or ') + ':</b> there is nothing to declare. Until it moves, the envoy may move like <i>either</i> ' + shortN.join(' or ') +
                '. Its first move in that range that only one of them allows fixes that movement for as long as your side stays in the range. Moving other pieces fixes nothing, so you may put the choice off for as long as you like. ' +
                'If you leave the range and come back later, the envoy may choose again.' + (ev.undeclaredCheckPattern === 'union' ? ' Until it has chosen, it gives check along both patterns.' : '') + '</p>';
              return '<h3>The envoy\'s choice: king + knight or king + bishop</h3>' +
                '<p>When your side is ' + range + ' behind (counted as above), your envoy has two possible movements: <b>king + knight</b> or <b>king + bishop</b>. ' +
                'There is nothing to announce: the way the envoy moves makes the choice.</p><ul>' +
                '<li><b>Before the choice:</b> the envoy may make any move that either movement allows, captures included: a one-square step in any direction, a knight jump, or a diagonal move of any length.</li>' +
                '<li><b>What makes the choice:</b> the first envoy move that only one of the two allows. A <b>knight jump</b> chooses king + knight. A <b>diagonal move of two or more squares</b> chooses king + bishop. Captures count the same way.</li>' +
                '<li><b>What does not:</b> a one-square step or one-square capture (both movements allow it), moving any other piece, or a sacrifice. So you may put the choice off for as long as you like.</li>' +
                (ev.undeclaredCheckPattern === 'union' && ev.givesCheck ? '<li><b>Check while undecided:</b> the envoy attacks along both patterns at once (one-square steps, knight jumps and diagonals), so the enemy king may not step onto any of those squares, and a check along either pattern must be answered.</li>' : '') +
                '<li><b>After the choice:</b> the envoy moves only that way, with the one-square step still available, for as long as your side stays ' + range + ' behind.</li>' +
                '<li><b>Leaving the range:</b> if the gap is no longer ' + range + ' (for example after a capture or a sacrifice), the choice is wiped. If your side comes back into the range later, the envoy is free to choose again.</li>' +
                '<li><b>Capturing can end the choice:</b> every capture your side makes, <i>including one by the envoy itself</i>, makes you less behind. If a capture brings the gap below ' + ct.minDeficit + ', the envoy goes back to moving like a ' + movementName(tiers[i + 1].movement).toLowerCase() + ' and loses the knight and bishop moves, whether or not it had already chosen. It regains them only if your side falls ' + ct.minDeficit + ' or more behind again. ' +
                'So think before capturing with an undecided envoy: taking a pawn when you are 4 behind keeps the choice, but taking a knight leaves you only 1 behind.</li>' +
                '<li><b>On screen:</b> the envoy\'s badge shows an orange <b>?</b> while it has not chosen, then <b>N+</b> or <b>B+</b>. The deciding move is tagged in the move list, for example <code>E=N+</code>.</li></ul>' +
                '<p class="note">Example: White is 4 behind and its undecided envoy stands on d4. <code>Ed5</code> (one square) keeps the choice open, <code>Ef5</code> (a knight jump) chooses king + knight, and <code>Eg7</code> (a long diagonal) chooses king + bishop. ' +
                'If a black pawn stood on d5, <code>Exd5</code> would leave White 3 behind and the choice would stay open. If it were a black knight, <code>Exd5</code> would leave White only 1 behind, and the envoy would move like a king from then on.</p>';
            })()
          : '<p><b>Declaring:</b> on the first turn your side is in a "declare" range, you choose one of the options before moving. ' +
            'You may then move the envoy or any other piece. The choice stays until your side leaves that range; if you come back later you declare again. ' +
            (ev.undeclaredCheckPattern === 'union' ? 'Until the owner has declared, that envoy gives check along <i>all</i> of the options.' : '') + '</p>') : '') +
      '<p>Pawns promote to ' + R.promotionPieces.map(function (t) { return R.pieceNames[t].toLowerCase(); }).join(', ') +
      ', <b>never</b> to an envoy.</p>' +
      (R.forcedCapture === 'upward' ? '<h3>Compulsory captures (weaker takes stronger)</h3><p>A capture is compulsory only when one of your pieces can take a <b>more valuable</b> enemy piece (for example pawn takes knight, knight or bishop takes rook, rook takes queen). Then you must make one such capture, but you choose which. Equal trades and captures of cheaper pieces stay optional. ' +
          (R.forcedCaptureExempt && R.forcedCaptureExempt.length ? 'Captures by the ' + R.forcedCaptureExempt.map(function (t) { return R.pieceNames[t].toLowerCase(); }).join(' and ') + ' are never compulsory. ' : '') +
          'If your king is in check, captures are not compulsory: any legal move that answers the check is allowed.</p>'
        : R.forcedCapture ? '<h3>Compulsory captures</h3><p>If you can capture, you <b>must</b> capture (you choose which). The only exception is when your king is in check.</p>' : '') +
      (R.sacrifice && R.sacrifice.enabled ? '<h3>Sacrifice</h3><p>Instead of moving, you may <b>sacrifice</b> one of your own pieces (' +
          R.sacrifice.pieces.map(function (t) { return R.pieceNames[t].toLowerCase(); }).join(', ') + '): it is removed from the board and your turn ends. ' +
          'Use the <b>Sacrifice</b> button under the move list (or press S), then click the piece. Not allowed while in check' + (R.forcedCapture ? ', while a capture is compulsory,' : '') + ' or if it would expose your king. It is written like <code>Sac:Nf3</code>.</p>' +
          (R.sacrifice.freezeEnemyEnvoy ? '<p><b>A sacrifice freezes the enemy envoy:</b> after you sacrifice, your opponent\'s envoy may not move on ' +
            (R.sacrifice.freezeEnemyEnvoy > 1 ? 'their next ' + R.sacrifice.freezeEnemyEnvoy + ' turns' : 'their next turn') + ' (it shows an hourglass ⌛). Their other pieces move as normal.' + (ev.givesCheck ? ' A frozen envoy still attacks the squares around it, so it can still give check, and your king still may not step onto a square it attacks.' : '') + '</p>' : '') +
          '<p class="note">Why sacrifice? Your strength drops, so a side that is behind you becomes <i>less</i> behind and <b>its envoy gets weaker</b>. It can also open lines for your other pieces. ' +
          (ev.ownSacrificesPower ? 'It also puts <i>you</i> further behind, so <b>your own envoy gets stronger</b>. '
            : 'It never makes <i>your own</i> envoy stronger: sacrificed material is not counted for it. ') +
          'But too much sacrifice is risky: a side left with only king and envoy loses' + (ev.minKingDistance ? ', and the envoy can never go near the enemy king' : '') + '.</p>' : '') +
      (R.loseWithOnly ? '<h3>Running out of pieces</h3><p>A side left with <b>only its ' + R.loseWithOnly.map(function (t) { return R.pieceNames[t].toLowerCase(); }).join(' and ') +
        '</b> loses immediately: you must keep at least one other piece.</p>' : '') +
      (R.draws.stalemate === 'loss' ? '<h3>Stalemate loses</h3><p>A player who is <b>not in check but has no legal move</b> loses (in normal chess this is a draw). ' +
        'It is rare, because you can almost always sacrifice a piece instead of moving: every remaining piece must be pinned to your king (so removing it would expose the king), and your king and envoy must have no moves.</p>' : '') +
      '<h3>Draws</h3><ul>' + (R.draws.stalemate === 'loss' ? '' : '<li>Stalemate</li>') + (R.draws.threefoldRepetition ? '<li>Threefold repetition (automatic)</li>' : '') +
      (R.draws.fiftyMoveRule ? '<li>Fifty-move rule (automatic)</li>' : '') + '<li>Agreement</li></ul>' +
      '<h3>Notation</h3><p>The envoy is written <code>E</code> (e.g. <code>Ed2</code>, <code>Exe5</code>). ' + (R.envoyDrop && R.envoyDrop.enabled ? 'Placing it is written <code>E@d3</code>. ' : '') + 'The envoy\'s choice in the 3–4 range is shown as an orange tag such as ' +
      '<code>E=' + (MOVE_LETTER[(tiers.filter(function (t) { return t.movement === 'choice'; })[0] || { options: ['knight'] }).options[0]] || 'N') + '</code> on the move that made it.</p>' +
      '';
    $('rules-body').innerHTML = html;
  }
  $('btn-rules').onclick = function () { buildRules(); $('modal-rules').classList.remove('hidden'); };

  // ------------------------------------------------------------------ save / restore
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        settings: settings, orientation: orientation, fen: E.toFEN(game.states[0]),
        moves: game.moves.map(function (m) { return { from: m.from, to: m.to, promotion: m.promotion || null, declare: m.declare || null }; }),
        forced: game.forcedResult
      }));
    } catch (e) { /* private mode etc. — saving is optional */ }
  }
  function restore() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!data) return false;
      var g = new E.Game(data.fen);
      for (var i = 0; i < data.moves.length; i++) if (!g.move(data.moves[i])) return false; // rules changed -> start fresh
      if (data.forced) g.forcedResult = data.forced;
      for (var k in data.settings) settings[k] = data.settings[k];
      orientation = data.orientation || 'w';
      game = g;
      return true;
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ boot
  document.querySelector('.logo-mark').style.backgroundImage = P.url('we');
  document.querySelector('.meta-icon').style.backgroundImage = P.url('we');
  $('meta-title').textContent = R.name;
  var restored = restore();
  buildSquares();
  render();
  if (!restored) setTimeout(openNewGame, 200);
  else maybeComputerMove();

  window.addEventListener('resize', function () { render(); });
  // handy for debugging in the browser console
  window.envoy = { get game() { return game; }, engine: E, rules: R, render: render };
})();
