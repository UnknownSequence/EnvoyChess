# Envoy Chess

Envoy Chess is a chess variant with one new piece, the **envoy** (an upside-down triangle).
The envoy can never be captured, and it grows stronger the further its side falls behind.
You play it in the browser on a lichess-style board, against the computer, against a friend on the same device, or by sending moves to a friend over WhatsApp or any other messenger.

## Play

Download the repository (**Code → Download ZIP**), unzip it, and double-click **`index.html`**.
It runs in any modern browser with no installation and no internet connection.

Then choose **New game** and pick an opponent:

* **Computer:** levels 1 to 3.
* **Friend (same device):** pass the phone or laptop back and forth.
* **By message:** after your move, tap **Send** and paste the copied text into a chat.
  Your friend opens the game, taps **New game**, pastes the text under **Continue a game**, makes a move and sends it back.

You can drag pieces or click a piece and then a square.
Use ← / → to step through the moves, F to flip the board and S to sacrifice.
The game saves itself in the browser.

## Rules

The rules are normal chess, with these changes.

**Setup.** The normal chess starting position. The two envoys start in hand, off the board.

**Placing the envoy.** White's first move is to place its envoy on any square of rank 3 (a3 to h3).
Black's first move is to place its envoy on any square of rank 6 (a6 to h6).
Normal play starts after that. Placing is written like `E@d3`.

**Strength.** A side's strength is the sum of its pieces: pawn 1, knight 3, bishop 3, rook 5, queen 9, king 0, envoy 0.
"Behind by N" means the opponent's strength minus yours.

**The envoy**

* **Diplomatic immunity:** it can never be captured.
* **Diplomatic distance:** it may never move onto a square within two squares of the enemy king (in any direction, including diagonally), so there is always at least one empty square between them. It can still attack the king from further away. Only the envoy is restricted: the enemy king may walk up to it, as long as it does not step onto a square the envoy attacks.
* It may capture only while its side is behind.
* It is allowed to give check, even while it may not capture, so a king may not move onto a square the enemy envoy attacks.
* It may move every turn (there is no cooldown).
* How it moves depends on how far behind its side is:

  | Behind by | Envoy moves like |
  |---|---|
  | 12 or more | Amazon (queen + knight) |
  | 9–11 | Queen |
  | 5–8 | King + rook |
  | 3–4 | King + knight **or** king + bishop (see below) |
  | 2 or less | King |

  Every row keeps the king's one-square step, so the envoy only gains moves as its side falls further behind.

  For this table, the gap counts for at most your own remaining strength.
  For example, if your pieces add up to 3 and you are 20 behind, your envoy moves as if you were 3 behind.
  This stops a player from giving away every piece to get a huge envoy.

**The envoy's choice: king + knight or king + bishop.** When your side is 3 or 4 behind, the envoy has two possible movements. There is nothing to announce: the way the envoy moves makes the choice.

* **Before the choice:** the envoy may make any move that either movement allows, captures included: a one-square step in any direction, a knight jump, or a diagonal move of any length.
* **What makes the choice:** the first envoy move that only one of the two allows. A knight jump chooses king + knight. A diagonal move of two or more squares chooses king + bishop. Captures count the same way.
* **What does not:** a one-square step or one-square capture (both movements allow it), moving any other piece, or a sacrifice. So you may put the choice off for as long as you like.
* **Check while undecided:** the envoy attacks along both patterns at once (one-square steps, knight jumps and diagonals), so the enemy king may not step onto any of those squares, and a check along either pattern must be answered.
* **After the choice:** the envoy moves only that way, with the one-square step still available, for as long as your side stays 3–4 behind.
* **Leaving the range:** if the gap is no longer 3–4 (for example after a capture or a sacrifice), the choice is wiped. If your side comes back into the range later, the envoy is free to choose again.
* **On screen:** the envoy's badge shows an orange **?** while it has not chosen, then **N+** or **B+**. The deciding move is tagged in the move list, for example `E=N+`.

Example: White is 4 behind and its undecided envoy stands on d4. `Exd5` (one square) keeps the choice open, `Ef5` (a knight jump) chooses king + knight, and `Eg7` (a long diagonal) chooses king + bishop.

**Compulsory captures (weaker takes stronger).** If one of your pieces can capture a more valuable enemy piece (pawn takes knight, knight takes rook, and so on), you must make such a capture, but you choose which one.
Equal trades and captures of cheaper pieces stay optional.
King and envoy captures are never compulsory.
If your king is in check, captures are not compulsory: any legal move that answers the check is allowed.

**Sacrifice.** Instead of moving, you may remove one of your own pieces (not the king or the envoy).
This lowers your strength, so a side that is behind you becomes less behind and its envoy gets weaker.
You may not sacrifice while in check, while a capture is compulsory, or if it would expose your king.
Sacrifices are written like `Sac:Nf3`.

**Running out of pieces.** A side left with only its king and envoy loses immediately.

Pawns never promote to an envoy.
**Stalemate loses.** A player who is not in check but has no legal move loses. Because you can almost always sacrifice a piece, this is rare: every remaining piece must be pinned to the king, and the king and envoy boxed in.
Threefold repetition, the fifty-move rule and agreement are draws.
The **Rules** button in the game shows the full rules.

## Project layout

```
index.html            the game page
css/style.css         look and feel (board colours are variables at the top)
js/rules.js           all variant rules
js/engine.js          moves, check, envoy power, captures, sacrifice, draws, notation
js/ai.js              computer opponent (alpha-beta search)
js/nn.js              optional neural-network evaluation for the computer
js/nn-weights.js      a trained network, if any (null = none)
js/pieces.js          piece artwork as SVG (the envoy is at the bottom)
js/ui.js              board, move list, dialogs, play by message
tests/engine.test.js  rule tests
tools/benchmark.js    bot-vs-bot matches for comparing rule variants
tools/variants.js     the rule variants used by the benchmark
```

## Development

The tests and the benchmark need [Node.js](https://nodejs.org). Playing does not.

```
node tests/engine.test.js
node tools/benchmark.js --variants current,noSacrifice --pairs 20 --jobs 4
```

## License

The code is released under the [MIT License](LICENSE).

The standard chess piece images are the "cburnett" set by Colin M.L. Burnett, which is offered under several licenses (GFDL, CC BY-SA 3.0, BSD, GPL); they are used here under the BSD license.
The board style is inspired by [lichess.org](https://lichess.org).
