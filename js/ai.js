/*
 * ============================================================================
 *  ENVOY CHESS — COMPUTER OPPONENT
 * ============================================================================
 *  A small alpha-beta search. It plays by the same engine (and therefore the
 *  same rules.js) as the humans, so rule changes need no AI changes.
 *  Only the evaluation weights below are AI-specific.
 * ============================================================================
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var nnMod = isNode ? require('./nn.js') : root.EnvoyNN;
  var api = factory(isNode ? require('./engine.js') : root.EnvoyEngine, nnMod);
  // build an AI for a custom engine: EnvoyAI.create(EnvoyEngine.create(myRules))
  api.create = function (E) { return factory(E, nnMod); };
  // in the browser, use the trained network if js/nn-weights.js contains one
  if (!isNode && root.EnvoyNNWeights) {
    try { api.setNetwork(root.EnvoyNNWeights); } catch (e) { if (root.console) root.console.warn(e.message); }
  }
  if (isNode) module.exports = api; else root.EnvoyAI = api;
})(typeof self !== 'undefined' ? self : this, function (E, nnMod) {
  'use strict';
  var NN = null; // trained evaluator (see js/nn.js), used by levels with nn: true

  var CONFIG = {
    // Levels: search depth, time budget (ms) and randomness (centipawns).
    levels: {
      1: { depth: 1, timeMs: 400, noise: 120, qDepth: 2 },
      2: { depth: 2, timeMs: 1200, noise: 30, qDepth: 4 },
      3: { depth: 4, timeMs: 2500, noise: 0, qDepth: 6 },
      // "Trained": positions judged by the neural network (js/nn-weights.js), deeper search
      4: { depth: 10, timeMs: 3000, noise: 0, qDepth: 6, nn: true }   // searches as deep as 3 seconds allow
    },
    // How much the AI values its envoy in each movement mode (centipawns).
    // The envoy is worth 0 "strength", but a strong envoy is still useful.
    envoyModeValue: { king: 80, knight: 230, bishop: 230, rook: 380, queen: 650, amazon: 900, centaur: 300, dragonHorse: 330, dragonKing: 520, cardinal: 600, pending: 330 },
    envoyCaptureBonus: 40,     // extra when the envoy may capture
    envoyNearKingBonus: 14,    // per step closer to the enemy king (envoys can deliver mate)
    envoyCenter: 3,            // per step towards the centre (also decides where to place an envoy in hand)
    pieceScale: 100,           // strength point -> centipawns
    lastPiecePenalty: 150,     // only one piece left besides king + envoy (losing it loses the game)
    mopUpEdge: 10,             // endgame: enemy king pushed to the edge
    mopUpKing: 4               // endgame: own king close to enemy king
  };

  // Simple piece-square bonuses (from White's view, a1 = index 0).
  var CENTER = [];
  for (var i = 0; i < 64; i++) {
    var f = i & 7, r = i >> 3;
    CENTER.push(6 - (Math.abs(3.5 - f) + Math.abs(3.5 - r)));   // 0 at corners .. 6 in centre
  }
  var MATE = 100000;

  function evaluate(st) {
    var R = E.rules, b = st.board, score = 0, kings = { w: -1, b: -1 }, envoys = { w: -1, b: -1 };
    for (var i = 0; i < 64; i++) {
      var p = b[i];
      if (!p) continue;
      var c = p[0], t = p[1], sgn = c === 'w' ? 1 : -1, s = 0;
      s += (R.pieceValues[t] || 0) * CONFIG.pieceScale;
      var rank = c === 'w' ? (i >> 3) : 7 - (i >> 3);
      if (t === 'p') s += rank * rank * 1.5 + (CENTER[i] > 4 ? 8 : 0);
      else if (t === 'n' || t === 'b') s += CENTER[i] * 5 - (rank === 0 ? 10 : 0);
      else if (t === 'q') s += CENTER[i] * 1.5;
      else if (t === 'k') { kings[c] = i; s += rank === 0 ? 15 : -rank * 8; }
      else if (t === 'e') envoys[c] = i;
      score += sgn * s;
    }
    // Endgame "mop-up": when clearly ahead, drive the enemy king to the edge
    // and bring your own king closer (helps actually finishing won games).
    var lead = E.strength(st, 'w') - E.strength(st, 'b');
    if (Math.abs(lead) >= 4 && kings.w >= 0 && kings.b >= 0) {
      var strong = lead > 0 ? 'w' : 'b', wk = kings[E.opp(strong)], sk = kings[strong];
      var dist = Math.abs((wk & 7) - (sk & 7)) + Math.abs((wk >> 3) - (sk >> 3));
      var mop = (6 - CENTER[wk]) * CONFIG.mopUpEdge + (14 - dist) * CONFIG.mopUpKing;
      score += (strong === 'w' ? 1 : -1) * mop;
    }
    ['w', 'b'].forEach(function (c) {
      if (envoys[c] < 0) return;
      var info = E.envoyInfo(st, c), sgn = c === 'w' ? 1 : -1;
      var v = CONFIG.envoyModeValue[info.movement || 'pending'] || 0;
      if (info.canCapture) v += CONFIG.envoyCaptureBonus;
      var ek = kings[E.opp(c)];
      if (ek >= 0) {
        var d = Math.max(Math.abs((ek & 7) - (envoys[c] & 7)), Math.abs((ek >> 3) - (envoys[c] >> 3)));
        v += (7 - d) * CONFIG.envoyNearKingBonus;
      }
      v += CENTER[envoys[c]] * CONFIG.envoyCenter;
      score += sgn * v;
    });
    if (R.loseWithOnly) ['w', 'b'].forEach(function (c) {
      if (E.spareCount(st, c) <= 1) score -= (c === 'w' ? 1 : -1) * CONFIG.lastPiecePenalty;
    });
    return score;
  }

  // Pseudo-legal moves, expanded with envoy declarations when needed.
  function candidateMoves(st) {
    if (E.needsDeclaration(st)) {
      var all = [];
      E.envoyInfo(st, st.turn).tier.options.forEach(function (opt) {
        E.pseudoMoves(E.withDeclaration(st, opt)).forEach(function (m) { m.declare = opt; all.push(m); });
      });
      return all;
    }
    return E.pseudoMoves(st);
  }

  var VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 20, e: 2 };
  function orderScore(m) {
    var s = 0;
    if (m.captured) s += 100 * VAL[m.captured[1]] - VAL[m.piece[1]];
    if (m.promotion) s += 800 + VAL[m.promotion];
    if (m.sacrifice) s -= 200;   // try sacrifices last
    return s;
  }

  /**
   * Compulsory captures: if the side to move is not in check and has a legal
   * capture, keep only the (legal) captures. Moves are grouped by declaration,
   * because a different declaration may give the envoy different captures.
   */
  function applyForced(st, moves) {
    if (!E.rules.forcedCapture || E.inCheck(st, st.turn)) return moves;
    var groups = {}, out = [];
    moves.forEach(function (m) { var k = m.declare || ''; (groups[k] = groups[k] || []).push(m); });
    Object.keys(groups).forEach(function (k) {
      var caps = groups[k].filter(function (m) { return E.isForcingCapture(m) && !E.inCheck(E.applyMove(st, m), st.turn); });
      out = out.concat(caps.length ? caps : groups[k]);
    });
    return out;
  }
  /** Score for a position where a side has been reduced to king + envoy (or null). */
  function bareScore(st, ply) {
    var bare = E.bareSide(st);
    if (!bare) return null;
    return bare === st.turn ? -MATE + ply : MATE - ply;
  }

  function Timeout() {}

  /**
   * Pick a move. `seen` (optional) = object whose keys are E.positionKey() of
   * earlier positions in the game; moves that repeat one are scored as a draw,
   * so the computer avoids repetition when winning and seeks it when losing.
   */
  function search(rootState, level, seen, info) {
    var cfg = CONFIG.levels[level] || CONFIG.levels[2];
    var useNN = !!(cfg.nn && NN);
    /** Static score for the side to move, in centipawns. */
    function staticEval(st) {
      if (!useNN) return evaluate(st) * (st.turn === 'w' ? 1 : -1);
      if (!NN.residual) return NN.cp(st);
      // residual network: a learned correction on top of the handcrafted judgment
      var v = evaluate(st) * (st.turn === 'w' ? 1 : -1) + NN.correction(st);
      return v > 9000 ? 9000 : v < -9000 ? -9000 : v;
    }
    var deadline = Date.now() + cfg.timeMs, nodes = 0;

    function checkTime() { if ((++nodes & 255) === 0 && Date.now() > deadline) throw new Timeout(); }

    function quiesce(st, alpha, beta, qd, ply) {
      checkTime();
      var bs = bareScore(st, ply);
      if (bs !== null) return bs;
      var stand = staticEval(st);
      if (qd <= 0) return stand;
      var moves = candidateMoves(st).filter(function (m) { return m.captured || m.promotion === 'q'; });
      // With compulsory captures the side to move cannot "stand pat" if it has a capture.
      var forced = E.rules.forcedCapture && !E.inCheck(st, st.turn) && moves.some(function (m) {
        return E.isForcingCapture(m) && !E.inCheck(E.applyMove(st, m), st.turn);
      });
      if (forced) moves = moves.filter(E.isForcingCapture);
      else {
        if (stand >= beta) return stand;
        if (stand > alpha) alpha = stand;
      }
      moves.sort(function (a, b) { return orderScore(b) - orderScore(a); });
      var best = forced ? -Infinity : stand;
      for (var i = 0; i < moves.length; i++) {
        var child = E.applyMove(st, moves[i]);
        if (E.inCheck(child, st.turn)) continue;
        if (useNN) child._par = st;   // lets the network update its accumulators incrementally
        var sc = -quiesce(child, -beta, -alpha, qd - 1, ply + 1);
        if (sc > best) best = sc;
        if (sc > alpha) alpha = sc;
        if (alpha >= beta) break;
      }
      return best === -Infinity ? stand : best;
    }

    function negamax(st, depth, alpha, beta, ply) {
      checkTime();
      var bs = bareScore(st, ply);
      if (bs !== null) return bs;
      if (depth <= 0) return quiesce(st, alpha, beta, cfg.qDepth, ply);
      var moves = applyForced(st, candidateMoves(st));
      moves.sort(function (a, b) { return orderScore(b) - orderScore(a); });
      var best = -Infinity, legal = 0;
      for (var i = 0; i < moves.length; i++) {
        var child = E.applyMove(st, moves[i]);
        if (E.inCheck(child, st.turn)) continue;
        legal++;
        if (useNN) child._par = st;
        var sc = -negamax(child, depth - 1, -beta, -alpha, ply + 1);
        if (sc > best) best = sc;
        if (sc > alpha) alpha = sc;
        if (alpha >= beta) break;
      }
      if (!legal) return E.inCheck(st, st.turn) || E.rules.draws.stalemate === 'loss' ? -MATE + ply : 0;
      return best;
    }

    var rootMoves = E.legalMoves(rootState);
    if (!rootMoves.length) return null;
    if (rootMoves.length === 1) return rootMoves[0];
    var scored = rootMoves.map(function (m) { return { m: m, s: orderScore(m) }; });
    var bestMove = null;

    for (var depth = 1; depth <= cfg.depth; depth++) {
      try {
        scored.sort(function (a, b) { return b.s - a.s; });
        var alpha = -Infinity, results = [];
        for (var i = 0; i < scored.length; i++) {
          var child = E.applyMove(rootState, scored[i].m);
          if (useNN) child._par = rootState;
          var sc = seen && seen[E.positionKey(child)] ? 0
            // window widened by 2*noise so every move that could win after
            // adding noise gets an exact score (not just a bound)
            : -negamax(child, depth - 1, -Infinity, -alpha + 2 * cfg.noise + 1, 1);
          results.push({ m: scored[i].m, s: sc });
          if (sc > alpha) alpha = sc;
        }
        scored = results;
        var noisy = results.map(function (x) { return { m: x.m, s: x.s + (Math.random() * 2 - 1) * cfg.noise }; });
        noisy.sort(function (a, b) { return b.s - a.s; });
        bestMove = noisy[0].m;
        if (info) { info.depth = depth; info.score = alpha; info.nodes = nodes; info.scores = results; }
        if (alpha > MATE / 2) break; // found a forced mate
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        break;
      }
    }
    return bestMove || rootMoves[Math.floor(Math.random() * rootMoves.length)];
  }

  /** Load a trained network (object from js/nn-weights.js or a training .json), or null to remove it. */
  function setNetwork(net) { NN = net ? nnMod.create(E, net) : null; }
  function hasNetwork() { return !!NN; }

  return { CONFIG: CONFIG, evaluate: evaluate, chooseMove: search, setNetwork: setNetwork, hasNetwork: hasNetwork };
});
