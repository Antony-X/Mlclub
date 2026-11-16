# ML Club stand games

Two webcam games for the club fair. Both run in the browser, fully offline:
the face model and the library are inside `vendor/`. Nothing is recorded or sent anywhere.

- **სახე → ემოჯი** (`emoji.html`): the camera shows the emoji that matches your face, live.
  31 emojis to collect, plus a 45-second "repeat this face" game.
- **წარბებით ფრენა** (`brow.html`): raise your eyebrows to make the node jump and fly it
  through the gaps between layers of neurons.

## Run it at the stand (Windows)

1. Copy this whole folder to the laptop (or download the repo as a ZIP and unpack it).
2. Double-click `START.bat`. A small window stays open and the browser opens `http://localhost:8000/`.
3. Allow the camera when the browser asks. Press `F` for full screen.

Closing the black window stops the games. Nothing needs to be installed.
If Python is on the laptop, `python -m http.server 8000` in this folder works too.
Opening the `.html` files directly by double-click does not work: the browser needs `localhost`.

## Keys

| Key | Emoji game | Eyebrow game |
| --- | --- | --- |
| `Space` | start a 45 s round | jump (backup for the eyebrows) |
| `R` | reset for the next visitor | recalibrate for the next visitor |
| `F` | full screen | full screen |

Press `R` for every new visitor: both games measure the person's resting face for about a second.

## How it works

MediaPipe Face Landmarker finds 478 points on the face and gives 52 "blendshape" numbers
(how much the mouth smiles, the jaw opens, each brow lifts, ...). `app/rules.js` turns those
numbers into an emoji; the eyebrow game reads only the brow numbers. The bars on screen are
the model's real outputs.

## Troubleshooting

- **"კამერა ვერ მოიძებნა"**: no camera found. Check that the webcam is plugged in / enabled.
- **"კამერაზე წვდომა აკრძალულია"**: click the camera icon in the address bar, allow, reload.
- **"კამერა ვერ ჩაირთო"**: another program (Zoom, Teams, Camera) is using the webcam. Close it.
- **An emoji never fires or fires too easily**: change its thresholds in `app/rules.js`
  and run `node dev/test_rules.mjs`.
- **Eyebrow game too hard or too easy**: change `GRAVITY`, `FLAP`, `GAP`, `SPEED` at the top of `app/brow.js`.
- **Slow**: add `?gpu=1` to the address to run the model on the graphics card.

## Tested / not tested

Tested in headless Chromium: the model loads offline from `vendor/`, a still portrait goes
through the full pipeline (about 29 fps on a cloud CPU), the "no face" and "no camera" messages,
the game round, reset, and the eyebrow game driven by a simulated brow signal.
Every emoji rule is checked with an idealised input (`dev/test_rules.mjs`).

Not tested: a real webcam with real faces, `START.bat` / `serve.ps1` on Windows, and how easy
each emoji is for a real person. Try all of it on the stand laptop before the fair.

Third-party files and licences: `vendor/SOURCES.txt`.
