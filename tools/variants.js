/*
 * Rule variants for the benchmark (tools/benchmark.js).
 * Each entry returns a complete rules object: a copy of js/rules.js with a few
 * settings changed. Add your own and pass its name with --variants.
 */
var base = require('../js/rules.js');
function clone(R) { return JSON.parse(JSON.stringify(R, (k, v) => v === -Infinity ? '__-inf' : v), (k, v) => v === '__-inf' ? -Infinity : v); }
function withRules(changes, envoyChanges) {
  var R = clone(base);
  for (var k in changes || {}) R[k] = changes[k];
  for (var j in envoyChanges || {}) R.envoy[j] = envoyChanges[j];
  return R;
}
var CHESS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
var V = {};

// the rules exactly as in js/rules.js
V.current = function () { return withRules(); };
// one change at a time
V.allCapturesForced = function () { return withRules({ forcedCapture: true }); };
V.upwardCaptures = function () { return withRules({ forcedCapture: 'upward' }); };  // the old "weaker takes stronger" rule
V.noSacrifice = function () { return withRules({ sacrifice: { enabled: false, pieces: [] } }); };
V.ownSacrificesPower = function () { return withRules({}, { ownSacrificesPower: true }); };
// the current rules, but the amazon only from 12 behind (king + knight + bishop for 5-11)
V.amazon12 = function () {
  return withRules({}, { tiers: [
    { minDeficit: 12, movement: 'amazon' }, { minDeficit: 5, movement: 'cardinal' },
    { minDeficit: 3, movement: 'choice', options: ['centaur', 'dragonHorse'] }, { minDeficit: -Infinity, movement: 'king' }] });
};
// the envoy rules before the Oct 2026 change: power capped by your own strength, non-nested tiers
V.previous = function () {
  return withRules({}, { powerCap: 1, ownSacrificesPower: true, tiers: [
    { minDeficit: 12, movement: 'amazon' }, { minDeficit: 9, movement: 'queen' }, { minDeficit: 5, movement: 'dragonKing' },
    { minDeficit: 3, movement: 'choice', options: ['centaur', 'dragonHorse'] }, { minDeficit: -Infinity, movement: 'king' }] });
};
V.distance3 = function () { return withRules({}, { minKingDistance: 3 }); };   // the old diplomatic distance
V.noFreeze = function () { return withRules({ sacrifice: { enabled: true, pieces: ['p', 'n', 'b', 'r', 'q'], freezeEnemyEnvoy: 0 } }); };
V.noCheck = function () { return withRules({}, { givesCheck: false }); };
V.cooldown = function () { return withRules({}, { cooldownTurns: 1 }); };
// these rules with the envoy kept off the squares next to the enemy king
V.distance2 = function () { return withRules({}, { minKingDistance: 2 }); };
// these rules, but the envoy starts on the bishop's square (c1 / c8) instead of being placed
V.bishopSquare = function () {
  return withRules({ startFEN: 'rneqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNEQKBNR w KQkq - 0 1', envoyDrop: { enabled: false, ranks: { w: [], b: [] } } });
};
// plain chess with the same bots, as a yardstick
V.chess = function () { return withRules({ startFEN: CHESS, forcedCapture: false, loseWithOnly: null, sacrifice: { enabled: false, pieces: [] } }); };

module.exports = V;
