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

**Setup.** The envoy replaces White's dark-squared bishop (c1) and Black's light-squared bishop (c8).

**Strength.** A side's strength is the sum of its pieces: pawn 1, knight 3, bishop 3, rook 5, queen 9, king 0, envoy 0.
"Behind by N" means the opponent's strength minus yours.

**The envoy**

* It can never be captured.
* It may capture only while its side is behind.
* It gives check, and a king may never step next to it.
* It may move every turn (there is no cooldown).
* How it moves depends on how far behind its side is:

  | Behind by | Envoy moves like |
  |---|---|
  | 12 or more | Amazon (queen + knight) |
  | 9–11 | Queen |
  | 5–8 | Rook |
  | 3–4 | Knight **or** bishop. Its first move in this range decides, and it keeps that movement while the gap stays in the range. |
  | 2 or less | King |

* **The envoy needs an army.** Its power counts at most your own remaining strength, so throwing pieces away does not build a monster envoy.
* **Diplomatic distance.** The envoy may never move onto a square next to the enemy king.

**Compulsory captures (weaker takes stronger).** If one of your pieces can capture a more valuable enemy piece (pawn takes knight, knight takes rook, and so on), you must make such a capture, but you choose which one.
Equal trades and captures of cheaper pieces stay optional.
King and envoy captures are never compulsory.
This rule does not apply while you are in check.

**Sacrifice.** Instead of moving, you may remove one of your own pieces (not the king or the envoy).
This lowers your strength, so a side that is behind you becomes less behind and its envoy gets weaker.
You may not sacrifice while in check, while a capture is compulsory, or if it would expose your king.
Sacrifices are written like `Sac:Nf3`.

**Running out of pieces.** A side left with only its king and envoy loses immediately.

Pawns never promote to an envoy.
Stalemate, threefold repetition, the fifty-move rule and agreement are draws.
The **Rules** button in the game shows the full rules, generated from the rules file, so it always matches the code.

## Changing the rules

Every rule lives in **`js/rules.js`**, and each setting is commented: piece values, the envoy's tiers, compulsory captures, sacrifice, the power cap, and so on.
Edit the file and reload the page.
The engine, the computer player, the status panels and the rules screen all read from it.

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
