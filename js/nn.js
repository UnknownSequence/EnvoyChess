/*
 * ============================================================================
 *  ENVOY CHESS — NEURAL-NETWORK EVALUATION (NNUE-style)
 * ============================================================================
 *  A neural network that judges a position ("who is better, by how much?").
 *  It is trained by the scripts in "Envoy Chess bot training" and its numbers
 *  are stored in js/nn-weights.js. The computer opponent uses it at the
 *  "4 · Trained" level.
 *
 *  This file is shared by the game (browser) and the training scripts (Node),
 *  so the network sees exactly the same inputs while training and playing.
 *
 *  Design (in the spirit of Stockfish's NNUE):
 *
 *    board ──► 896 piece-square inputs, seen from WHITE's side ──► accumulator A_w (H1)
 *          └─► 896 piece-square inputs, seen from BLACK's side ──► accumulator A_b (H1)
 *              (both use the same weights W1; one input per
 *               {mine / theirs} x {p n b r q k e} x {square}, board mirrored for Black)
 *
 *    [ crelu(A_side-to-move), crelu(A_other), dense ] ─► H2 ─► crelu ─► H3 ─► crelu ─► z
 *
 *    crelu(x) = min(max(x, 0), 1)  ("clipped ReLU")
 *    dense    = envoy state for both sides (movement mode, may capture, in
 *               hand), spare pieces, strength, the strength gap, 50-move clock
 *
 *  Accumulators are updated INCREMENTALLY during the search: a child position
 *  copies its parent's accumulators and only adds/subtracts the columns of the
 *  few squares that changed, instead of summing ~34 columns from scratch.
 *
 *  Output z is a logit: win chance for the side to move = sigmoid(z).
 *  A residual network (net.residual = true) is a CORRECTION on top of the
 *  handcrafted judgment: score = handcrafted + z x net.scale (centipawns).
 * ============================================================================
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.EnvoyNN = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = 'pnbrqke';
  var NT = TYPES.length;          // 7 piece types
  var MAX_PIECES = 34;            // 32 chessmen + 2 envoys
  var N_SPARSE = 2 * NT * 64;     // 896
  var TIDX = {};
  for (var ti = 0; ti < NT; ti++) TIDX[TYPES[ti]] = ti;

  /** Index of the input for `piece` on square `sq`, seen from colour `view`. */
  function featureIndex(view, piece, sq) {
    return ((piece[0] === view ? 0 : NT) + TIDX[piece[1]]) * 64 + (view === 'b' ? sq ^ 56 : sq);
  }

  /** The same input seen from the other side (swap mine/theirs, mirror the board). */
  var OTHER = new Int32Array(N_SPARSE);
  for (var f = 0; f < N_SPARSE; f++) {
    var side = f >= NT * 64 ? 1 : 0, t = Math.floor(f / 64) % NT, sq = f & 63;
    OTHER[f] = ((1 - side) * NT + t) * 64 + (sq ^ 56);
  }

  /** Describes the inputs for a given engine (its rules decide the envoy movement names). */
  function featureSpec(E) {
    var moveNames = Object.keys(E.rules.movements).concat(['pending', 'hand']);
    var perSide = moveNames.length + 5;
    return {
      nSparse: N_SPARSE,
      nDense: 2 * perSide + 2,
      moveNames: moveNames,
      maxPieces: MAX_PIECES,
      version: 'envoy-nnue-1:' + TYPES + ':' + moveNames.join(',')
    };
  }

  function newBuffers(spec) {
    return { idx: new Int16Array(spec.maxPieces), nIdx: 0, dense: new Float32Array(spec.nDense) };
  }

  /** Dense inputs (from the side to move's point of view) into `d`. */
  function fillDense(E, spec, st, d) {
    var us = st.turn, them = E.opp(us), only = E.rules.loseWithOnly || [];
    var spare = { w: 0, b: 0 }, b = st.board;
    for (var s = 0; s < 64; s++) { var p = b[s]; if (p && only.indexOf(p[1]) < 0) spare[p[0]]++; }
    var k = 0, nm = spec.moveNames.length;
    d.fill(0);
    [us, them].forEach(function (c) {
      var inHand = st.inHand && st.inHand[c];
      var info = E.envoyInfo(st, c);
      var mi = spec.moveNames.indexOf(inHand ? 'hand' : (info.movement || 'pending'));
      if (mi >= 0) d[k + mi] = 1;
      k += nm;
      d[k++] = info.canCapture ? 1 : 0;
      d[k++] = spare[c] / 15;
      d[k++] = spare[c] === 1 ? 1 : 0;
      d[k++] = info.strength / 40;
      d[k++] = Math.max(-1, Math.min(1, info.powerDeficit / 20));
    });
    d[k++] = Math.max(-1, Math.min(1, E.deficit(st, us) / 20));
    d[k++] = Math.min(st.halfmove, 100) / 100;
    return d;
  }

  /** Fills `out` (from newBuffers) with the inputs for position `st` (side-to-move view). */
  function extract(E, spec, st, out) {
    var us = st.turn, b = st.board, n = 0;
    for (var s = 0; s < 64; s++) {
      var p = b[s];
      if (!p || n >= spec.maxPieces) continue;
      out.idx[n++] = featureIndex(us, p, s);
    }
    for (var j = n; j < spec.maxPieces; j++) out.idx[j] = -1;
    out.nIdx = n;
    fillDense(E, spec, st, out.dense);
    return out;
  }

  /** Turns weights loaded from JSON into typed arrays (done once). */
  var netCount = 0;
  function prepare(net) {
    if (net._prepared) return net._prepared;
    var f = function (a) { return a instanceof Float32Array ? a : Float32Array.from(a); };
    var p = {
      nDense: net.nDense, h1: net.h1, h2: net.h2, h3: net.h3, scale: net.scale || 300,
      W1: f(net.W1), b1: f(net.b1), W2: f(net.W2), b2: f(net.b2), W3: f(net.W3), b3: f(net.b3), W4: f(net.W4), b4: net.b4,
      key: '_acc' + (++netCount),
      x: new Float32Array(2 * net.h1 + net.nDense), a2: new Float32Array(net.h2), a3: new Float32Array(net.h3)
    };
    Object.defineProperty(net, '_prepared', { value: p, enumerable: false });
    return p;
  }

  function addCol(acc, W, f, H) { var off = f * H; for (var h = 0; h < H; h++) acc[h] += W[off + h]; }
  function subCol(acc, W, f, H) { var off = f * H; for (var h = 0; h < H; h++) acc[h] -= W[off + h]; }

  /** Both accumulators from scratch. */
  function fullAcc(p, board) {
    var H = p.h1, aw = Float32Array.from(p.b1), ab = Float32Array.from(p.b1);
    for (var s = 0; s < 64; s++) {
      var pc = board[s];
      if (!pc) continue;
      addCol(aw, p.W1, featureIndex('w', pc, s), H);
      addCol(ab, p.W1, featureIndex('b', pc, s), H);
    }
    return { w: aw, b: ab };
  }

  /**
   * Accumulators of `st`, cached on the position. If the search linked the
   * position to its parent (st._par), only the changed squares are updated.
   */
  function accumulators(p, st) {
    var key = p.key, acc = st[key];
    if (acc) return acc;
    var par = st._par;
    if (par) {
      var pa = accumulators(p, par), H = p.h1, ob = par.board, nb = st.board;
      acc = { w: Float32Array.from(pa.w), b: Float32Array.from(pa.b) };
      for (var s = 0; s < 64; s++) {
        var was = ob[s], now = nb[s];
        if (was === now) continue;
        if (was) { subCol(acc.w, p.W1, featureIndex('w', was, s), H); subCol(acc.b, p.W1, featureIndex('b', was, s), H); }
        if (now) { addCol(acc.w, p.W1, featureIndex('w', now, s), H); addCol(acc.b, p.W1, featureIndex('b', now, s), H); }
      }
    } else acc = fullAcc(p, st.board);
    st[key] = acc;   // cached per network (two bots may search the same position)
    return acc;
  }

  /** Layers after the accumulators. `accUs`/`accThem` are H1 vectors, `dense` the dense inputs. */
  function head(p, accUs, accThem, dense) {
    var H1 = p.h1, H2 = p.h2, H3 = p.h3, x = p.x, a2 = p.a2, a3 = p.a3, i, o, v, off;
    for (i = 0; i < H1; i++) {
      v = accUs[i]; x[i] = v < 0 ? 0 : v > 1 ? 1 : v;
      v = accThem[i]; x[H1 + i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    for (i = 0; i < p.nDense; i++) x[2 * H1 + i] = dense[i];
    a2.set(p.b2);
    var nx = 2 * H1 + p.nDense;
    for (i = 0; i < nx; i++) {
      v = x[i];
      if (v === 0) continue;
      off = i * H2;
      for (o = 0; o < H2; o++) a2[o] += v * p.W2[off + o];
    }
    a3.set(p.b3);
    for (i = 0; i < H2; i++) {
      v = a2[i]; v = v < 0 ? 0 : v > 1 ? 1 : v;
      if (v === 0) continue;
      off = i * H3;
      for (o = 0; o < H3; o++) a3[o] += v * p.W3[off + o];
    }
    var z = p.b4;
    for (o = 0; o < H3; o++) { v = a3[o]; v = v < 0 ? 0 : v > 1 ? 1 : v; z += v * p.W4[o]; }
    return z;
  }

  /** Raw output z for extracted inputs (used to check the training code; no incremental update). */
  function forward(net, feats) {
    var p = prepare(net), H = p.h1, aUs = Float32Array.from(p.b1), aThem = Float32Array.from(p.b1);
    for (var i = 0; i < feats.nIdx; i++) {
      var fi = feats.idx[i];
      addCol(aUs, p.W1, fi, H);
      addCol(aThem, p.W1, OTHER[fi], H);
    }
    return head(p, aUs, aThem, feats.dense);
  }

  /**
   * An evaluator bound to one engine and one network:
   *   ev.correction(st) / ev.cp(st) -> centipawns for the side to move.
   */
  function create(E, net) {
    var spec = featureSpec(E);
    if (net.featureVersion !== spec.version) {
      throw new Error('Network was trained for different inputs (' + net.featureVersion + ') than this game uses (' + spec.version + '). Retrain it.');
    }
    var p = prepare(net), dense = new Float32Array(spec.nDense), scale = p.scale;
    // the largest correction the search may apply: limits how far it can exploit network mistakes
    var maxC = net.maxCorrection || 3000;
    function logit(st) {
      var acc = accumulators(p, st), us = st.turn;
      return head(p, us === 'w' ? acc.w : acc.b, us === 'w' ? acc.b : acc.w, fillDense(E, spec, st, dense));
    }
    return {
      spec: spec,
      net: net,
      residual: !!net.residual,
      logit: logit,
      correction: function (st) { var v = logit(st) * scale; return v > maxC ? maxC : v < -maxC ? -maxC : v; },
      cp: function (st) { var v = logit(st) * scale; return v > 5000 ? 5000 : v < -5000 ? -5000 : v; }
    };
  }

  return { featureSpec: featureSpec, featureIndex: featureIndex, OTHER: OTHER, newBuffers: newBuffers, extract: extract,
    fillDense: fillDense, forward: forward, prepare: prepare, create: create };
});
