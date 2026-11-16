// Placeholder: shows the camera with the mesh and the strongest signal.
import { FaceView } from '../core.js';

export function mount(root, { face }) {
  root.innerHTML = '<div class="stub-emoji"><canvas></canvas><p></p></div>';
  const view = new FaceView(root.querySelector('canvas'), face);
  const label = root.querySelector('p');
  let raf = 0, last = null;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const res = face.detect(now);
    if (res) last = res;
    view.draw(last);
    if (last && last.found) {
      const [k, v] = Object.entries(last.raw).filter(([n]) => n !== '_neutral').sort((a, b) => b[1] - a[1])[0];
      label.textContent = k + ' ' + v.toFixed(2) + ' · ' + face.delegate + ' ' + face.ms.toFixed(0) + 'ms';
    } else label.textContent = last ? 'სახე არ ჩანს' : '';
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); view.destroy(); };
}
