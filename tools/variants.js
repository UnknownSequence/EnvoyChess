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
V.noForcedCaptures = function () { return withRules({ forcedCapture: false }); };
V.noSacrifice = function () { return withRules({ sacrifice: { enabled: false, pieces: [] } }); };
V.noPowerCap = function () { return withRules({}, { powerCap: null }); };
V.noDistance = function () { return withRules({}, { minKingDistance: null }); };
V.noCheck = function () { return withRules({}, { givesCheck: false }); };
V.cooldown = function () { return withRules({}, { cooldownTurns: 1 }); };
// plain chess with the same bots, as a yardstick
V.chess = function () { return withRules({ startFEN: CHESS, forcedCapture: false, loseWithOnly: null, sacrifice: { enabled: false, pieces: [] } }); };

module.exports = V;
