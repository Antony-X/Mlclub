# Working on the games

One page (`index.html`) and these scripts:

- `app/main.js`: menu, routing (`#/emoji`, `#/brow`), model download, camera permission, the record button.
- `app/core.js`: `FaceTracker` (camera + MediaPipe Face Landmarker, hands on request), `FaceView` (mirrored camera picture + mesh on a canvas), emoji pictures, `haptic`, `store`, `IS_TOUCH`.
- `app/record.js`: `Recorder`, the camera picture into a video file.
- `app/games/<name>.js` + `.css`: one game each. `#/brow` is the flying game ("თვალებით ფრენა").

## The game contract

```js
import { FaceView, haptic, store, IS_TOUCH } from '../core.js';

export function mount(root, { face }) {
  // root is the empty <main>; the model is loaded and the camera is running.
  // Build the DOM, start a requestAnimationFrame loop, add listeners.
  return function unmount() { /* stop the loop, remove every listener, destroy FaceViews */ };
}
```

Per frame: `const res = face.detect(now)`.

- `null`: no new camera frame, keep the previous result.
- `{ found: false, hands }`: no face.
- `{ found: true, landmarks, raw, bs, roll, yaw, pitch, matrix, box, calibrating, hands }`
  - `landmarks`: 478 points, `x`/`y` in 0..1 of the camera picture (not mirrored), `z` relative depth.
  - `raw`: the 52 blendshape scores exactly as the model gives them (`raw.jawOpen`, ...).
  - `bs`: the same, minus this person's resting value (measured over the first second,
    `calibrating` is true meanwhile; smile, jaw, blink, pucker and funnel are left as they are).
    The baseline restarts by itself when a face comes back after 2.5 s away, or on `face.resetBaseline()`.
  - `roll`: head tilt in degrees. `yaw`: turn, positive toward the right edge of the camera picture
    (the left edge of the mirrored one on screen). `pitch`: positive when nodding down.
    `matrix`: 4x4 face pose, column-major, or null.
  - `box`: `{x0,y0,x1,y1}` of the face in 0..1.
  - `hands`: `[]` until a game calls `face.enableHands()` (loads the 8 MB Gesture Recognizer once;
    `face.handsReady` tells when). Then up to two of `{ landmarks, handed, gesture, score }`:
    21 points like the face's, `handed` 'Left' | 'Right' as the person sees their own hand,
    `gesture` one of `None`, `Closed_Fist`, `Open_Palm`, `Pointing_Up`, `Thumb_Down`, `Thumb_Up`,
    `Victory`, `ILoveYou`. Hands are looked for on every second camera frame.

`face.fps`, `face.ms`, `face.delegate` ('GPU' | 'CPU') describe the detector.

`new FaceView(canvas, face, { fit: 'cover' | 'contain', mesh: true, colors })`, then `view.draw(res)` each
frame. The canvas gets its size from CSS. `view.project(landmark)` gives CSS pixels inside the canvas.

## Emoji pictures

`emojiEl('😀')` gives an `<img class="emoji-img">` from `vendor/emoji/` (1em square, so `font-size` sets
its size); on Apple devices it gives the system's own emoji as text. `setEmoji(host, ch)` puts one into
an element and swaps it without a blink; `preloadEmoji(list)` fetches a list ahead of time.
The files are named by code points (`1f600.webp`, `1f62e-200d-1f4a8.webp`); a new emoji needs its file,
see `vendor/SOURCES.txt` for where they come from.

## Recording

`new Recorder(face)` in `main.js` draws the mirrored camera picture onto a canvas and feeds it to
`MediaRecorder`. A game may draw on the recording: `face.recOverlay = (ctx, w, h) => { ... }` runs on
every recorded frame, after the camera picture. Set it back to `null` on unmount.
`window.__app.rec` is the recorder, for tests (`rec.onsaved = (blob, name) => ...`).

## Running and testing

```sh
python3 -m http.server 8200          # from the repo root, then http://localhost:8200/
```

Query parameters (before the `#`):

- `?src=dev/portrait.jpg`: use a picture instead of the camera. A `.webm` file plays as a looping video.
- `?delegate=cpu` or `gpu`: skip the automatic choice.

A camera with a real face in headless Chromium: turn a photo or clip into MJPEG and hand it to the fake camera.

```sh
ffmpeg -loop 1 -i face.jpg -t 4 -r 30 -vf scale=640:480 -pix_fmt yuvj420p face.mjpeg
# chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
#                          '--use-file-for-fake-video-capture=/abs/path/face.mjpeg'] })
```

`window.__app.face` is the tracker, for tests.
