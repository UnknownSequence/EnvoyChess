/*
 * Trained network for the "4 · Trained" computer level (see js/nn.js).
 * null = no network yet; the Trained level is then hidden.
 */
(function (root) {
  var W = null;
  if (typeof module === 'object' && module.exports) module.exports = W; else root.EnvoyNNWeights = W;
})(typeof self !== 'undefined' ? self : this);
