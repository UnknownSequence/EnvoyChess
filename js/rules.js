/*
 * ============================================================================
 *  ENVOY CHESS — RULES CONFIGURATION
 * ============================================================================
 *  Every rule that makes Envoy Chess different from normal chess lives in
 *  this one file. Change a number here, save, and reload the page — the
 *  engine, the computer opponent, the on-screen rules text and the status
 *  panels all read from this object.
 *
 *  Piece letters used everywhere:
 *    p = pawn, n = knight, b = bishop, r = rook, q = queen, k = king, e = envoy
 *    Upper case = White, lower case = Black (in position strings / FEN).
 * ============================================================================
 */
(function (root) {
  'use strict';

  // --- Reusable movement building blocks ------------------------------------
  // A movement is a list of components. Each component is either
  //   { leap:  [[dx,dy], ...] }  -> jumps exactly by those offsets (king, knight)
  //   { slide: [[dx,dy], ...] }  -> slides any distance until blocked (rook, bishop)
  // dx = files to the right (towards h), dy = ranks up (towards rank 8).
  var ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var KNIGHT_JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

  var RULES = {
    name: 'Envoy Chess',

    // Starting position (FEN). The envoy 'E'/'e' replaces White's dark-squared
    // bishop (c1) and Black's light-squared bishop (c8).
    startFEN: 'rneqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNEQKBNR w KQkq - 0 1',

    // Values used to compute each side's "strength" (sum of its pieces).
    pieceValues: { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0, e: 0 },

    // Named movement patterns. Add your own (e.g. 'camel') and refer to them
    // by name in `pieceMovement` or in the envoy tiers below.
    movements: {
      king:   [{ leap: ORTHO.concat(DIAG) }],
      knight: [{ leap: KNIGHT_JUMPS }],
      bishop: [{ slide: DIAG }],
      rook:   [{ slide: ORTHO }],
      queen:  [{ slide: ORTHO.concat(DIAG) }],
      amazon: [{ slide: ORTHO.concat(DIAG) }, { leap: KNIGHT_JUMPS }]  // queen + knight
    },

    // How the ordinary pieces move (pawns and castling are built into the engine).
    pieceMovement: { n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' },

    // Human-readable names (used in the UI and the rules screen).
    pieceNames: { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King', e: 'Envoy' },
    movementNames: { king: 'King', knight: 'Knight', bishop: 'Bishop', rook: 'Rook', queen: 'Queen', amazon: 'Amazon (Queen + Knight)' },

    // Pieces a pawn may promote to (the envoy is deliberately not included).
    promotionPieces: ['q', 'r', 'b', 'n'],

    // ------------------------------------------------------------------------
    //  THE ENVOY
    // ------------------------------------------------------------------------
    envoy: {
      // Can the envoy be captured?  false = never, true = always,
      // 'whenArmed' = only while it is allowed to capture ("loses immunity
      // when it takes up arms").
      capturable: false,

      // "deficit" = opponent's strength minus your strength.
      // Your envoy may capture enemy pieces only when deficit >= this number
      // (1 = "whenever you are the weaker side").
      captureMinDeficit: 1,

      // Do the envoy's attacks count as check?  true = always (even when it is
      // not allowed to capture), false = never, 'whenArmed' = only while it
      // may capture.
      givesCheck: true,

      // After the envoy moves it must sit out this many of its own turns...
      // 0 = no cooldown, the envoy may move every turn.
      cooldownTurns: 0,
      // ...unless the opponent captured one of your pieces on their move.
      cooldownResetOnOpponentCapture: true,
      // (A tier below may also set its own `cooldownTurns`, e.g. 2 for the amazon.)

      // POWER CAP: the deficit that powers the envoy counts at most
      // powerCap x your own remaining strength. An envoy with no army behind it
      // has no power: sacrificing everything does NOT create a monster envoy.
      // Example: you have 3 points left and are 30 behind -> the envoy acts as
      // if you were 3 behind (knight/bishop). null = no cap.
      powerCap: 1,

      // DIPLOMATIC DISTANCE: the envoy may never move onto a square next to the
      // enemy king (Chebyshev distance must stay >= this number). Stops the
      // invulnerable envoy from simply walking up and smothering the king.
      // null = no restriction.
      minKingDistance: 2,

      // Movement tiers, checked top to bottom; the first tier whose
      // minDeficit <= your deficit applies.
      //   movement: name from `movements` above, or 'choice' with `options`.
      // With 'choice', the envoy picks one of the options (see `chooseBy`).
      // The choice lasts while the side stays in the tier; leaving and
      // re-entering the tier makes the envoy free to choose again.
      tiers: [
        { minDeficit: 12, movement: 'amazon' },                       // weaker by more than 11
        { minDeficit: 9,  movement: 'queen' },                        // weaker by 9 – 11
        { minDeficit: 5,  movement: 'rook' },                         // weaker by 5 – 8
        { minDeficit: 3,  movement: 'choice', options: ['knight', 'bishop'] }, // weaker by 3 – 4
        { minDeficit: -Infinity, movement: 'king' }                   // weaker by 2 or less / equal / stronger
      ],

      // While a side is in a 'choice' tier but has not declared yet (it only
      // declares on its own turn), how does its envoy give check?
      //   'union' -> it checks along every option (safest; nobody can be left
      //              in check by a later declaration)
      //   'king'  -> it checks like a king until it declares
      undeclaredCheckPattern: 'union',

      // How a 'choice' tier is decided:
      //   'move' -> no declaration (default). Until it moves, the envoy may move like
      //             ANY of the options; its first move in the tier (e.g. a
      //             knight jump) fixes that movement for as long as the side
      //             stays in the tier. Moving other pieces fixes nothing.
      //   'turn' -> the player declares an option at the start of the
      //             first turn in the tier, before moving.
      chooseBy: 'move'
    },

    // ------------------------------------------------------------------------
    //  Compulsory captures
    // ------------------------------------------------------------------------
    //   false     = captures are never compulsory (normal chess)
    //   true      = any capture is compulsory
    //   'upward'  = (default) a capture is compulsory only when a WEAKER piece can take
    //               a STRONGER one (by pieceValues, e.g. pawn takes knight,
    //               knight takes rook). Then you must make one such capture
    //               (you choose which). Equal trades and downward captures stay optional.
    // Exception: when your king is in check you may answer the check any legal way.
    forcedCapture: 'upward',
    // Pieces whose captures never count as "weaker takes stronger"
    // (their value is 0, so otherwise every capture they make would be forced).
    forcedCaptureExempt: ['k', 'e'],

    // ------------------------------------------------------------------------
    //  Sacrifice
    // ------------------------------------------------------------------------
    // Instead of moving, a player may remove one of their own pieces from the
    // board. This uses the turn. It lowers your strength, which shrinks the
    // opponent's deficit (weakening THEIR envoy) or grows yours. Not allowed
    // while in check or while a capture is compulsory, and not if removing the
    // piece would expose your own king. Sacrificing your last piece besides
    // king + envoy loses the game (see loseWithOnly).
    sacrifice: { enabled: true, pieces: ['p', 'n', 'b', 'r', 'q'] },

    // ------------------------------------------------------------------------
    //  Running out of pieces
    // ------------------------------------------------------------------------
    // A side that has nothing left but these piece types LOSES immediately.
    // ['k', 'e'] = a side reduced to king + envoy loses, so sacrificing every
    // piece to power up the envoy does not work. Set to null to switch off.
    loseWithOnly: ['k', 'e'],

    // ------------------------------------------------------------------------
    //  Draw rules
    // ------------------------------------------------------------------------
    draws: {
      fiftyMoveRule: true,       // 50 moves each without a capture or pawn move
      threefoldRepetition: true  // same position (incl. envoy state) 3 times
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = RULES;
  else root.EnvoyRules = RULES;
})(typeof self !== 'undefined' ? self : this);
