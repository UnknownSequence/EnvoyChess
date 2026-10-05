/*
 * ============================================================================
 *  ENVOY CHESS — GAME ENGINE
 * ============================================================================
 *  Pure game logic: no drawing, no clicks. Works in the browser (as
 *  window.EnvoyEngine) and in Node (require('./engine.js')).
 *
 *  All variant-specific numbers come from rules.js. To try different rules
 *  you normally only edit rules.js. For a different rule *mechanism*, the
 *  functions are grouped by topic below:
 *     1. Board helpers / FEN
 *     2. Strength & envoy status       <- envoyInfo() is the heart of the variant
 *     3. Attacks & check
 *     4. Move generation
 *     5. Making moves (cooldown, declarations, castling rights ...)
 *     6. Notation (SAN)
 *     7. Game object (history, repetition, results)
 *
 *  Squares are numbers 0..63: a1 = 0, b1 = 1, ... h1 = 7, a2 = 8, ... h8 = 63.
 *  Pieces are 2-letter strings: colour + type, e.g. 'wp', 'bq', 'we'.
 * ============================================================================
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var rules = isNode ? require('./rules.js') : root.EnvoyRules;
  var api = factory(rules);
  if (isNode) module.exports = api; else root.EnvoyEngine = api;
})(typeof self !== 'undefined' ? self : this, function (DEFAULT_RULES) {
  'use strict';

  function create(R) {
    var FILES = 'abcdefgh';
    var COLORS = ['w', 'b'];

    // ------------------------------------------------------------------
    // 1. Board helpers / FEN
    // ------------------------------------------------------------------
    function opp(c) { return c === 'w' ? 'b' : 'w'; }
    function sqName(s) { return FILES[s & 7] + ((s >> 3) + 1); }
    function parseSq(n) { return FILES.indexOf(n[0]) + (parseInt(n[1], 10) - 1) * 8; }
    function onBoard(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }

    /*
     * FEN with two optional extension fields for the envoy:
     *   7th field: envoy cooldowns  "w,b"   e.g. "1,0"
     *   8th field: declarations     "w,b"   e.g. "knight,-"
     *   9th field: envoys still in hand (not yet placed)  e.g. "Ee", "e" or "-"
     *  10th field: material each side has sacrificed "w,b" e.g. "1,0"
     */
    function fromFEN(fen) {
      var parts = fen.trim().split(/\s+/);
      var board = new Array(64).fill(null);
      var rows = parts[0].split('/');
      if (rows.length !== 8) throw new Error('Bad FEN: ' + fen);
      for (var i = 0; i < 8; i++) {
        var r = 7 - i, f = 0;
        for (var j = 0; j < rows[i].length; j++) {
          var ch = rows[i][j];
          if (/[1-8]/.test(ch)) { f += parseInt(ch, 10); continue; }
          var color = ch === ch.toUpperCase() ? 'w' : 'b';
          board[r * 8 + f] = color + ch.toLowerCase();
          f++;
        }
      }
      var cast = parts[2] || '-';
      var cd = (parts[6] || '0,0').split(',');
      var dc = (parts[7] || '-,-').split(',');
      var hand = parts[8] || '-';
      var sc = (parts[9] || '0,0').split(',');
      var st = {
        board: board,
        turn: parts[1] || 'w',
        castling: { K: cast.indexOf('K') >= 0, Q: cast.indexOf('Q') >= 0, k: cast.indexOf('k') >= 0, q: cast.indexOf('q') >= 0 },
        ep: parts[3] && parts[3] !== '-' ? parseSq(parts[3]) : -1,
        halfmove: parseInt(parts[4] || '0', 10),
        fullmove: parseInt(parts[5] || '1', 10),
        cooldown: { w: parseInt(cd[0], 10) || 0, b: parseInt(cd[1], 10) || 0 },
        declared: { w: dc[0] && dc[0] !== '-' ? dc[0] : null, b: dc[1] && dc[1] !== '-' ? dc[1] : null },
        inHand: { w: hand.indexOf('E') >= 0 ? 1 : 0, b: hand.indexOf('e') >= 0 ? 1 : 0 },
        sacrificed: { w: parseInt(sc[0], 10) || 0, b: parseInt(sc[1], 10) || 0 },
        lastMove: null,
        lastCapture: false
      };
      st.str = null;
      st.str = { w: strength(st, 'w'), b: strength(st, 'b') };
      normalizeDeclarations(st);
      return st;
    }

    function toFEN(st, withEnvoyFields) {
      var rows = [];
      for (var r = 7; r >= 0; r--) {
        var row = '', empty = 0;
        for (var f = 0; f < 8; f++) {
          var p = st.board[r * 8 + f];
          if (!p) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          row += p[0] === 'w' ? p[1].toUpperCase() : p[1];
        }
        if (empty) row += empty;
        rows.push(row);
      }
      var c = st.castling;
      var cast = (c.K ? 'K' : '') + (c.Q ? 'Q' : '') + (c.k ? 'k' : '') + (c.q ? 'q' : '') || '-';
      var fen = rows.join('/') + ' ' + st.turn + ' ' + cast + ' ' + (st.ep >= 0 ? sqName(st.ep) : '-') +
        ' ' + st.halfmove + ' ' + st.fullmove;
      if (withEnvoyFields !== false) {
        fen += ' ' + st.cooldown.w + ',' + st.cooldown.b + ' ' + (st.declared.w || '-') + ',' + (st.declared.b || '-');
        var sac = st.sacrificed || { w: 0, b: 0 };
        if (st.inHand.w || st.inHand.b || sac.w || sac.b) fen += ' ' + ((st.inHand.w ? 'E' : '') + (st.inHand.b ? 'e' : '') || '-');
        if (sac.w || sac.b) fen += ' ' + sac.w + ',' + sac.b;
      }
      return fen;
    }

    function findKing(st, c) {
      for (var i = 0; i < 64; i++) if (st.board[i] === c + 'k') return i;
      return -1;
    }
    function hasEnvoy(st, c) {
      for (var i = 0; i < 64; i++) if (st.board[i] === c + 'e') return true;
      return false;
    }

    // ------------------------------------------------------------------
    // 2. Strength & envoy status
    // ------------------------------------------------------------------
    function strength(st, c) {
      if (st.str) return st.str[c];
      var s = 0;
      for (var i = 0; i < 64; i++) {
        var p = st.board[i];
        if (p && p[0] === c) s += R.pieceValues[p[1]] || 0;
      }
      return s;
    }
    /** How much weaker side c is than its opponent (negative = stronger). */
    function deficit(st, c) { return strength(st, opp(c)) - strength(st, c); }

    /**
     * The deficit that powers the envoy.
     *  - Unless envoy.ownSacrificesPower is true, material side c sacrificed
     *    itself is not counted, so sacrificing cannot grow your own envoy, while
     *    every piece the opponent captures always raises it.
     *  - With envoy.powerCap set (old rule), it is at most powerCap x (your own
     *    strength).
     */
    function powerDeficit(st, c) {
      var d = deficit(st, c), cap = R.envoy.powerCap;
      if (!R.envoy.ownSacrificesPower && st.sacrificed) d -= st.sacrificed[c] || 0;
      if (cap != null) d = Math.min(d, cap * strength(st, c));
      return d;
    }
    /** The tier for a given (power) deficit. */
    function tierAt(d) {
      var tiers = R.envoy.tiers;
      for (var i = 0; i < tiers.length; i++) if (d >= tiers[i].minDeficit) return tiers[i];
      return tiers[tiers.length - 1];
    }
    function tierFor(st, c) { return tierAt(powerDeficit(st, c)); }

    var compCache = {};
    function componentsOf(names) {
      var key = names.join('+');
      if (compCache[key]) return compCache[key];
      var out = [];
      names.forEach(function (n) {
        if (!R.movements[n]) throw new Error('Unknown movement "' + n + '" in rules.js');
        out = out.concat(R.movements[n]);
      });
      compCache[key] = out;
      return out;
    }

    /**
     * Everything about one side's envoy right now:
     *   deficit, tier, movement (name or null while a declaration is pending),
     *   pending (must declare), canCapture, cooldown, ready,
     *   moveComponents (how it moves), checkComponents (how it gives check).
     * Cached per position because it is used constantly.
     */
    function envoyInfo(st, c) {
      if (!st._cache) Object.defineProperty(st, '_cache', { value: {}, enumerable: false, writable: true });
      var key = 'env' + c;
      if (st._cache[key]) return st._cache[key];
      var s = strength(st, c), os = strength(st, opp(c)), d = os - s, pd = powerDeficit(st, c);
      var tier = tierFor(st, c);
      var movement = null, pending = false;
      if (tier.movement === 'choice') {
        var dec = st.declared[c];
        if (dec && tier.options.indexOf(dec) >= 0) movement = dec; else pending = true;
      } else {
        movement = tier.movement;
      }
      var checkComps;
      if (movement) checkComps = componentsOf([movement]);
      else if (R.envoy.undeclaredCheckPattern === 'union') checkComps = componentsOf(tier.options);
      else checkComps = componentsOf([R.envoy.undeclaredCheckPattern || 'king']);
      var info = {
        color: c,
        strength: s,
        opponentStrength: os,
        deficit: d,
        tier: tier,
        movement: movement,
        pending: pending,
        powerDeficit: pd,
        sacrificed: st.sacrificed ? st.sacrificed[c] : 0,
        canCapture: pd >= R.envoy.captureMinDeficit,
        cooldown: st.cooldown[c],
        ready: st.cooldown[c] <= 0,
        moveComponents: movement ? componentsOf([movement]) : null,
        checkComponents: checkComps
      };
      st._cache[key] = info;
      return info;
    }

    /** Side to move must pick a movement for its envoy before moving. */
    function needsDeclaration(st) {
      if (R.envoy.chooseBy === 'move') return false;   // chosen by the envoy's first move instead
      return envoyInfo(st, st.turn).pending && hasEnvoy(st, st.turn);
    }

    function normalizeDeclarations(st) {
      COLORS.forEach(function (c) {
        var t = tierFor(st, c);
        if (t.movement !== 'choice' || (st.declared[c] && t.options.indexOf(st.declared[c]) < 0)) st.declared[c] = null;
      });
    }

    // ------------------------------------------------------------------
    // 3. Attacks & check
    // ------------------------------------------------------------------
    /** Does a piece with these movement components on `from` attack `to`? */
    function componentsAttack(board, from, to, comps) {
      var ff = from & 7, fr = from >> 3, dx = (to & 7) - ff, dy = (to >> 3) - fr;
      for (var c = 0; c < comps.length; c++) {
        var comp = comps[c], k, i;
        if (comp.leap) {
          for (i = 0; i < comp.leap.length; i++) if (comp.leap[i][0] === dx && comp.leap[i][1] === dy) return true;
        }
        if (comp.slide) {
          for (i = 0; i < comp.slide.length; i++) {
            var x = comp.slide[i][0], y = comp.slide[i][1];
            k = x !== 0 ? dx / x : dy / y;
            if (!(k > 0) || k !== Math.floor(k) || k * x !== dx || k * y !== dy) continue;
            var clear = true;
            for (var s = 1; s < k; s++) {
              if (board[(fr + s * y) * 8 + (ff + s * x)]) { clear = false; break; }
            }
            if (clear) return true;
          }
        }
      }
      return false;
    }

    /** Is square `target` attacked by side `by`? (Envoy attacks count as check.) */
    function isAttacked(st, target, by) {
      var b = st.board;
      for (var i = 0; i < 64; i++) {
        var p = b[i];
        if (!p || p[0] !== by) continue;
        var t = p[1];
        if (t === 'p') {
          var dir = by === 'w' ? 1 : -1;
          if ((target >> 3) - (i >> 3) === dir && Math.abs((target & 7) - (i & 7)) === 1) return true;
        } else if (t === 'e') {
          if (!ruleApplies(R.envoy.givesCheck, st, by)) continue;
          if (componentsAttack(b, i, target, envoyInfo(st, by).checkComponents)) return true;
        } else {
          if (componentsAttack(b, i, target, R.movements[R.pieceMovement[t]])) return true;
        }
      }
      return false;
    }

    function inCheck(st, c) {
      var k = findKing(st, c);
      return k >= 0 && isAttacked(st, k, opp(c));
    }

    // ------------------------------------------------------------------
    // 4. Move generation
    // ------------------------------------------------------------------
    /** true / false / 'whenArmed' (only while that envoy may itself capture) */
    function ruleApplies(setting, st, c) {
      if (setting === 'whenArmed') return envoyInfo(st, c).canCapture;
      return !!setting;
    }
    function capturable(p, st) {
      if (!p) return false;
      if (p[1] === 'k') return false;
      if (p[1] === 'e') return ruleApplies(R.envoy.capturable, st, p[0]);
      return true;
    }

    function genComponents(st, from, comps, allowCapture, moves) {
      var b = st.board, us = b[from][0], ff = from & 7, fr = from >> 3, seen = {};
      function add(to, cap) {
        if (seen[to]) return;
        seen[to] = 1;
        moves.push({ from: from, to: to, piece: b[from], captured: cap || null });
      }
      comps.forEach(function (comp) {
        if (comp.leap) comp.leap.forEach(function (d) {
          var f = ff + d[0], r = fr + d[1];
          if (!onBoard(f, r)) return;
          var to = r * 8 + f, tp = b[to];
          if (!tp) add(to);
          else if (tp[0] !== us && allowCapture && capturable(tp, st)) add(to, tp);
        });
        if (comp.slide) comp.slide.forEach(function (d) {
          var f = ff + d[0], r = fr + d[1];
          while (onBoard(f, r)) {
            var to = r * 8 + f, tp = b[to];
            if (!tp) add(to);
            else { if (tp[0] !== us && allowCapture && capturable(tp, st)) add(to, tp); break; }
            f += d[0]; r += d[1];
          }
        });
      });
    }

    function genPawn(st, from, moves) {
      var b = st.board, us = b[from][0], them = opp(us);
      var dir = us === 'w' ? 1 : -1, start = us === 'w' ? 1 : 6, last = us === 'w' ? 7 : 0;
      var f = from & 7, r = from >> 3;
      function add(to, cap, extra) {
        if ((to >> 3) === last) {
          R.promotionPieces.forEach(function (pp) {
            moves.push({ from: from, to: to, piece: b[from], captured: cap || null, promotion: pp });
          });
        } else {
          var m = { from: from, to: to, piece: b[from], captured: cap || null };
          if (extra) for (var k in extra) m[k] = extra[k];
          moves.push(m);
        }
      }
      if (!onBoard(f, r + dir)) return;
      var one = from + 8 * dir;
      if (!b[one]) {
        add(one);
        if (r === start && !b[one + 8 * dir]) add(one + 8 * dir, null, { double: true });
      }
      [-1, 1].forEach(function (df) {
        var nf = f + df;
        if (nf < 0 || nf > 7) return;
        var to = (r + dir) * 8 + nf, tp = b[to];
        if (tp && tp[0] === them && capturable(tp, st)) add(to, tp);
        else if (!tp && to === st.ep) add(to, them + 'p', { ep: true });
      });
    }

    function genCastling(st, from, moves) {
      var us = st.turn, them = opp(us), b = st.board, c = st.castling;
      var home = us === 'w' ? 4 : 60;
      if (from !== home) return;
      var K = us === 'w' ? c.K : c.k, Q = us === 'w' ? c.Q : c.q;
      if (!K && !Q) return;
      if (isAttacked(st, home, them)) return;
      if (K && b[home + 3] === us + 'r' && !b[home + 1] && !b[home + 2] &&
          !isAttacked(st, home + 1, them) && !isAttacked(st, home + 2, them)) {
        moves.push({ from: home, to: home + 2, piece: us + 'k', captured: null, castle: 'K' });
      }
      if (Q && b[home - 4] === us + 'r' && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
          !isAttacked(st, home - 1, them) && !isAttacked(st, home - 2, them)) {
        moves.push({ from: home, to: home - 2, piece: us + 'k', captured: null, castle: 'Q' });
      }
    }

    /** Squares where side c may place an envoy it still holds (see rules.envoyDrop). */
    function dropSquares(st, c) {
      var d = R.envoyDrop, out = [];
      if (!d || !d.enabled || !st.inHand[c]) return out;
      var ranks = d.ranks[c], minD = R.envoy.minKingDistance, ek = minD ? findKing(st, opp(c)) : -1;
      for (var i = 0; i < 64; i++) {
        if (st.board[i] || ranks.indexOf((i >> 3) + 1) < 0) continue;
        if (ek >= 0 && Math.max(Math.abs((i & 7) - (ek & 7)), Math.abs((i >> 3) - (ek >> 3))) < minD) continue;
        out.push(i);
      }
      return out;
    }

    function pseudoMoves(st) {
      var moves = [], b = st.board, us = st.turn;
      // ENVOY DROP: while your envoy is still in hand, placing it is your only move
      var drops = dropSquares(st, us);
      if (drops.length) {
        return drops.map(function (sq) { return { from: sq, to: sq, piece: us + 'e', captured: null, drop: true }; });
      }
      for (var i = 0; i < 64; i++) {
        var p = b[i];
        if (!p || p[0] !== us) continue;
        var t = p[1];
        if (t === 'p') genPawn(st, i, moves);
        else if (t === 'e') {
          var info = envoyInfo(st, us);
          var choosing = info.ready && info.pending && R.envoy.chooseBy === 'move';
          if (info.ready && (info.moveComponents || choosing)) {
            var before = moves.length;
            if (choosing) {
              // not chosen yet: it may move like any option; the move it makes fixes the choice
              // (a square that several options reach, e.g. a king step, fixes nothing)
              var byTo = {}, order = [];
              info.tier.options.forEach(function (opt) {
                var part = [];
                genComponents(st, i, componentsOf([opt]), info.canCapture, part);
                part.forEach(function (m) {
                  if (!byTo[m.to]) { byTo[m.to] = { m: m, opts: [] }; order.push(m.to); }
                  if (byTo[m.to].opts.indexOf(opt) < 0) byTo[m.to].opts.push(opt);
                });
              });
              order.forEach(function (to) {
                var e = byTo[to];
                if (e.opts.length === 1) e.m.declare = e.opts[0];
                moves.push(e.m);
              });
            } else genComponents(st, i, info.moveComponents, info.canCapture, moves);
            var minD = R.envoy.minKingDistance, ek = minD ? findKing(st, opp(us)) : -1;
            if (ek >= 0) {
              // "diplomatic distance": the envoy may not step this close to the enemy king
              var kept = moves.slice(0, before).concat(moves.slice(before).filter(function (m) {
                return Math.max(Math.abs((m.to & 7) - (ek & 7)), Math.abs((m.to >> 3) - (ek >> 3))) >= minD;
              }));
              moves.length = 0; Array.prototype.push.apply(moves, kept);
            }
          }
        } else {
          genComponents(st, i, R.movements[R.pieceMovement[t]], true, moves);
          if (t === 'k') genCastling(st, i, moves);
        }
      }
      // sacrifice: remove one of your own pieces instead of moving
      var sac = R.sacrifice;
      if (sac && sac.enabled && !inCheck(st, us)) {
        for (var j = 0; j < 64; j++) {
          var q = b[j];
          if (q && q[0] === us && sac.pieces.indexOf(q[1]) >= 0) moves.push({ from: j, to: j, piece: q, captured: null, sacrifice: true });
        }
      }
      return moves;
    }

    function withDeclaration(st, option) {
      var n = cloneState(st);
      n.declared[st.turn] = option;
      return n;
    }

    /**
     * All legal moves. If the side to move still has to declare its envoy's
     * movement, every move is returned once per option with `declare` set.
     */
    function legalMoves(st) {
      if (needsDeclaration(st)) {
        var all = [];
        envoyInfo(st, st.turn).tier.options.forEach(function (opt) {
          legalMovesNoDecl(withDeclaration(st, opt)).forEach(function (m) { m.declare = opt; all.push(m); });
        });
        return all;
      }
      return legalMovesNoDecl(st);
    }

    function legalMovesNoDecl(st) {
      var us = st.turn;
      var legal = pseudoMoves(st).filter(function (m) { return !inCheck(applyMove(st, m), us); });
      if (mustCapture(st, legal)) legal = legal.filter(isForcingCapture);
      return legal;
    }

    /** Does this capture make captures compulsory ("weaker piece takes stronger piece")? */
    function isForcingCapture(m) {
      if (!m.captured) return false;
      if (R.forcedCapture !== 'upward') return true;
      if ((R.forcedCaptureExempt || []).indexOf(m.piece[1]) >= 0) return false;
      return (R.pieceValues[m.piece[1]] || 0) < (R.pieceValues[m.captured[1]] || 0);
    }

    /** Compulsory capture: true if the side to move must capture now. */
    function mustCapture(st, legal) {
      if (!R.forcedCapture || inCheck(st, st.turn)) return false;
      return legal.some(isForcingCapture);
    }

    /** Colour that has only `loseWithOnly` pieces left (and so has lost), or null. */
    function bareSide(st) {
      var only = R.loseWithOnly;
      if (!only) return null;
      var has = { w: false, b: false };
      for (var i = 0; i < 64; i++) {
        var p = st.board[i];
        if (p && only.indexOf(p[1]) < 0) has[p[0]] = true;
      }
      // the side that just moved cannot have lost pieces this turn, so check the side to move first
      if (!has[st.turn]) return st.turn;
      if (!has[opp(st.turn)]) return opp(st.turn);
      return null;
    }
    /** Number of pieces a side has besides the `loseWithOnly` ones. */
    function spareCount(st, c) {
      var only = R.loseWithOnly || [], n = 0;
      for (var i = 0; i < 64; i++) { var p = st.board[i]; if (p && p[0] === c && only.indexOf(p[1]) < 0) n++; }
      return n;
    }

    // ------------------------------------------------------------------
    // 5. Making moves
    // ------------------------------------------------------------------
    function cloneState(st) {
      return {
        board: st.board.slice(),
        turn: st.turn,
        castling: { K: st.castling.K, Q: st.castling.Q, k: st.castling.k, q: st.castling.q },
        ep: st.ep,
        halfmove: st.halfmove,
        fullmove: st.fullmove,
        cooldown: { w: st.cooldown.w, b: st.cooldown.b },
        declared: { w: st.declared.w, b: st.declared.b },
        inHand: { w: st.inHand.w, b: st.inHand.b },
        sacrificed: { w: st.sacrificed.w, b: st.sacrificed.b },
        lastMove: st.lastMove,
        lastCapture: st.lastCapture,
        str: st.str ? { w: st.str.w, b: st.str.b } : null
      };
    }

    /** Returns the new position after move m (m is assumed legal). */
    function applyMove(st, m) {
      var us = st.turn, them = opp(us);
      var n = cloneState(st);
      var b = n.board, piece = b[m.from];
      if (m.declare) n.declared[us] = m.declare;

      if (m.drop) {                            // the envoy is placed on the board
        b[m.to] = m.piece;
        n.inHand[us] = 0;
        n.turn = them; n.ep = -1; n.halfmove = st.halfmove + 1;
        if (us === 'b') n.fullmove++;
        n.lastMove = { from: m.to, to: m.to, drop: true };
        n.lastCapture = false;
        if (n.cooldown[us] > 0) n.cooldown[us]--;
        normalizeDeclarations(n);
        return n;
      }

      if (m.sacrifice) {                       // the piece simply leaves the board
        b[m.from] = null;
        if (n.str) n.str[us] -= R.pieceValues[piece[1]] || 0;
        n.sacrificed[us] += R.pieceValues[piece[1]] || 0;
        n.turn = them; n.ep = -1; n.halfmove = 0;
        if (us === 'b') n.fullmove++;
        n.lastMove = { from: m.from, to: m.from, sacrifice: true };
        n.lastCapture = false;
        if (m.from === 0) n.castling.Q = false;
        if (m.from === 7) n.castling.K = false;
        if (m.from === 56) n.castling.q = false;
        if (m.from === 63) n.castling.k = false;
        if (n.cooldown[us] > 0) n.cooldown[us]--;
        // a sacrifice freezes the enemy envoy for its next turn(s)
        var freeze = (R.sacrifice && R.sacrifice.freezeEnemyEnvoy) || 0;
        if (freeze > n.cooldown[them]) n.cooldown[them] = freeze;
        normalizeDeclarations(n);
        return n;
      }

      b[m.from] = null;
      if (m.ep) b[m.to - 8 * (us === 'w' ? 1 : -1)] = null;
      b[m.to] = m.promotion ? us + m.promotion : piece;
      if (n.str) {
        if (m.captured) n.str[them] -= R.pieceValues[m.captured[1]] || 0;
        if (m.promotion) n.str[us] += (R.pieceValues[m.promotion] || 0) - (R.pieceValues.p || 0);
      }
      if (m.castle) {
        var rFrom = m.castle === 'K' ? m.from + 3 : m.from - 4;
        var rTo = m.castle === 'K' ? m.from + 1 : m.from - 1;
        b[rTo] = b[rFrom]; b[rFrom] = null;
      }

      n.turn = them;
      n.ep = m.double ? (m.from + m.to) / 2 : -1;
      n.halfmove = (piece[1] === 'p' || m.captured) ? 0 : st.halfmove + 1;
      if (us === 'b') n.fullmove++;
      n.lastMove = { from: m.from, to: m.to };
      n.lastCapture = !!m.captured;

      // castling rights
      if (piece[1] === 'k') { if (us === 'w') { n.castling.K = n.castling.Q = false; } else { n.castling.k = n.castling.q = false; } }
      [m.from, m.to].forEach(function (s) {
        if (s === 0) n.castling.Q = false;
        if (s === 7) n.castling.K = false;
        if (s === 56) n.castling.q = false;
        if (s === 63) n.castling.k = false;
      });

      // envoy cooldown
      if (piece[1] === 'e') {
        var t = tierFor(st, us);   // a tier may set its own (longer) rest
        n.cooldown[us] = t.cooldownTurns != null ? t.cooldownTurns : R.envoy.cooldownTurns;
      }
      else if (n.cooldown[us] > 0) n.cooldown[us]--;
      if (m.captured && R.envoy.cooldownResetOnOpponentCapture) n.cooldown[them] = 0;

      // a declaration only lasts while the side stays in the 'choice' tier
      normalizeDeclarations(n);
      return n;
    }

    // ------------------------------------------------------------------
    // 6. Notation
    // ------------------------------------------------------------------
    function san(st, m, legal) {
      var s;
      if (m.sacrifice) s = 'Sac:' + (m.piece[1] === 'p' ? '' : m.piece[1].toUpperCase()) + sqName(m.from);
      else if (m.drop) s = 'E@' + sqName(m.to);
      else if (m.castle) s = m.castle === 'K' ? 'O-O' : 'O-O-O';
      else {
        var t = m.piece[1];
        if (t === 'p') {
          s = (m.captured ? FILES[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promotion ? '=' + m.promotion.toUpperCase() : '');
        } else {
          var dis = '';
          var others = (legal || legalMoves(st)).filter(function (o) {
            return o.to === m.to && o.from !== m.from && o.piece === m.piece && o.declare === m.declare;
          });
          if (others.length) {
            var sameFile = others.some(function (o) { return (o.from & 7) === (m.from & 7); });
            var sameRank = others.some(function (o) { return (o.from >> 3) === (m.from >> 3); });
            if (!sameFile) dis = FILES[m.from & 7];
            else if (!sameRank) dis = String((m.from >> 3) + 1);
            else dis = sqName(m.from);
          }
          s = t.toUpperCase() + dis + (m.captured ? 'x' : '') + sqName(m.to);
        }
      }
      var after = applyMove(st, m);
      if (inCheck(after, after.turn)) s += legalMoves(after).length ? '+' : '#';
      return s;
    }

    // ------------------------------------------------------------------
    // 7. Game object
    // ------------------------------------------------------------------
    function positionKey(st) {
      var b = st.board.map(function (p) { return p || '.'; }).join('');
      var c = st.castling;
      return b + st.turn + (c.K ? 1 : 0) + (c.Q ? 1 : 0) + (c.k ? 1 : 0) + (c.q ? 1 : 0) + st.ep +
        '|' + st.cooldown.w + st.cooldown.b + '|' + st.declared.w + st.declared.b + '|' + st.inHand.w + st.inHand.b +
        '|' + st.sacrificed.w + ',' + st.sacrificed.b;
    }

    function Game(fen) {
      this.states = [fromFEN(fen || R.startFEN)];
      this.moves = [];          // each: move + { san }
      this.forcedResult = null; // resignation / agreed draw
      this._status = null;
    }
    Game.prototype.state = function () { return this.states[this.states.length - 1]; };
    Game.prototype.legalMoves = function () { return this.isOver() ? [] : legalMoves(this.state()); };
    /** Play a move given as {from, to, promotion?, declare?}. Returns the full move or null. */
    Game.prototype.move = function (want) {
      if (this.isOver()) return null;
      var st = this.state(), legal = legalMoves(st);
      var same = legal.filter(function (x) {
        return x.from === want.from && x.to === want.to &&
          (x.promotion || null) === (want.promotion || null);
      });
      var m = same.filter(function (x) { return (x.declare || null) === (want.declare || null); })[0];
      // the envoy's choice is implied by the move itself, so a stale `declare` is harmless
      if (!m && same.length === 1 && R.envoy.chooseBy === 'move') m = same[0];
      if (!m) return null;
      m.san = san(st, m, legal);
      this.moves.push(m);
      this.states.push(applyMove(st, m));
      this._status = null;
      return m;
    };
    Game.prototype.undo = function () {
      if (!this.moves.length) return null;
      this.forcedResult = null;
      this._status = null;
      this.states.pop();
      return this.moves.pop();
    };
    Game.prototype.resign = function (color) {
      this.forcedResult = { over: true, result: color === 'w' ? '0-1' : '1-0', reason: 'resignation', winner: opp(color) };
    };
    Game.prototype.agreeDraw = function () {
      this.forcedResult = { over: true, result: '1/2-1/2', reason: 'agreement', winner: null };
    };
    Game.prototype.status = function () {
      if (this.forcedResult) return this.forcedResult;
      if (this._status) return this._status;
      var st = this.state(), res;
      var bare = bareSide(st);
      if (bare) {
        res = { over: true, result: bare === 'w' ? '0-1' : '1-0', reason: 'only king and envoy left', winner: opp(bare) };
        this._status = res;
        return res;
      }
      var hasMoves = legalMoves(st).length > 0;
      var check = inCheck(st, st.turn);
      if (!hasMoves && check) res = { over: true, result: st.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate', winner: opp(st.turn) };
      else if (!hasMoves && R.draws.stalemate === 'loss') res = { over: true, result: st.turn === 'w' ? '0-1' : '1-0', reason: 'stalemate', winner: opp(st.turn) };
      else if (!hasMoves) res = { over: true, result: '1/2-1/2', reason: 'stalemate', winner: null };
      else if (R.draws.fiftyMoveRule && st.halfmove >= 100) res = { over: true, result: '1/2-1/2', reason: 'fifty-move rule', winner: null };
      else if (R.draws.threefoldRepetition && this.repetitions() >= 3) res = { over: true, result: '1/2-1/2', reason: 'threefold repetition', winner: null };
      else res = { over: false, check: check, mustCapture: !!R.forcedCapture && !check && legalMoves(st).some(isForcingCapture) };
      this._status = res;
      return res;
    };
    Game.prototype.isOver = function () { return this.status().over; };
    Game.prototype.repetitions = function () {
      var key = positionKey(this.state()), n = 0;
      this.states.forEach(function (s) { if (positionKey(s) === key) n++; });
      return n;
    };
    Game.prototype.pgn = function () {
      var out = ['[Event "Envoy Chess game"]', '[Variant "' + R.name + '"]', '[FEN "' + toFEN(this.states[0], !!(this.states[0].inHand.w || this.states[0].inHand.b)) + '"]'];
      var st = this.status();
      out.push('[Result "' + (st.over ? st.result : '*') + '"]', '');
      var text = [];
      var first = this.states[0];
      this.moves.forEach(function (m, i) {
        var plyColor = (first.turn === 'w') === (i % 2 === 0) ? 'w' : 'b';
        var num = first.fullmove + Math.floor((i + (first.turn === 'b' ? 1 : 0)) / 2);
        if (plyColor === 'w') text.push(num + '.');
        else if (i === 0) text.push(num + '...');
        text.push((m.declare ? '{E=' + m.declare + '} ' : '') + m.san);
      });
      text.push(st.over ? st.result : '*');
      return out.join('\n') + text.join(' ');
    };

    return {
      rules: R,
      create: create,
      opp: opp, sqName: sqName, parseSq: parseSq,
      fromFEN: fromFEN, toFEN: toFEN,
      strength: strength, deficit: deficit, powerDeficit: powerDeficit, tierFor: tierFor, tierAt: tierAt,
      envoyInfo: envoyInfo, needsDeclaration: needsDeclaration, hasEnvoy: hasEnvoy, dropSquares: dropSquares,
      isAttacked: isAttacked, inCheck: inCheck, findKing: findKing,
      pseudoMoves: pseudoMoves, legalMoves: legalMoves, applyMove: applyMove, withDeclaration: withDeclaration,
      san: san, positionKey: positionKey, bareSide: bareSide, spareCount: spareCount, mustCapture: mustCapture, isForcingCapture: isForcingCapture,
      Game: Game
    };
  }

  return create(DEFAULT_RULES);
});
