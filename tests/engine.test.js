/*
 * Rule tests for the Envoy Chess engine.
 * Run with Node.js from the project folder:   node tests/engine.test.js
 * (Node is optional — it's only needed for these tests, not for playing.)
 */
var E0 = require('../js/engine.js');            // the rules exactly as in js/rules.js
function rulesWith(changes) {                     // copy of js/rules.js with some settings changed
  var R = JSON.parse(JSON.stringify(E0.rules, function (k, v) { return v === -Infinity ? '-inf' : v; }),
    function (k, v) { return v === '-inf' ? -Infinity : v; });
  for (var k in changes) {
    if (k === 'envoy') for (var j in changes.envoy) R.envoy[j] = changes.envoy[j];
    else R[k] = changes[k];
  }
  return R;
}
// Envoy-mechanics tests below use positions where captures are available or few
// pieces are left, so they run with compulsory capture and the king+envoy loss
// rule switched off (and the envoy's power cap / diplomatic distance too).
// Those rules have their own tests at the end.
// They also use the original movement tiers (rook / knight-or-bishop); the
// current king-step tiers have their own tests at the end.
var OLD_TIERS = [
  { minDeficit: 12, movement: 'amazon' }, { minDeficit: 9, movement: 'queen' }, { minDeficit: 5, movement: 'rook' },
  { minDeficit: 3, movement: 'choice', options: ['knight', 'bishop'] }, { minDeficit: -Infinity, movement: 'king' }];
var E = E0.create(rulesWith({ startFEN: 'rneqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNEQKBNR w KQkq - 0 1', envoyDrop: { enabled: false, ranks: { w: [], b: [] } }, forcedCapture: false, loseWithOnly: null, sacrifice: { enabled: false, pieces: [] }, envoy: { powerCap: null, minKingDistance: null, cooldownTurns: 1, chooseBy: 'turn', tiers: OLD_TIERS } }));
var passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }
var S = E.parseSq;
function movesFrom(st, sq) { return E.legalMoves(st).filter(function (m) { return m.from === S(sq); }); }
function has(moves, to) { return moves.some(function (m) { return m.to === S(to); }); }
function play(game, list) {
  list.forEach(function (mv) {
    var r = game.move({ from: S(mv.slice(0, 2)), to: S(mv.slice(2, 4)), promotion: mv[4] || null, declare: mv.declare });
    if (!r) throw new Error('illegal move in test sequence: ' + mv);
  });
}
function play0(game, list) {
  list.forEach(function (mv) {
    var r = game.move({ from: S(mv.slice(0, 2)), to: S(mv.slice(2, 4)), promotion: mv[4] || null });
    if (!r) throw new Error('illegal move in test sequence: ' + mv);
  });
}
function perft(st, d) {
  if (d === 0) return 1;
  var n = 0;
  E.legalMoves(st).forEach(function (m) { n += perft(E.applyMove(st, m), d - 1); });
  return n;
}

console.log('Envoy Chess engine tests');

test('start position: envoys on c1/c8, equal strength 36-36', function () {
  var st = E.fromFEN(E.rules.startFEN);
  eq(st.board[S('c1')], 'we'); eq(st.board[S('c8')], 'be');
  eq(E.strength(st, 'w'), 36); eq(E.strength(st, 'b'), 36);
  eq(E.envoyInfo(st, 'w').movement, 'king');
});

test('start position: 20 legal moves, perft(2) = 400', function () {
  var st = E.fromFEN(E.rules.startFEN);
  eq(E.legalMoves(st).length, 20);
  eq(perft(st, 2), 400);
});

test('perft(3) runs quickly', function () {
  var t = Date.now(), n = perft(E.fromFEN(E.rules.startFEN), 3);
  ok(n > 8000, 'perft3=' + n);
  console.log('       perft(3) = ' + n + ' in ' + (Date.now() - t) + ' ms');
});

test('envoy can never be captured', function () {
  var st = E.fromFEN('4k3/8/8/e7/8/8/8/Q6K w - - 0 1');
  ok(!has(movesFrom(st, 'a1'), 'a5'), 'queen captured envoy');
  ok(has(movesFrom(st, 'a1'), 'a4'));
});

test('envoy cannot capture when strengths are equal', function () {
  var st = E.fromFEN('4k3/8/8/8/8/3p4/2E4P/4K3 w - - 0 1');
  eq(E.deficit(st, 'w'), 0);
  ok(!has(movesFrom(st, 'c2'), 'd3'), 'captured while equal');
  ok(has(movesFrom(st, 'c2'), 'c3'));
});

test('envoy can capture when its side is weaker', function () {
  var st = E.fromFEN('4k3/8/8/8/8/3p4/2E5/4K3 w - - 0 1');
  eq(E.deficit(st, 'w'), 1);
  ok(has(movesFrom(st, 'c2'), 'd3'), 'could not capture while weaker');
});

test('envoy can never capture the other envoy', function () {
  var st = E.fromFEN('4k3/8/8/8/8/3e4/2E5/4K2q w - - 0 1');
  ok(E.envoyInfo(st, 'w').canCapture);
  ok(!has(movesFrom(st, 'c2'), 'd3'));
});

test('deficit 5-8 -> envoy moves like a rook', function () {
  var st = E.fromFEN('7k/7r/8/8/3E4/8/8/K7 w - - 0 1');
  eq(E.envoyInfo(st, 'w').movement, 'rook');
  eq(movesFrom(st, 'd4').length, 14);
});

test('deficit 9-11 -> envoy moves like a queen', function () {
  var st = E.fromFEN('6k1/7q/8/8/3E4/8/8/K7 w - - 0 1');
  eq(E.envoyInfo(st, 'w').movement, 'queen');
  eq(movesFrom(st, 'd4').length, 26);
});

test('deficit 12+ -> envoy moves like an amazon (queen + knight), can capture', function () {
  var st = E.fromFEN('6k1/5ppp/7q/8/3E4/8/8/K7 w - - 0 1');
  eq(E.deficit(st, 'w'), 12);
  eq(E.envoyInfo(st, 'w').movement, 'amazon');
  var mv = movesFrom(st, 'd4');
  eq(mv.length, 33);
  ok(has(mv, 'b5') && has(mv, 'g7'));
});

test('deficit 2 -> still king movement', function () {
  var st = E.fromFEN('6k1/6pp/8/8/3E4/8/8/K7 w - - 0 1');
  eq(E.deficit(st, 'w'), 2);
  eq(E.envoyInfo(st, 'w').movement, 'king');
  eq(movesFrom(st, 'd4').length, 8);
});

test('deficit 3-4 -> must declare knight or bishop; moves carry the declaration', function () {
  var st = E.fromFEN('6k1/8/8/8/3E4/8/8/K6n w - - 0 1');
  ok(E.needsDeclaration(st));
  var mv = movesFrom(st, 'd4');
  eq(mv.filter(function (m) { return m.declare === 'knight'; }).length, 8);
  eq(mv.filter(function (m) { return m.declare === 'bishop'; }).length, 12);
  // other pieces also move "after declaring"
  ok(E.legalMoves(st).some(function (m) { return m.from === S('a1') && m.declare === 'bishop'; }));
});

test('declaration persists while in the tier and resets when leaving it', function () {
  var g = new E.Game('6k1/8/8/8/3E4/8/8/K6n w - - 0 1');
  var m = { from: S('a1'), to: S('a2'), declare: 'knight' };
  ok(g.move(m), 'declare + king move');
  eq(g.state().declared.w, 'knight');
  play(g, ['h1g3']);
  ok(!E.needsDeclaration(g.state()), 'should not need to declare again');
  ok(movesFrom(g.state(), 'd4').every(function (x) { return !x.declare; }));
  eq(movesFrom(g.state(), 'd4').length, 8);
  // knight jumps to f5 where the knight-envoy can capture it -> deficit 0 -> declaration cleared
  play(g, ['a2a1', 'g3f5']);
  ok(has(movesFrom(g.state(), 'd4'), 'f5'));
  play(g, ['d4f5']);
  eq(g.state().declared.w, null);
  eq(E.envoyInfo(g.state(), 'w').movement, 'king');
});

test('envoy gives check; king may not step next to a king-mode envoy', function () {
  var st = E.fromFEN('4k3/8/4E3/8/8/8/8/4K3 b - - 0 1');
  var km = movesFrom(st, 'e8').map(function (m) { return E.sqName(m.to); }).sort();
  eq(km.join(','), 'd8,f8');
});

test('a lone envoy can deliver checkmate (it cannot be captured)', function () {
  var g = new E.Game('4k3/4E3/8/8/8/8/8/4K3 b - - 0 1');
  var s = g.status();
  eq(s.reason, 'checkmate'); eq(s.result, '1-0');
});

test('cooldown: envoy cannot move on consecutive turns', function () {
  var g = new E.Game();
  play(g, ['e2e4', 'd7d5', 'd2d3', 'a7a6', 'c1d2', 'a6a5']);
  eq(movesFrom(g.state(), 'd2').length, 0, 'envoy should be cooling down');
  play(g, ['h2h3', 'a5a4']);
  ok(movesFrom(g.state(), 'd2').length > 0, 'envoy should be ready again');
});

test('cooldown is cancelled when the opponent captures one of your pieces', function () {
  var g = new E.Game();
  play(g, ['e2e4', 'd7d5', 'd2d3', 'a7a6', 'c1d2', 'd5e4']);
  var mv = movesFrom(g.state(), 'd2').map(function (m) { return E.sqName(m.to); }).sort();
  eq(mv.join(','), 'c1,c3,e2,e3');
});

test('pawns cannot promote to an envoy', function () {
  var st = E.fromFEN('8/P7/8/8/8/8/8/k1K5 w - - 0 1');
  var promos = movesFrom(st, 'a7').map(function (m) { return m.promotion; }).sort();
  eq(promos.join(''), 'bnqr');
});

test('queenside castling needs the envoy to leave c1', function () {
  var st = E.fromFEN('r3k2r/8/8/8/8/8/8/R1E1K2R w KQkq - 0 1');
  var ks = movesFrom(st, 'e1').filter(function (m) { return m.castle; }).map(function (m) { return m.castle; });
  eq(ks.join(','), 'K');
});

test('undeclared envoy checks along all options (knight + bishop)', function () {
  // Black is 3 weaker and has not declared yet: its envoy on d5 covers knight AND bishop squares
  var st = E.fromFEN('4k3/8/8/3e4/8/8/8/4K1N1 w - - 0 1');
  ok(E.envoyInfo(st, 'b').pending);
  ok(E.isAttacked(st, S('e3'), 'b'), 'knight square');
  ok(E.isAttacked(st, S('g2'), 'b'), 'bishop square');
  ok(!E.isAttacked(st, S('d4'), 'b'), 'king square should not be covered');
});

test('a capture that makes the opponent weaker can upgrade their envoy (no moving into its check)', function () {
  // Equal material. Rxe5 would leave Black 9 down -> Black's envoy on a1 becomes a
  // queen and would check the white king along the (now open) first rank.
  var st = E.fromFEN('k7/8/8/4q3/8/PPPP4/8/e3R2K w - - 0 1');
  eq(E.deficit(st, 'w'), 0);
  var rook = movesFrom(st, 'e1');
  ok(!has(rook, 'e5'), 'Rxe5 should be illegal');
  ok(has(rook, 'e2'), 'Re2 is fine');
});

test('SAN, checkmate detection and PGN', function () {
  var g = new E.Game();
  play(g, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  eq(g.moves[3].san, 'Qh4#');
  eq(g.status().reason, 'checkmate');
  ok(g.pgn().indexOf('2. g4 Qh4# 0-1') >= 0, g.pgn());
});

test('envoy moves are written with E', function () {
  var g = new E.Game();
  play(g, ['d2d3', 'd7d6', 'c1d2']);
  eq(g.moves[2].san, 'Ed2');
});

test('threefold repetition', function () {
  var g = new E.Game();
  play(g, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
  eq(g.status().reason, 'threefold repetition');
});

test('rules are swappable: custom engine with different values', function () {
  var R = JSON.parse(JSON.stringify(E.rules, function (k, v) { return v === -Infinity ? -999 : v; }));
  R.envoy.cooldownTurns = 0;
  var E2 = E.create(R);
  var g = new E2.Game();
  play(g, ['d2d3', 'a7a6', 'c1d2', 'a6a5']);
  ok(E2.legalMoves(g.state()).some(function (m) { return m.from === S('d2'); }), 'no cooldown in custom rules');
});

function armedEngine() {
  var R = JSON.parse(JSON.stringify(E.rules, function (k, v) { return v === -Infinity ? -999 : v; }));
  R.envoy.capturable = 'whenArmed'; R.envoy.givesCheck = 'whenArmed';
  return E.create(R);
}

test("'whenArmed': a peaceful envoy is immune and gives no check", function () {
  var E2 = armedEngine();
  var st = E2.fromFEN('4k3/4E3/8/8/8/8/8/Q3K3 b - - 0 1'); // white is ahead -> its envoy is peaceful
  ok(!E2.inCheck(st, 'b'), 'peaceful envoy should not give check');
  var st2 = E2.fromFEN('4k3/8/8/e7/8/8/8/Q3K3 w - - 0 1'); // black is behind -> its envoy is armed
  ok(E2.legalMoves(st2).some(function (m) { return m.from === S('a1') && m.to === S('a5'); }), 'armed envoy should be capturable');
  var st3 = E2.fromFEN('4k3/8/8/e7/8/8/8/Q3K2q w - - 0 1'); // equal -> immune
  ok(!E2.legalMoves(st3).some(function (m) { return m.to === S('a5'); }), 'peaceful envoy should be immune');
});

test("'whenArmed': an armed envoy gives check", function () {
  var E2 = armedEngine();
  var st = E2.fromFEN('4k2q/4E3/8/8/8/8/8/4K3 b - - 0 1'); // white behind by 9 -> queen-envoy, armed
  ok(E2.inCheck(st, 'b'));
});

// ---------------------------------------------------------------- compulsory captures, sacrifice, running out of pieces, envoy limits
test('equal trades are optional (pawn takes pawn)', function () {
  var g = new E0.Game();
  play0(g, ['a3a3', 'h6h6', 'e2e4', 'd7d5']);
  ok(g.legalMoves().some(function (m) { return !m.captured; }), 'quiet moves must be allowed');
});

test('a weaker piece that can take a stronger one must take (any such capture)', function () {
  var st = E0.fromFEN('4k3/8/8/3n4/4P3/1N6/7K/r7 w - - 0 1'); // exd5 (P takes N), Nxa1 (N takes R)
  var ms = E0.legalMoves(st).map(function (m) { return E0.san(st, m); }).sort();
  eq(ms.join(','), 'Nxa1,exd5');
});

test('downward captures are optional', function () {
  var st = E0.fromFEN('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1'); // Qxd5 only
  ok(E0.legalMoves(st).length > 1);
});

test('compulsory capture does not apply while in check', function () {
  // white king e1 in check from rook e8; Nxa5 is a capture but blocking/moving is allowed too
  var st = E0.fromFEN('4r1k1/8/8/q7/8/8/1N6/4K3 w - - 0 1');
  ok(E0.inCheck(st, 'w'));
  ok(E0.legalMoves(st).some(function (m) { return !m.captured; }), 'non-captures must be allowed in check');
});

test('envoy captures are never compulsory', function () {
  var st = E0.fromFEN('4k3/p7/8/8/8/3p4/2E4P/4K3 w - - 0 1'); // white 1 behind -> envoy may take d3
  var ms = E0.legalMoves(st);
  ok(ms.some(function (m) { return m.from === S('c2') && m.to === S('d3'); }), 'Exd3 possible');
  ok(ms.some(function (m) { return !m.captured; }), 'but not forced');
});

test('compulsory capture does not force an envoy that may not capture', function () {
  var st = E0.fromFEN('4k3/8/8/8/8/3p4/2E4P/4K3 w - - 0 1'); // equal -> envoy cannot capture
  ok(E0.legalMoves(st).length > 1);
});

test('a side left with only king + envoy loses', function () {
  var g = new E0.Game('k7/8/8/8/8/8/p7/R3K3 w - - 0 1');
  // Rxa2 takes Black's last piece -> Black has only its king -> Black loses
  play0(g, ['a1a2']);
  var s = g.status();
  eq(s.reason, 'only king and envoy left'); eq(s.result, '1-0');
});

test('king + envoy + one pawn is still alive', function () {
  var g = new E0.Game('4k3/8/8/8/8/8/P1E1K2p/7e w - - 0 1');
  ok(!g.status().over);
  eq(E0.spareCount(g.state(), 'b'), 1);
});

test('sacrificing a piece shrinks the opponent\'s deficit and weakens their envoy', function () {
  var g = new E0.Game('4k1n1/1p5p/8/4e3/R7/8/PPP2PP1/6K1 w - - 0 1');  // black 5 behind -> rook + king envoy
  eq(E0.envoyInfo(g.state(), 'b').movement, 'dragonKing');
  var m = g.move({ from: S('a4'), to: S('a4') });                      // sacrifice the rook
  ok(m && m.sacrifice, 'sacrifice should be legal');
  eq(m.san, 'Sac:Ra4');
  eq(E0.deficit(g.state(), 'b'), 0);
  eq(E0.envoyInfo(g.state(), 'b').movement, 'king');
});

test('after both envoys are placed on d3/d6: 18 moves + 5 envoy moves + 15 possible sacrifices', function () {
  var g = new E0.Game();
  play0(g, ['d3d3', 'd6d6']);
  var ms = g.legalMoves();
  eq(ms.filter(function (m) { return m.sacrifice; }).length, 15);
  eq(ms.length, 38);
});

test('no sacrifice while in check', function () {
  var st = E0.fromFEN('4r1k1/8/8/8/8/8/PP6/4K3 w - - 0 1');
  ok(!E0.legalMoves(st).some(function (m) { return m.sacrifice; }));
});

test('no sacrifice while a capture is compulsory', function () {
  var st = E0.fromFEN('4k3/8/8/3n4/4P3/8/P6K/8 w - - 0 1');
  var ms = E0.legalMoves(st);
  ok(ms.length === 1 && ms[0].captured, 'exd5 is forced');
});

test('a sacrifice may not expose your own king', function () {
  var st = E0.fromFEN('4r1k1/8/8/8/8/8/P3N3/4K3 w - - 0 1'); // knight e2 shields the king from the rook
  ok(!E0.legalMoves(st).some(function (m) { return m.sacrifice && m.from === S('e2'); }));
  ok(E0.legalMoves(st).some(function (m) { return m.sacrifice && m.from === S('a2'); }));
});

test('sacrificing your last piece besides king + envoy loses', function () {
  var g = new E0.Game('4k3/p7/8/8/8/8/P7/4K2e w - - 0 1');
  g.move({ from: S('a2'), to: S('a2') });
  eq(g.status().reason, 'only king and envoy left');
  eq(g.status().result, '0-1');
});

test('power cap: an envoy with no army behind it stays weak', function () {
  // White has one pawn (strength 1) and is 13 behind -> without the cap: amazon; with it: king
  var st = E0.fromFEN('6k1/5ppp/7q/8/3E4/8/7P/K7 w - - 0 1');
  eq(E0.deficit(st, 'w'), 11);
  eq(E0.powerDeficit(st, 'w'), 1);
  eq(E0.envoyInfo(st, 'w').movement, 'king');
  ok(E0.envoyInfo(st, 'w').canCapture, 'still behind, so it may capture');
});

test('power cap: a real army behind keeps full power', function () {
  var st = E0.fromFEN('6k1/7q/8/8/3E4/8/PPPPPP2/K7 w - - 0 1'); // white 6 vs 9 -> 3 behind, cap 6
  eq(E0.powerDeficit(st, 'w'), 3);
});

test('diplomatic distance 3: the envoy keeps an empty ring around the enemy king', function () {
  var st = E0.fromFEN('4k3/8/8/3E4/8/8/P7/4K2p w - - 0 1');
  var to = E0.legalMoves(st).filter(function (m) { return m.from === S('d5'); }).map(function (m) { return E0.sqName(m.to); });
  ok(to.indexOf('d6') < 0 && to.indexOf('e6') < 0 && to.indexOf('c6') < 0, 'moved within two squares of the king: ' + to);
  ok(to.indexOf('c5') >= 0 && to.indexOf('e5') >= 0, 'three squares away is fine: ' + to);
});

test('no cooldown - the envoy may move on consecutive turns', function () {
  var g = new E0.Game();
  play0(g, ['d3d3', 'a6a6', 'd3e3', 'h7h5']);
  ok(g.legalMoves().some(function (m) { return m.from === S('e3'); }), 'envoy should be free to move again');
});

test('5-8 behind -> the envoy moves like a rook plus a king step', function () {
  var st = E0.fromFEN('7k/6rr/8/8/3E4/8/PP6/K6B w - - 0 1');   // white 5, black 10
  eq(E0.powerDeficit(st, 'w'), 5);
  eq(E0.envoyInfo(st, 'w').movement, 'dragonKing');
  var to = E0.legalMoves(st).filter(function (m) { return m.from === S('d4'); }).map(function (m) { return E0.sqName(m.to); });
  eq(to.length, 18, 'rook lines 14 + diagonal steps 4: ' + to);
  ok(to.indexOf('e5') >= 0 && to.indexOf('c3') >= 0 && to.indexOf('f6') < 0);
});

test('every tier keeps the king step', function () {
  E0.rules.envoy.tiers.forEach(function (t) {
    (t.movement === 'choice' ? t.options : [t.movement]).forEach(function (name) {
      var st = E0.fromFEN('8/8/8/8/3E4/8/8/8 w - - 0 1');
      var comps = E0.rules.movements[name];
      [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (d) {
        ok(comps.some(function (c) { return (c.leap || c.slide).some(function (x) { return x[0] === d[0] && x[1] === d[1]; }); }), name + ' lacks step ' + d);
      });
    });
  });
});

test('3-4 behind: king + knight or king + bishop; shared king steps fix nothing', function () {
  var st = E0.fromFEN('7k/8/8/8/3E4/8/P6p/KN3bn1 w - - 0 1');   // white 4, black 7 -> 3 behind
  eq(E0.deficit(st, 'w'), 3);
  ok(!E0.needsDeclaration(st), 'no declaration step');
  var mv = E0.legalMoves(st).filter(function (m) { return m.from === S('d4'); });
  eq(mv.filter(function (m) { return !m.declare; }).length, 8, 'the 8 king steps');
  eq(mv.filter(function (m) { return m.declare === 'centaur'; }).length, 8, 'knight jumps');
  eq(mv.filter(function (m) { return m.declare === 'dragonHorse'; }).length, 5, 'long diagonal moves (f6 is too close to the king)');
  ok(E0.legalMoves(st).filter(function (m) { return m.from !== S('d4'); }).every(function (m) { return !m.declare; }), 'other pieces carry no choice');
  var g = new E0.Game('7k/8/8/8/3E4/8/P6p/KN3bn1 w - - 0 1');
  ok(g.move({ from: S('d4'), to: S('d5'), declare: 'centaur' }), 'king step (a stale choice is ignored)');
  eq(g.state().declared.w, null, 'a king step leaves the choice open');
});

test('the first knight jump fixes king + knight while the gap lasts', function () {
  var g = new E0.Game('7k/8/8/8/3E4/8/P6p/KN3bn1 w - - 0 1');
  ok(g.move({ from: S('a2'), to: S('a3') }), 'pawn move first: nothing fixed');
  eq(g.state().declared.w, null);
  g.move({ from: S('h8'), to: S('g8') });
  var jump = g.move({ from: S('d4'), to: S('f5') });
  ok(jump && jump.declare === 'centaur', 'knight jump');
  eq(g.state().declared.w, 'centaur');
  g.move({ from: S('g8'), to: S('h8') });
  var mv = g.legalMoves().filter(function (m) { return m.from === S('f5'); });
  ok(mv.length > 0 && mv.every(function (m) { return !m.declare; }), 'now plain king + knight moves');
  ok(mv.some(function (m) { return m.to === S('e6'); }), 'king step still allowed');
  ok(mv.some(function (m) { return m.to === S('e3'); }), 'knight jump allowed');
  ok(!mv.some(function (m) { return m.to === S('h3'); }), 'no long diagonal any more');
});

// ---------------------------------------------------------------- envoy drop (v5)
test('start: full army (39 each), envoys in hand, White must place on rank 3', function () {
  var g = new E0.Game();
  eq(E0.strength(g.state(), 'w'), 39); eq(E0.strength(g.state(), 'b'), 39);
  ok(!E0.hasEnvoy(g.state(), 'w') && g.state().inHand.w && g.state().inHand.b);
  var ms = g.legalMoves();
  eq(ms.length, 8);
  ok(ms.every(function (m) { return m.drop && (m.to >> 3) === 2; }), 'only drops on rank 3');
  eq(E0.san(g.state(), ms[3]), 'E@d3');
});

test('then Black must place on rank 6, and normal play starts', function () {
  var g = new E0.Game();
  var m = g.move({ from: S('e3'), to: S('e3') });
  ok(m && m.drop && m.san === 'E@e3');
  eq(g.state().board[S('e3')], 'we');
  var ms = g.legalMoves();
  eq(ms.length, 8);
  ok(ms.every(function (x) { return x.drop && (x.to >> 3) === 5; }), 'only drops on rank 6');
  ok(!g.move({ from: S('e7'), to: S('e5') }), 'a pawn move is not allowed yet');
  ok(g.move({ from: S('c6'), to: S('c6') }));
  ok(g.legalMoves().every(function (x) { return !x.drop; }), 'no more drops');
  ok(g.move({ from: S('e2'), to: S('e4') }) === null, 'e-pawn is blocked by its own envoy');
  ok(g.move({ from: S('e3'), to: S('f4') }), 'the envoy now moves like a king');
});

test('envoys in hand survive FEN and PGN round trips', function () {
  var g = new E0.Game();
  g.move({ from: S('d3'), to: S('d3') });
  var fen = E0.toFEN(g.state());
  ok(/ e$/.test(fen), fen);
  eq(E0.fromFEN(fen).inHand.b, 1); eq(E0.fromFEN(fen).inHand.w, 0);
  ok(/\[FEN "[^"]* Ee"\]/.test(g.pgn()), 'PGN start position keeps the envoys in hand');
  ok(/1\. E@d3/.test(g.pgn()));
  ok(E0.positionKey(E0.fromFEN(E0.rules.startFEN)) !== E0.positionKey(E0.fromFEN(E0.rules.startFEN.replace(/ Ee$/, ''))));
});

test('the computer places its envoy and plays on', function () {
  var AI = require('../js/ai.js'), g = new E0.Game();
  for (var i = 0; i < 4; i++) ok(g.move(AI.chooseMove(g.state(), 1, {})), 'computer move ' + i);
  ok(E0.hasEnvoy(g.state(), 'w') && E0.hasEnvoy(g.state(), 'b'));
});

test('stalemate is possible but rare (every piece pinned) and loses', function () {
  // White: Ka1, pawn b2 pinned by the bishop on h8, knights cover a2/b1, the envoy on h1 may not go near Black's king
  var g = new E0.Game('7b/8/4e3/8/8/6k1/1P1n4/K1n4E w - - 0 1');
  eq(g.legalMoves().length, 0);
  var s = g.status();
  eq(s.reason, 'stalemate'); eq(s.result, '0-1');
});

test('the enemy king may walk up to the envoy (only the envoy keeps its distance)', function () {
  var st = E0.fromFEN('8/4k3/8/8/4E3/8/8/K6p b - - 0 1');
  var to = E0.legalMoves(st).filter(function (m) { return m.from === S('e7'); }).map(function (m) { return E0.sqName(m.to); });
  ok(to.indexOf('e6') >= 0 && to.indexOf('d6') >= 0, 'two squares from the envoy is fine: ' + to);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
