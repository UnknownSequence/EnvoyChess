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
var E = E0.create(rulesWith({ forcedCapture: false, loseWithOnly: null, sacrifice: { enabled: false, pieces: [] }, envoy: { powerCap: null, minKingDistance: null, cooldownTurns: 1, chooseBy: 'turn' } }));
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
  play0(g, ['e2e4', 'd7d5']);
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
  var g = new E0.Game('4k1n1/1p5p/8/4e3/R7/8/PPP2PP1/6K1 w - - 0 1');  // black 5 behind -> rook envoy
  eq(E0.envoyInfo(g.state(), 'b').movement, 'rook');
  var m = g.move({ from: S('a4'), to: S('a4') });                      // sacrifice the rook
  ok(m && m.sacrifice, 'sacrifice should be legal');
  eq(m.san, 'Sac:Ra4');
  eq(E0.deficit(g.state(), 'b'), 0);
  eq(E0.envoyInfo(g.state(), 'b').movement, 'king');
});

test('34 legal moves at the start (20 moves + 14 possible sacrifices)', function () {
  var ms = E0.legalMoves(E0.fromFEN(E0.rules.startFEN));
  eq(ms.length, 34);
  eq(ms.filter(function (m) { return m.sacrifice; }).length, 14);
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

test('diplomatic distance: the envoy may not step next to the enemy king', function () {
  var st = E0.fromFEN('4k3/8/3E4/8/8/8/P7/4K2p w - - 0 1');
  var to = E0.legalMoves(st).filter(function (m) { return m.from === S('d6'); }).map(function (m) { return E0.sqName(m.to); });
  ok(to.indexOf('d7') < 0 && to.indexOf('e7') < 0, 'moved next to king: ' + to);
  ok(to.indexOf('c7') >= 0);
});

test('no cooldown - the envoy may move on consecutive turns', function () {
  var g = new E0.Game();
  play0(g, ['d2d3', 'a7a6', 'c1d2', 'a6a5']);
  ok(g.legalMoves().some(function (m) { return m.from === S('d2'); }), 'envoy should be free to move again');
});

test('3-4 behind, no declaration: the envoy may move like a knight or a bishop', function () {
  var st = E0.fromFEN('6k1/8/8/8/3E4/8/P6p/KN3bn1 w - - 0 1');   // white 4, black 7 -> 3 behind
  eq(E0.deficit(st, 'w'), 3);
  ok(!E0.needsDeclaration(st), 'no declaration step');
  var mv = E0.legalMoves(st).filter(function (m) { return m.from === S('d4'); });
  eq(mv.filter(function (m) { return m.declare === 'knight'; }).length, 8);
  ok(mv.filter(function (m) { return m.declare === 'bishop'; }).length >= 9);
  ok(E0.legalMoves(st).filter(function (m) { return m.from !== S('d4'); }).every(function (m) { return !m.declare; }), 'other pieces carry no choice');
});

test('the first envoy move fixes the movement while the gap lasts', function () {
  var g = new E0.Game('6k1/8/8/8/3E4/8/P6p/KN3bn1 w - - 0 1');
  ok(g.move({ from: S('a2'), to: S('a3') }), 'pawn move first: nothing fixed');
  eq(g.state().declared.w, null);
  g.move({ from: S('g8'), to: S('f8') });
  ok(g.move({ from: S('d4'), to: S('f5'), declare: 'knight' }), 'knight jump');
  eq(g.state().declared.w, 'knight');
  g.move({ from: S('f8'), to: S('g8') });
  var mv = g.legalMoves().filter(function (m) { return m.from === S('f5'); });
  ok(mv.length > 0 && mv.every(function (m) { return !m.declare; }), 'now plain knight moves');
  ok(!mv.some(function (m) { return m.to === S('g6'); }), 'no diagonal step any more');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
