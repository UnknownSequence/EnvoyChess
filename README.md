# Envoy Chess

Envoy Chess is a chess variant with one new piece, the **envoy** (an upside-down triangle).
The envoy can never be captured, and it grows stronger the further its side falls behind.
You play it in the browser on a lichess-style board, against the computer, against a friend on the same device, or by sending moves to a friend over WhatsApp or any other messenger.

## Why Envoy Chess?

In chess, losing a piece usually decides the game.
Between good players, a single lost knight is often enough to resign, and the rest of the game is a slow, predictable conversion.
One slip, and the fun is over.

Envoy Chess keeps the game alive after a loss.
Every point of material you fall behind feeds your envoy, a piece that can never be captured.
It starts out moving like a king.
A few points down, it gains knight jumps or bishop lines.
A rook down, it moves like a knight and a bishop together.
A queen down, it becomes an amazon (queen + knight) and can tear through the enemy position.
The side that is ahead still has the bigger army, but now it has to deal with a piece it can never take.
A blunder becomes a setback instead of the end, and the player who is behind always has something to fight with.

The other rules keep the comeback honest:

* **The envoy never gives check.** It can roam right up to the enemy king, but it can never check or mate it, so a comeback still has to be finished with real pieces.
* **Sacrifices cut both ways.** Giving up a piece powers up your own envoy, weakens your opponent's, and freezes their envoy for a turn. But a side left with only king and envoy loses, so going all in is a gamble for skilled players.
* **Power only ever grows with the gap.** The further behind you are, the stronger your envoy, with no exceptions.

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
* **It never gives check.** It can never check or checkmate the king, and it may walk right up to the enemy king, just as the king may stand right next to it. The king still cannot capture it, so the king can never move onto the envoy's square. Its attacks do not count against the king at all: the king may step onto squares the envoy attacks, and may capture a piece next to it even if the envoy "guards" that piece. For example, a queen next to the king that only the envoy guards is not checkmate, because the king simply takes the queen. The envoy can still help an attack by capturing defenders or by standing on a square the king would like to escape to.
* It may capture only while its side is behind.
* It may move every turn, except right after the opponent sacrifices (see **Sacrifice**).
* How it moves depends on how far behind its side is:

  | Behind by | Envoy moves like |
  |---|---|
  | 9 or more | Amazon (queen + knight) |
  | 5–8 | King + knight + bishop |
  | 3–4 | King + knight **or** king + bishop (see below) |
  | 2 or less | King |

  Each row can make every move of the rows below it, so the envoy only ever gains moves as its side falls further behind. It never swaps one ability for another.

  Every point counts, whether the opponent captured it or you sacrificed it, so falling further behind always makes your envoy stronger (or keeps it the same).
  Sacrificing everything for a huge envoy is allowed, but risky: a side left with only king and envoy loses.

**The envoy's choice: king + knight or king + bishop.** When your side is 3 or 4 behind, the envoy has two possible movements. There is nothing to announce: the way the envoy moves makes the choice.

* **Before the choice:** the envoy may make any move that either movement allows, captures included: a one-square step in any direction, a knight jump, or a diagonal move of any length.
* **What makes the choice:** the first envoy move that only one of the two allows. A knight jump chooses king + knight. A diagonal move of two or more squares chooses king + bishop. Captures count the same way.
* **What does not:** a one-square step or one-square capture (both movements allow it), moving any other piece, or a sacrifice. So you may put the choice off for as long as you like.
* **After the choice:** the envoy moves only that way, with the one-square step still available, for as long as your side stays 3–4 behind.
* **Leaving the range:** if the gap is no longer 3–4 (for example after a capture or a sacrifice), the choice is wiped. If your side comes back into the range later, the envoy is free to choose again.
* **Capturing can end the choice:** every capture your side makes, including one by the envoy itself, makes you less behind. If a capture brings the gap down to 2 or less, the envoy goes back to moving like a king and loses the knight and bishop moves, whether or not it had already chosen. It regains them only if your side falls 3 or more behind again. So think before capturing with an undecided envoy: taking a pawn when you are 4 behind keeps the choice, but taking a knight leaves you only 1 behind.
* **On screen:** the envoy's badge shows an orange **?** while it has not chosen, then **N+** or **B+**. The deciding move is tagged in the move list, for example `E=N+`.

Example: White is 4 behind and its undecided envoy stands on d4. `Ed5` (one square) keeps the choice open, `Ef5` (a knight jump) chooses king + knight, and `Eg7` (a long diagonal) chooses king + bishop. If a black pawn stood on d5, `Exd5` would leave White 3 behind and the choice would stay open. If it were a black knight, `Exd5` would leave White only 1 behind, and the envoy would move like a king from then on.

**Sacrifice.** Instead of moving, you may remove one of your own pieces (not the king or the envoy).
This lowers your strength, so a side that is behind you becomes less behind and its envoy gets weaker.
It also puts you further behind, so your own envoy gets stronger.
**A sacrifice freezes the enemy envoy:** your opponent's envoy may not move on their next turn (it shows an hourglass ⌛). Their other pieces move as normal.
You may not sacrifice while in check or if it would expose your king.
Sacrifices are written like `Sac:Nf3`.

**Running out of pieces.** A side left with only its king and envoy loses immediately.

Captures are never compulsory, as in normal chess.
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
