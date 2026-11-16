# ML Club stand games

Two webcam games for the club fair, on one page. They run in the browser on a laptop or a phone.
The face model and the library are inside `vendor/`, so after the first load nothing comes from the internet.
The video never leaves the device: nothing is recorded or sent anywhere.

- **სახე → ემოჯი**: the camera shows the emoji that matches your face, live. Collect them all, or play a 45-second round.
- **წარბებით ფრენა**: you are the missing neuron. Each eyebrow raise is one jump; fly through the gap in every layer.

## On a phone (or any device): GitHub Pages

A phone only gives the camera to an `https` page, so the page has to be hosted.

1. The repository must be public (Settings → General → Change visibility), unless the account has GitHub Pro.
2. Settings → Pages → "Deploy from a branch" → pick the branch → folder `/ (root)` → Save.
3. After a minute the page is at `https://<user>.github.io/<repo>/`. Open it in Safari or Chrome and allow the camera.

Open it in the real browser: apps that show links in their own window (Instagram, Messenger) often block the camera.
The first load downloads about 13 MB.

## On the stand laptop (Windows, no internet needed)

1. Copy this whole folder to the laptop (or download the repository as a ZIP and unpack it).
2. Double-click `START.bat`. A small window stays open and the browser opens `http://localhost:8000/`.
3. Allow the camera when the browser asks. Press `F` for full screen.

Closing the small window stops the games. Nothing needs to be installed.
If Python is on the laptop, `python -m http.server 8000` in this folder works too.
Opening `index.html` by double-click does not work: the browser needs `localhost`.

## Keys (laptop)

| Key | Emoji game | Eyebrow game |
| --- | --- | --- |
| `Space` | start a round | jump (for demos) |
| `R` | reset for the next visitor | recalibrate for the next visitor |
| `Esc` | back to the menu | back to the menu |
| `F` | full screen | full screen |

On a phone everything is done by tapping.

## How it works

MediaPipe Face Landmarker finds 478 points on the face and gives 52 "blendshape" numbers
(how much the mouth smiles, the jaw opens, each brow lifts, ...). `app/rules.js` turns those
numbers into an emoji; the eyebrow game reads only the brow numbers. The bars and meters on
screen are the model's real outputs.

## If something goes wrong

- **"კამერა ვერ მოიძებნა"**: no camera, or the page is open inside another app. Open it in Chrome or Safari.
- **"კამერაზე წვდომა აკრძალულია"**: allow the camera for the page in the browser's site settings, then reload.
- **"კამერა ვერ ჩაირთო"**: another program (Zoom, Teams, Camera) is using the webcam. Close it.
- **Slow or jumpy**: add `?delegate=cpu` or `?delegate=gpu` before the `#` in the address to force one or the other.

Developer notes are in `dev/README.md`. Third-party files and licences: `vendor/SOURCES.txt`.
