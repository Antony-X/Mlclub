# Working on the games

One page (`index.html`), three scripts:

- `app/main.js`: menu, routing (`#/emoji`, `#/brow`), model download, camera permission.
- `app/core.js`: `FaceTracker` (camera + MediaPipe Face Landmarker), `FaceView` (mirrored camera picture + mesh on a canvas), `haptic`, `store`, `IS_TOUCH`.
- `app/games/<name>.js` + `.css`: one game each.

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
- `{ found: false }`: no face.
- `{ found: true, landmarks, raw, bs, roll, matrix, box, calibrating }`
  - `landmarks`: 478 points, `x`/`y` in 0..1 of the camera picture (not mirrored), `z` relative depth.
  - `raw`: the 52 blendshape scores exactly as the model gives them (`raw.jawOpen`, ...).
  - `bs`: the same, minus this person's resting value (measured over the first second,
    `calibrating` is true meanwhile; smile, jaw, blink, pucker and funnel are left as they are).
    The baseline restarts by itself when a face comes back after 2.5 s away, or on `face.resetBaseline()`.
  - `roll`: head tilt in degrees. `matrix`: 4x4 face pose, column-major, or null.
  - `box`: `{x0,y0,x1,y1}` of the face in 0..1.

`face.fps`, `face.ms`, `face.delegate` ('GPU' | 'CPU') describe the detector.

`new FaceView(canvas, face, { fit: 'cover' | 'contain', mesh: true, colors })`, then `view.draw(res)` each
frame. The canvas gets its size from CSS. `view.project(landmark)` gives CSS pixels inside the canvas.

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
