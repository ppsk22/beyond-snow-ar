// Finds the desktop screen in the camera image by its neon frame and turns it into a 3D pose.
//  1. The camera image (AR) or the preview's camera feed is shrunk and read back.
//  2. Neon pixels (hue/saturation/value window) -> largest connected component = the frame ring.
//  3. Its 4 outer corners (extremes of x+y and x-y) -> rays from the camera.
//  4. A plane is fitted to the depth samples inside the frame (RANSAC); the rays hit it at the corners.
//  5. After a few consistent detections the pose locks.

import * as THREE from 'three';

export class ScreenFinder {
  constructor() {
    this.state = 'off';          // off | search | locked
    this.info = '';
    this.rt = null;
    this.buf = null;
    this.img = null;
    this.lastT = -1;
    this.history = [];
    this.pose = null;
    this.corners2d = null;
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

  start(now = 0) { this.state = 'search'; this.history.length = 0; this.pose = null; this.info = 'looking for the frame'; this.startT = now; this.taps = []; this.manual = false; }

  // 2-tap fallback: top-left corner, then bottom-right corner of the screen, as rays from taps.
  // The screen plane comes from depth samples between the two taps; the screen is assumed upright.
  tap(ray, df, P) {
    if (this.state !== 'search') return null;
    this.taps.push({ o: ray.ray.origin.clone(), d: ray.ray.direction.clone(), uv: this.toView(df, ray) });
    if (this.taps.length < 2) { this.info = 'now tap the bottom-right corner'; return null; }
    const [a, b] = this.taps;
    this.taps = [];
    const pts = [a.uv, [b.uv[0], a.uv[1]], b.uv, [a.uv[0], b.uv[1]]];
    // Plane from depth inside the tapped rectangle (same fit as the automatic path).
    const pose = this.solve(df, pts, P, [a, b]);
    if (!pose) { this.info = 'could not measure the screen, tap the two corners again'; return null; }
    this.pose = pose;
    this.state = 'locked';
    this.info = `locked by taps ${pose.w.toFixed(2)} x ${pose.h.toFixed(2)} m`;
    return pose;
  }

  // Normalized view coords of a world ray direction in the current frame.
  toView(df, ray) {
    const p = ray.ray.origin.clone().add(ray.ray.direction).applyMatrix4(df.view).applyMatrix4(df.proj);
    return [(p.x + 1) / 2, (1 - p.y) / 2];
  }
  stop() { this.state = 'off'; this.pose = null; }

  // Read the camera texture as a small upright RGBA image (row 0 = top).
  grab(renderer, tex, w, h, flip) {
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
      this.buf = new Uint8Array(w * h * 4);
      this.img = new Uint8Array(w * h * 4);
    }
    this.quadMat.uniforms.uTex.value = tex;
    this.quadMat.uniforms.uFlip.value = flip ? 1 : 0;
    const prev = renderer.getRenderTarget();
    const xrOn = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.quadScene, this.quadCam);
    renderer.readRenderTargetPixels(this.rt, 0, 0, w, h, this.buf);
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = xrOn;
    const row = w * 4;
    for (let y = 0; y < h; y++) this.img.set(this.buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return this.img;
  }

  // Detect the frame in an RGBA image. Returns 4 corners in normalized view coords [TL, TR, BR, BL] or null.
  detect(img, w, h, P) {
    const n = w * h;
    if (!this.lab || this.lab.length !== n) { this.lab = new Int32Array(n); this.queue = new Int32Array(n); this.msk = new Uint8Array(n); }
    const msk = this.msk, lab = this.lab, queue = this.queue;
    const hMin = P.findHueMin, hMax = P.findHueMax, sMin = P.findSat, vMin = P.findVal;
    for (let i = 0; i < n; i++) {
      const r = img[i * 4] / 255, g = img[i * 4 + 1] / 255, b = img[i * 4 + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let ok = 0;
      if (mx >= vMin && d / (mx || 1) >= sMin && d > 1e-3) {
        let hu;
        if (mx === g) hu = 60 * ((b - r) / d + 2);
        else if (mx === r) hu = 60 * (((g - b) / d + 6) % 6);
        else hu = 60 * ((r - g) / d + 4);
        ok = hu >= hMin && hu <= hMax ? 1 : 0;
      }
      msk[i] = ok;
    }
    // Grow the mask by one pixel: a thin frame seen from afar breaks into pieces otherwise.
    if (!this.msk2 || this.msk2.length !== n) this.msk2 = new Uint8Array(n);
    const m2 = this.msk2;
    m2.set(msk);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (m2[i]) continue;
        if (m2[i - 1] || m2[i + 1] || m2[i - w] || m2[i + w]) msk[i] = 1;
      }
    }
    lab.fill(0);
    let best = null, label = 0;
    for (let i = 0; i < n; i++) {
      if (!msk[i] || lab[i]) continue;
      label++;
      let qh = 0, qt = 0, count = 0;
      let sMinV = Infinity, sMaxV = -Infinity, dMinV = Infinity, dMaxV = -Infinity;
      let iTL = i, iBR = i, iTR = i, iBL = i;
      queue[qt++] = i; lab[i] = label;
      while (qh < qt) {
        const p = queue[qh++];
        count++;
        const x = p % w, y = (p / w) | 0;
        const s = x + y, dd = x - y;
        if (s < sMinV) { sMinV = s; iTL = p; }
        if (s > sMaxV) { sMaxV = s; iBR = p; }
        if (dd > dMaxV) { dMaxV = dd; iTR = p; }
        if (dd < dMinV) { dMinV = dd; iBL = p; }
        if (x > 0 && msk[p - 1] && !lab[p - 1]) { lab[p - 1] = label; queue[qt++] = p - 1; }
        if (x < w - 1 && msk[p + 1] && !lab[p + 1]) { lab[p + 1] = label; queue[qt++] = p + 1; }
        if (y > 0 && msk[p - w] && !lab[p - w]) { lab[p - w] = label; queue[qt++] = p - w; }
        if (y < h - 1 && msk[p + w] && !lab[p + w]) { lab[p + w] = label; queue[qt++] = p + w; }
      }
      if (!best || count > best.count) best = { count, iTL, iTR, iBR, iBL };
    }
    if (!best || best.count < P.findMinPx * n) { this.info = 'no neon frame in view'; return null; }
    const pts = [best.iTL, best.iTR, best.iBR, best.iBL].map((p) => [(p % w + 0.5) / w, (((p / w) | 0) + 0.5) / h]);
    // Area of the quad (normalized) and how much of it the ring fills (a ring is mostly empty inside).
    let area = 0;
    for (let k = 0; k < 4; k++) { const a = pts[k], b = pts[(k + 1) % 4]; area += a[0] * b[1] - b[0] * a[1]; }
    area = Math.abs(area) / 2;
    const fill = best.count / n / Math.max(1e-6, area);
    if (area < P.findMinArea) { this.info = 'frame too small, come closer'; return null; }
    if (fill > 0.6) { this.info = 'neon blob, not a frame'; return null; }
    return pts;
  }

  // World ray through normalized view coords (u, v).
  ray(df, u, v, origin, dir) {
    const t = new THREE.Vector3(u * 2 - 1, 1 - v * 2, 0.5).applyMatrix4(df.projInv);
    dir.set(t.x / -t.z, t.y / -t.z, -1).transformDirection(df.camWorld);
    origin.copy(df.camPos);
  }

  // Fit the screen plane to depth samples inside the quad, intersect the corner rays.
  solve(df, pts, P, tapRays) {
    const inside = (u, v) => {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        const a = pts[k], b = pts[(k + 1) % 4];
        const c = (b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0]);
        if (c > 0) s++; else if (c < 0) s--;
      }
      return Math.abs(s) === 4;
    };
    const P3 = [];
    for (let r = 0; r < df.rows; r++) {
      for (let c = 0; c < df.cols; c++) {
        const i = r * df.cols + c;
        if (!df.valid[i]) continue;
        if (inside((c + 0.5) / df.cols, (r + 0.5) / df.rows)) P3.push(new THREE.Vector3(df.wx[i], df.wy[i], df.wz[i]));
      }
    }
    const origin = new THREE.Vector3(), dir = new THREE.Vector3();
    let normal = null, pc = null;
    if (P3.length >= 20) {
      let bestN = null, bestC = 0, bestP = null;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), nn = new THREE.Vector3();
      for (let it = 0; it < 80; it++) {
        const p0 = P3[(Math.random() * P3.length) | 0], p1 = P3[(Math.random() * P3.length) | 0], p2 = P3[(Math.random() * P3.length) | 0];
        a.subVectors(p1, p0); b.subVectors(p2, p0); nn.crossVectors(a, b);
        if (nn.lengthSq() < 1e-8) continue;
        nn.normalize();
        let cnt = 0;
        for (const q of P3) {
          const dd = Math.abs(nn.x * (q.x - p0.x) + nn.y * (q.y - p0.y) + nn.z * (q.z - p0.z));
          if (dd < 0.02 + 0.01 * q.distanceTo(df.camPos)) cnt++;
        }
        if (cnt > bestC) { bestC = cnt; bestN = nn.clone(); bestP = p0; }
      }
      if (bestN && bestC >= Math.max(15, P3.length * 0.5)) {
        // Offset from the mean of the inliers.
        const thr = (q) => Math.abs(bestN.x * (q.x - bestP.x) + bestN.y * (q.y - bestP.y) + bestN.z * (q.z - bestP.z)) < 0.02 + 0.01 * q.distanceTo(df.camPos);
        pc = new THREE.Vector3(); let k = 0;
        for (const q of P3) if (thr(q)) { pc.add(q); k++; }
        pc.divideScalar(k);
        normal = bestN;
      }
    }
    if (!normal) {
      // No usable depth on the screen: assume an upright screen facing the phone, sized by findAssumeW.
      this.ray(df, pts[0][0], pts[0][1], origin, dir);
      const d0 = dir.clone();
      this.ray(df, pts[1][0], pts[1][1], origin, dir);
      const ang = d0.angleTo(dir);
      const dist = P.findAssumeW / Math.max(0.05, 2 * Math.tan(ang / 2));
      const fwd = new THREE.Vector3(-df.camWorld.elements[8], 0, -df.camWorld.elements[10]).normalize();
      normal = fwd.clone().negate();
      this.ray(df, (pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2, origin, dir);
      pc = origin.clone().addScaledVector(dir.normalize(), dist);
      this.info = 'no depth on screen, assumed size';
    }
    const hitPlane = (o, d) => {
      const den = normal.dot(d);
      if (Math.abs(den) < 1e-4) return null;
      const t = normal.dot(new THREE.Vector3().subVectors(pc, o)) / den;
      return t > 0 ? o.clone().addScaledVector(d, t) : null;
    };
    let TL, TR, BR, BL;
    if (tapRays) {
      // Manual: two diagonal corners; the other two from an upright screen in that plane.
      const A = hitPlane(tapRays[0].o, tapRays[0].d), B = hitPlane(tapRays[1].o, tapRays[1].d);
      if (!A || !B) return null;
      const n = normal.clone();
      if (n.dot(new THREE.Vector3().subVectors(df.camPos, A)) < 0) n.negate();
      const upv = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
      const rv = new THREE.Vector3().crossVectors(upv, n).normalize();
      const diag = new THREE.Vector3().subVectors(B, A);
      const wv = diag.dot(rv), hv = -diag.dot(upv);
      TL = A; BR = B;
      TR = A.clone().addScaledVector(rv, wv);
      BL = A.clone().addScaledVector(upv, -hv);
    } else {
      const corners = [];
      for (const p of pts) {
        this.ray(df, p[0], p[1], origin, dir);
        const c = hitPlane(origin, dir);
        if (!c) return null;
        corners.push(c);
      }
      [TL, TR, BR, BL] = corners;
    }
    const right = new THREE.Vector3().subVectors(TR, TL).add(new THREE.Vector3().subVectors(BR, BL)).normalize();
    let up = new THREE.Vector3().subVectors(TL, BL).add(new THREE.Vector3().subVectors(TR, BR)).normalize();
    // The phone can be rotated: whichever corner pair is higher in the world is the top.
    if (up.y < 0) { up.negate(); right.negate(); }
    const nrm = new THREE.Vector3().crossVectors(right, up).normalize();
    if (nrm.dot(new THREE.Vector3().subVectors(df.camPos, TL)) < 0) { nrm.negate(); right.negate(); }
    up = new THREE.Vector3().crossVectors(nrm, right).normalize();
    const w = (TL.distanceTo(TR) + BL.distanceTo(BR)) / 2, h = (TL.distanceTo(BL) + TR.distanceTo(BR)) / 2;
    const center = new THREE.Vector3().add(TL).add(TR).add(BR).add(BL).multiplyScalar(0.25);
    if (w < 0.15 || w > 3 || h < 0.08 || w / h < 0.7 || w / h > 3) { this.info = `odd size ${w.toFixed(2)} x ${h.toFixed(2)} m`; return null; }
    return { center, right, up, normal: nrm, w, h };
  }

  // One detection step (throttled). Returns the locked pose once, then null.
  update(renderer, tex, df, P, now, aspect) {
    if (this.state !== 'search') return null;
    if (!tex) { this.info = 'no camera image (camera-access not granted?)'; return null; }
    if (!df.ok) { this.info = 'waiting for depth'; return null; }
    if (now - this.lastT < 1 / Math.max(1, P.findHz)) return null;
    this.lastT = now;
    const w = P.findWidth | 0, h = Math.max(16, Math.round(w * aspect));
    const img = this.grab(renderer, tex, w, h, P.camFlipY);
    const pts = this.detect(img, w, h, P);
    this.corners2d = pts;
    if (!pts) { this.history.length = 0; return null; }
    const pose = this.solve(df, pts, P);
    if (!pose) { this.history.length = 0; return null; }
    const last = this.history[this.history.length - 1];
    const dist = pose.center.distanceTo(df.camPos);
    if (last && (last.center.distanceTo(pose.center) > 0.03 + 0.02 * dist || last.normal.angleTo(pose.normal) > 0.15)) this.history.length = 0;
    this.history.push(pose);
    this.info = `found ${this.history.length}/${P.findLock} (${pose.w.toFixed(2)} x ${pose.h.toFixed(2)} m)`;
    if (this.history.length < P.findLock) return null;
    // Average the consistent detections.
    const avg = { center: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), normal: new THREE.Vector3(), w: 0, h: 0 };
    for (const p of this.history) { avg.center.add(p.center); avg.right.add(p.right); avg.up.add(p.up); avg.normal.add(p.normal); avg.w += p.w; avg.h += p.h; }
    const k = this.history.length;
    avg.center.divideScalar(k); avg.right.normalize(); avg.normal.normalize();
    avg.up.crossVectors(avg.normal, avg.right).normalize();
    avg.w /= k; avg.h /= k;
    this.pose = avg;
    this.state = 'locked';
    this.info = `locked ${avg.w.toFixed(2)} x ${avg.h.toFixed(2)} m`;
    return avg;
  }
}

// Desktop-page look for the preview monitor: neon frame, title, QR-ish block.
export function desktopPageTexture(neon) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 576;
  const c = cv.getContext('2d');
  c.fillStyle = '#0b0b0b'; c.fillRect(0, 0, 1024, 576);
  c.strokeStyle = neon; c.lineWidth = 34; c.strokeRect(17, 17, 1024 - 34, 576 - 34);
  c.fillStyle = '#fff'; c.font = '900 64px system-ui, Arial, sans-serif'; c.textAlign = 'center';
  c.fillText('LET IT SNOW', 512, 170);
  c.fillText('IN YOUR ROOM.', 512, 240);
  c.fillStyle = '#fff'; c.fillRect(412, 290, 200, 200);
  c.fillStyle = '#0b0b0b';
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if ((x * 7 + y * 13 + x * y) % 3 === 0) c.fillRect(422 + x * 18, 300 + y * 18, 16, 16);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
