// A depth frame in one common format, filled either by WebXR CPU depth or by the preview simulation.
// Samples sit on a regular grid in normalized view coordinates (origin top left), depth is view-space z in meters.

import * as THREE from 'three';

export class DepthFrame {
  constructor() {
    this.cols = 0;
    this.rows = 0;
    this.d = new Float32Array(0);      // meters, 0 = invalid
    this.wx = new Float32Array(0);     // world positions of valid samples
    this.wy = new Float32Array(0);
    this.wz = new Float32Array(0);
    this.ny = new Float32Array(0);     // normal.y of each sample (-2 = unknown)
    this.valid = new Uint8Array(0);
    this.proj = new THREE.Matrix4();
    this.projInv = new THREE.Matrix4();
    this.camWorld = new THREE.Matrix4();
    this.view = new THREE.Matrix4();
    this.camPos = new THREE.Vector3();
    this.rayX = new Float32Array(0);   // view-space ray per sample, scaled so z = -1
    this.rayY = new Float32Array(0);
    this._projKey = '';
    this.ok = false;
    this.time = 0;
  }

  resize(cols, rows) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.d = new Float32Array(n);
    this.wx = new Float32Array(n); this.wy = new Float32Array(n); this.wz = new Float32Array(n);
    this.ny = new Float32Array(n);
    this.valid = new Uint8Array(n);
    this.rayX = new Float32Array(n); this.rayY = new Float32Array(n);
    this._projKey = '';
  }

  setCamera(projArray, camWorldArray) {
    this.proj.fromArray(projArray);
    this.camWorld.fromArray(camWorldArray);
    this.view.copy(this.camWorld).invert();
    this.camPos.setFromMatrixPosition(this.camWorld);
    const key = Array.prototype.join.call(projArray, ',') + '|' + this.cols + 'x' + this.rows;
    if (key !== this._projKey) {
      this._projKey = key;
      this.projInv.copy(this.proj).invert();
      const v = new THREE.Vector3();
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const x = (c + 0.5) / this.cols, y = (r + 0.5) / this.rows;
          v.set(x * 2 - 1, 1 - y * 2, 0.5).applyMatrix4(this.projInv);
          const i = r * this.cols + c;
          this.rayX[i] = v.x / -v.z;
          this.rayY[i] = v.y / -v.z;
        }
      }
    }
  }

  // Unproject valid samples to world space, reject flying pixels, estimate normal.y.
  process(P) {
    const { cols, rows, d, valid, wx, wy, wz, ny, rayX, rayY } = this;
    const m = this.camWorld.elements;
    const rej = P.edgeReject;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const z = d[i];
        let ok = z >= P.depthMin && z <= P.depthMax;
        if (ok) {
          // Neighbors that jump in depth mark an edge: the sample there is often a blend of both sides.
          const lim = rej * z;
          let q;
          if (c > 0 && (q = d[i - 1]) > 0 && Math.abs(q - z) > lim) ok = false;
          else if (c < cols - 1 && (q = d[i + 1]) > 0 && Math.abs(q - z) > lim) ok = false;
          else if (r > 0 && (q = d[i - cols]) > 0 && Math.abs(q - z) > lim) ok = false;
          else if (r < rows - 1 && (q = d[i + cols]) > 0 && Math.abs(q - z) > lim) ok = false;
        }
        valid[i] = ok ? 1 : 0;
        if (!ok) continue;
        const vx = rayX[i] * z, vy = rayY[i] * z, vz = -z;
        wx[i] = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
        wy[i] = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
        wz[i] = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
      }
    }
    // Normals from central differences two samples apart (one apart is too noisy on ARCore depth).
    const s = 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        ny[i] = -2;
        if (!valid[i]) continue;
        const cl = Math.max(0, c - s), cr = Math.min(cols - 1, c + s);
        const ru = Math.max(0, r - s), rd = Math.min(rows - 1, r + s);
        const a = r * cols + cl, b = r * cols + cr, u = ru * cols + c, w = rd * cols + c;
        if (!valid[a] || !valid[b] || !valid[u] || !valid[w]) continue;
        const ax = wx[b] - wx[a], ay = wy[b] - wy[a], az = wz[b] - wz[a];
        const bx = wx[w] - wx[u], by = wy[w] - wy[u], bz = wz[w] - wz[u];
        const nx = ay * bz - az * by, nyy = az * bx - ax * bz, nz = ax * by - ay * bx;
        const len = Math.hypot(nx, nyy, nz);
        if (len < 1e-9) continue;
        ny[i] = Math.abs(nyy / len); // sign depends on grid orientation; floors and tops both count
      }
    }
    this.ok = true;
  }

  // Project a world point into the grid. Returns sample index or -1, and writes view depth to out[0].
  project(x, y, z, out) {
    const v = this.view.elements;
    const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
    const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
    const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    if (vz > -0.05) return -1;
    const p = this.proj.elements;
    const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
    const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
    const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
    const nx = cx / cw, ny = cy / cw;
    if (nx <= -1 || nx >= 1 || ny <= -1 || ny >= 1) return -1;
    const c = Math.floor((nx + 1) * 0.5 * this.cols);
    const r = Math.floor((1 - ny) * 0.5 * this.rows);
    out[0] = -vz;
    return r * this.cols + c;
  }
}
