// Person mask source for the ML cutout.
// AR: grabs the WebXR camera image (camera-access), shrinks it into a small render target, reads it
// back and sends it to segworker.js. Preview: the room renders a perfect mask of its people instead.
// Either way the result is a person mask in normalized view coordinates (row 0 = top).

import * as THREE from 'three';

export class PersonMask {
  constructor() {
    this.state = 'off';        // off | loading | ready | error | sim
    this.info = '';
    this.mask = null;          // Uint8Array, row 0 = top
    this.w = 0; this.h = 0;
    this.time = -1;            // when the current mask was produced
    this.inferMs = 0;
    this.busy = false;
    this.sent = 0;
    this.worker = null;
    this.rt = null;
    this.buf = null;
    this.tex = new THREE.DataTexture(new Uint8Array(4), 2, 2, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null }, uFlip: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D uTex; uniform float uFlip; varying vec2 vUv; void main(){ vec2 uv = vec2(vUv.x, uFlip > 0.5 ? 1.0 - vUv.y : vUv.y); gl_FragColor = vec4(texture2D(uTex, uv).rgb, 1.0); }',
      depthTest: false, depthWrite: false,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMat);
    q.frustumCulled = false;
    this.quadScene.add(q);
  }

  get active() { return (this.state === 'ready' || this.state === 'sim') && !!this.mask; }

  start(model) {
    if (this.worker) return;
    this.state = 'loading';
    this.info = 'loading ' + model;
    try {
      this.worker = new Worker(new URL('./segworker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      this.state = 'error'; this.info = 'worker: ' + e.message; return;
    }
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') { this.state = 'ready'; this.info = `${m.info.delegate} ${m.info.url.split('/').pop()}`; console.info('[mask] ready', m.info); }
      else if (m.type === 'error') { this.state = 'error'; this.info = m.message; console.warn('[mask] error', m.message); }
      else if (m.type === 'mask') { this.setMask(new Uint8Array(m.data), m.w, m.h, performance.now() / 1000); this.inferMs = m.ms; this.busy = false; }
      else if (m.type === 'mask-error') { this.busy = false; this.info = 'infer: ' + m.message; }
    };
    this.worker.onerror = (e) => { this.state = 'error'; this.info = 'worker: ' + (e.message || 'failed'); };
    this.worker.postMessage({ type: 'init', model });
  }

  stop() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.state = 'off';
    this.mask = null;
    this.busy = false;
  }

  setMask(data, w, h, t) {
    this.mask = data; this.w = w; this.h = h; this.time = t;
    if (this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex.dispose();
      this.tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      this.tex.magFilter = THREE.LinearFilter;
      this.tex.minFilter = THREE.LinearFilter;
      this.tex.unpackAlignment = 1;
    } else {
      this.tex.image.data = data;
    }
    this.tex.needsUpdate = true;
  }

  // AR: send the current camera image to the worker (throttled, one frame in flight).
  grab(renderer, camTex, P, now, aspect) {
    if (this.state !== 'ready' || this.busy || !camTex) return;
    if (now - this.lastGrab < 1 / Math.max(1, P.segFps)) return;
    this.lastGrab = now;
    const w = P.segWidth | 0, h = Math.max(16, Math.round(w * aspect));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
      this.buf = new Uint8Array(w * h * 4);
    }
    this.quadMat.uniforms.uTex.value = camTex;
    this.quadMat.uniforms.uFlip.value = P.camFlipY ? 1 : 0;
    // Render outside of XR (otherwise three swaps in the XR camera and viewport), then restore.
    const prev = renderer.getRenderTarget();
    const xrOn = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.quadScene, this.quadCam);
    renderer.readRenderTargetPixels(this.rt, 0, 0, w, h, this.buf);
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = xrOn;
    // GL rows are bottom-up; the model wants an upright image (row 0 = top).
    const out = new Uint8Array(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) out.set(this.buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    this.busy = true;
    this.sent++;
    this.worker.postMessage({ type: 'frame', w, h, data: out.buffer, t: now * 1000, id: this.sent }, [out.buffer]);
  }

  // Mask value (0..1) at normalized view coordinates (top-left origin).
  at(x, y) {
    if (!this.mask) return 0;
    const px = Math.min(this.w - 1, Math.max(0, (x * this.w) | 0));
    const py = Math.min(this.h - 1, Math.max(0, (y * this.h) | 0));
    return this.mask[py * this.w + px] / 255;
  }

  // Mark depth samples that lie on a person (dilated a little: masks lag behind fast movement).
  fill(df, P) {
    const person = df.person;
    person.fill(0);
    if (!this.active) return 0;
    const { cols, rows } = df;
    const th = P.maskThreshold;
    let n = 0;
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) / rows;
      for (let c = 0; c < cols; c++) {
        if (this.at((c + 0.5) / cols, y) > th) { person[r * cols + c] = 1; n++; }
      }
    }
    if (P.maskDilate > 0) {
      const src = person.slice();
      const R = P.maskDilate | 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (src[r * cols + c]) continue;
          let hit = 0;
          for (let dr = -R; dr <= R && !hit; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= rows) continue;
            for (let dc = -R; dc <= R; dc++) {
              const cc = c + dc;
              if (cc >= 0 && cc < cols && src[rr * cols + cc]) { hit = 1; break; }
            }
          }
          person[r * cols + c] = hit;
        }
      }
    }
    return n;
  }
}
