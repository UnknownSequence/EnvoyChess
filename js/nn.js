/*
 * ============================================================================
 *  ENVOY CHESS — NEURAL-NETWORK EVALUATION
 * ============================================================================
 *  A small neural network that judges a position ("who is better, by how
 *  much?"). It is trained by self-play training scripts (not part of this
 *  repository yet) and its numbers are stored in
 *  js/nn-weights.js. The computer opponent uses it at the "Trained" level.
 *
 *  This file is shared by the game (browser) and the training scripts (Node),
 *  so the inputs the network sees while training are exactly the inputs it
 *  sees while playing.
 *
 *  Network:  inputs -> h1 -> h2 -> 1   (ReLU between layers; sizes are stored
 *            in the weights file, 32 -> 8 by default)
 *    Inputs, always from the point of view of the side to move ("us"):
 *     - one input per (us/them, piece type, square): 2 x 7 x 64 = 896
 *       (the board is mirrored when Black is to move)
 *     - "dense" inputs per side: envoy movement mode (one-hot), envoy may
 *       capture, envoy resting, spare pieces / 15, exactly one spare piece,
 *       strength / 40, has an envoy
 *     - our deficit / 20, half-move clock / 100
 *    Output: a number z; the win chance for the side to move is sigmoid(z).
 *    For the search it is turned into centipawns: z * net.scale.
 *    A "residual" network (net.residual = true, the default from train.py) is
 *    a correction: the bot's score = its handcrafted judgment + z * net.scale.
 * ============================================================================
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.EnvoyNN = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = 'pnbrqke';
  var MAX_PIECES = 32;

  /** Describes the inputs for a given engine (its rules decide the envoy movement names). */
  function featureSpec(E) {
    var moveNames = Object.keys(E.rules.movements).concat(['pending']);
    var perSide = moveNames.length + 6;
    return {
      nSparse: 2 * TYPES.length * 64,
      nDense: 2 * perSide + 2,
      moveNames: moveNames,
      maxPieces: MAX_PIECES,
      version: 'envoy-nn-1:' + TYPES + ':' + moveNames.join(',')
    };
  }

  function newBuffers(spec) {
    return { idx: new Int16Array(spec.maxPieces), nIdx: 0, dense: new Float32Array(spec.nDense) };
  }

  /** Fills `out` (from newBuffers) with the inputs for position `st`. */
  function extract(E, spec, st, out) {
    var us = st.turn, them = E.opp(us), b = st.board, flip = us === 'b' ? 56 : 0, n = 0;
    var only = E.rules.loseWithOnly || [];
    var spare = { w: 0, b: 0 }, hasEnvoy = { w: 0, b: 0 };
    for (var s = 0; s < 64; s++) {
      var p = b[s];
      if (!p) continue;
      var t = TYPES.indexOf(p[1]);
      if (t < 0 || n >= spec.maxPieces) continue;
      out.idx[n++] = ((p[0] === us ? 0 : TYPES.length) + t) * 64 + (s ^ flip);
      if (only.indexOf(p[1]) < 0) spare[p[0]]++;
      if (p[1] === 'e') hasEnvoy[p[0]] = 1;
    }
    for (var j = n; j < spec.maxPieces; j++) out.idx[j] = -1;
    out.nIdx = n;
    var d = out.dense, k = 0, nm = spec.moveNames.length;
    d.fill(0);
    [us, them].forEach(function (c) {
      var info = E.envoyInfo(st, c);
      var mi = spec.moveNames.indexOf(info.movement || 'pending');
      if (mi >= 0) d[k + mi] = 1;
      k += nm;
      d[k++] = info.canCapture ? 1 : 0;
      d[k++] = info.cooldown > 0 ? 1 : 0;
      d[k++] = spare[c] / 15;
      d[k++] = spare[c] === 1 ? 1 : 0;
      d[k++] = info.strength / 40;
      d[k++] = hasEnvoy[c];
    });
    d[k++] = E.deficit(st, us) / 20;
    d[k++] = Math.min(st.halfmove, 100) / 100;
    return out;
  }

  /** Turns weights loaded from JSON into typed arrays (done once). */
  function prepare(net) {
    if (net._prepared) return net._prepared;
    var f = function (a) { return a instanceof Float32Array ? a : Float32Array.from(a); };
    var p = {
      nSparse: net.nSparse, nDense: net.nDense, h1: net.h1, h2: net.h2, scale: net.scale || 300,
      W1s: f(net.W1s), W1d: f(net.W1d), b1: f(net.b1), W2: f(net.W2), b2: f(net.b2), W3: f(net.W3), b3: net.b3,
      a1: new Float32Array(net.h1), a2: new Float32Array(net.h2)
    };
    Object.defineProperty(net, '_prepared', { value: p, enumerable: false });
    return p;
  }

  /** Raw network output z (win chance for side to move = sigmoid(z)). */
  function forward(net, feats) {
    var p = prepare(net), H1 = p.h1, H2 = p.h2, a1 = p.a1, a2 = p.a2, h, o, i, off;
    a1.set(p.b1);
    for (i = 0; i < feats.nIdx; i++) {
      off = feats.idx[i] * H1;
      for (h = 0; h < H1; h++) a1[h] += p.W1s[off + h];
    }
    var d = feats.dense;
    for (i = 0; i < p.nDense; i++) {
      var v = d[i];
      if (v === 0) continue;
      off = i * H1;
      for (h = 0; h < H1; h++) a1[h] += v * p.W1d[off + h];
    }
    for (h = 0; h < H1; h++) if (a1[h] < 0) a1[h] = 0;
    a2.set(p.b2);
    for (h = 0; h < H1; h++) {
      var x = a1[h];
      if (x === 0) continue;
      off = h * H2;
      for (o = 0; o < H2; o++) a2[o] += x * p.W2[off + o];
    }
    var z = p.b3;
    for (o = 0; o < H2; o++) if (a2[o] > 0) z += a2[o] * p.W3[o];
    return z;
  }

  /**
   * An evaluator bound to one engine and one network:
   *   ev.cp(st) -> score in centipawns for the side to move.
   */
  function create(E, net) {
    var spec = featureSpec(E);
    if (net.featureVersion && net.featureVersion !== spec.version) {
      throw new Error('Network was trained for different inputs (' + net.featureVersion + ') than this game uses (' + spec.version + '). Retrain it.');
    }
    var buf = newBuffers(spec), scale = net.scale || 300;
    return {
      spec: spec,
      net: net,
      residual: !!net.residual,
      correction: function (st) {
        var v = forward(net, extract(E, spec, st, buf)) * scale;
        return v > 3000 ? 3000 : v < -3000 ? -3000 : v;
      },
      logit: function (st) { return forward(net, extract(E, spec, st, buf)); },
      cp: function (st) {
        var v = forward(net, extract(E, spec, st, buf)) * scale;
        return v > 5000 ? 5000 : v < -5000 ? -5000 : v;
      }
    };
  }

  return { featureSpec: featureSpec, newBuffers: newBuffers, extract: extract, forward: forward, prepare: prepare, create: create };
});
