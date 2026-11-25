// World model built from depth frames.
//  SnowWorld: horizontal surface levels per column (x,z cell), each holding a snow height.
//             Multiple levels per column are allowed (floor under a table, the table top).
//  Occupancy: coarse voxels with "seen empty" evidence. A voxel that gets hit shortly after it was
//             seen empty is dynamic: that is how real people and moving things are detected.

const colKey = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
const voxKey = (ix, iy, iz) => ((ix + 1024) * 2048 + (iy + 1024)) * 2048 + (iz + 1024);

export class SnowWorld {
  constructor(cell, isVirtual = false) {
    this.cell = cell;
    this.isVirtual = isVirtual;
    // Optional local frame (position + yaw), used for the logo so its snow grid follows the letters.
    this.frame = null;
    this._l = [0, 0, 0];
    this.cols = new Map();
    this.levels = [];
    this.version = 0;          // bumps whenever a level is added or removed
    this.dirtyTiles = new Set();
    this.tileCells = 20;       // cells per render tile edge
  }

  setFrame(px, py, pz, yaw) {
    this.frame = { px, py, pz, c: Math.cos(yaw), s: Math.sin(yaw) };
  }

  // World -> local (identity without a frame). Writes into this._l.
  local(x, y, z) {
    const f = this.frame, o = this._l;
    if (!f) { o[0] = x; o[1] = y; o[2] = z; return o; }
    const dx = x - f.px, dz = z - f.pz;
    o[0] = f.c * dx - f.s * dz;
    o[1] = y - f.py;
    o[2] = f.s * dx + f.c * dz;
    return o;
  }

  // Local -> world for a level (for spawning chunks) and for a direction.
  worldPos(l, out) {
    const f = this.frame;
    if (!f) { out[0] = l.x; out[1] = l.y; out[2] = l.z; return out; }
    out[0] = f.px + f.c * l.x + f.s * l.z;
    out[1] = f.py + l.y;
    out[2] = f.pz - f.s * l.x + f.c * l.z;
    return out;
  }

  worldDir(dx, dz, out) {
    const f = this.frame;
    if (!f) { out[0] = dx; out[1] = dz; return out; }
    out[0] = f.c * dx + f.s * dz;
    out[1] = -f.s * dx + f.c * dz;
    return out;
  }

  clear() {
    this.cols.clear();
    this.levels.length = 0;
    this.version++;
    this.dirtyTiles.add('all');
  }

  tileOf(l) { return Math.floor(l.ix / this.tileCells) + ',' + Math.floor(l.iz / this.tileCells); }
  markDirty(l) {
    l.mv = l.vis;
    this.dirtyTiles.add(l.tile);
    // Corner heights read neighbors, so cells on a tile border also touch the next tile.
    const T = this.tileCells;
    const tx = Math.floor(l.ix / T), tz = Math.floor(l.iz / T);
    const rx = l.ix - tx * T, rz = l.iz - tz * T;
    const ox = rx === 0 ? -1 : rx === T - 1 ? 1 : 0;
    const oz = rz === 0 ? -1 : rz === T - 1 ? 1 : 0;
    if (ox) this.dirtyTiles.add((tx + ox) + ',' + tz);
    if (oz) this.dirtyTiles.add(tx + ',' + (tz + oz));
    if (ox && oz) this.dirtyTiles.add((tx + ox) + ',' + (tz + oz));
  }

  levelAt(ix, iz, y, tol) {
    const arr = this.cols.get(colKey(ix, iz));
    if (!arr) return null;
    let best = null, bd = tol;
    for (let k = 0; k < arr.length; k++) {
      const dy = Math.abs(arr[k].y - y);
      if (dy < bd) { bd = dy; best = arr[k]; }
    }
    return best;
  }

  column(ix, iz) { return this.cols.get(colKey(ix, iz)); }

  addLevel(ix, iz, y, conf, now) {
    const key = colKey(ix, iz);
    let arr = this.cols.get(key);
    if (!arr) { arr = []; this.cols.set(key, arr); }
    const l = {
      ix, iz, x: (ix + 0.5) * this.cell, z: (iz + 0.5) * this.cell, y,
      conf, noise: 0.01, snow: 0, vis: 0, sup: now, knockT: -1e9, intrudeT: -1e9,
      covered: false, idx: this.levels.length, tile: '', virtual: this.isVirtual, mv: 0,
    };
    l.tile = this.tileOf(l);
    arr.push(l);
    arr.sort((a, b) => b.y - a.y);
    for (let k = 0; k < arr.length; k++) arr[k].covered = k > 0;
    this.levels.push(l);
    this.version++;
    this.markDirty(l);
    return l;
  }

  removeLevel(l) {
    const key = colKey(l.ix, l.iz);
    const arr = this.cols.get(key);
    if (arr) {
      const k = arr.indexOf(l);
      if (k >= 0) arr.splice(k, 1);
      if (!arr.length) this.cols.delete(key);
      else for (let j = 0; j < arr.length; j++) arr[j].covered = j > 0;
    }
    const last = this.levels.pop();
    if (last !== l) { this.levels[l.idx] = last; last.idx = l.idx; }
    this.version++;
    this.markDirty(l);
  }

  // Feed horizontal samples from a depth frame.
  support(df, P, now) {
    const { cols, rows, valid, ny, wx, wy, wz, camPos } = df;
    const cell = this.cell;
    // Each sample covers a footprint that grows with distance and with how flat the view ray hits
    // the surface. Splat it over that footprint so far floors do not end up as a sparse checkerboard.
    const perSample = Math.abs(df.rayX[cols - 1] - df.rayX[0]) / Math.max(1, cols - 1);
    for (let i = 0, n = cols * rows; i < n; i++) {
      if (!valid[i] || ny[i] < P.upNormal) continue;
      const x = wx[i], y = wy[i], z = wz[i];
      const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
      this.supportCell(ix, iz, y, P, now, P.levelGain, P.levelYLerp);
      const dx = x - camPos.x, dyc = y - camPos.y, dz = z - camPos.z;
      const dist = Math.hypot(dx, dyc, dz);
      const r = Math.min(0.12, 0.5 * dist * perSample / Math.max(0.2, Math.abs(dyc) / dist));
      const rc = Math.min(2, Math.round(r / cell));
      if (rc < 1) continue;
      for (let oz = -rc; oz <= rc; oz++) {
        for (let ox = -rc; ox <= rc; ox++) {
          if ((!ox && !oz) || ox * ox + oz * oz > rc * rc + 0.5) continue;
          this.supportCell(ix + ox, iz + oz, y, P, now, P.levelGain * 0.5, P.levelYLerp * 0.3);
        }
      }
    }
  }

  supportCell(ix, iz, y, P, now, gain, lerp) {
    const l = this.levelAt(ix, iz, y, P.levelMerge);
    if (!l) { this.addLevel(ix, iz, y, gain, now); return; }
    const dy = y - l.y;
    l.y += dy * lerp;
    l.noise = l.noise * 0.96 + Math.abs(dy) * 0.04;
    l.conf += (1 - l.conf) * gain;
    l.sup = now;
  }

  // Levels that are seen through (the real depth is clearly behind them) lose confidence.
  // Returns levels that were removed so their snow can fall.
  freeEvidence(df, P, now, removed) {
    const out = [0];
    const d = df.d;
    for (let k = this.levels.length - 1; k >= 0; k--) {
      const l = this.levels[k];
      const idx = df.project(l.x, l.y, l.z, out);
      if (idx < 0) continue;
      const dm = d[idx];
      if (!(dm > 0)) continue;
      const dl = out[0];
      const margin = P.freeMargin + P.freeMarginQuad * dm * dm + 0.02;
      if (dl < dm - margin) {
        l.conf -= P.levelLoss;
        if (l.conf <= 0) { removed.push(l); this.removeLevel(l); }
      }
    }
  }

  update(dt, P, now) {
    const regrow = 1.5;
    const grow = Math.min(1, dt / Math.max(0.05, P.freshFade));
    for (let k = 0; k < this.levels.length; k++) {
      const l = this.levels[k];
      if (!this.isVirtual && l.conf >= P.levelConfOn && now - l.knockT > regrow) {
        // Covered levels (under a table) get only a little snow.
        const rate = P.ambientRate * (l.covered ? 0.08 : 1);
        if (l.snow < P.maxSnow) l.snow = Math.min(P.maxSnow, l.snow + rate * dt);
      }
      const target = l.conf >= P.levelConfOn || l.virtual ? l.snow : 0;
      if (Math.abs(target - l.vis) > 1e-5) {
        l.vis += (target - l.vis) * (target < l.vis ? 1 : grow);
        // Rebuild only after a visible change (slow growth would otherwise keep every tile dirty).
        if (Math.abs(l.vis - l.mv) > 0.0008 || target === 0) this.markDirty(l);
      }
    }
  }

  // Smooth snow heights between neighbors of the same level: rounder caps, no single-cell spikes.
  smooth(P) {
    const a = P.smooth;
    if (a <= 0) return;
    const tol = P.levelMerge;
    for (let k = 0; k < this.levels.length; k++) {
      const l = this.levels[k];
      if (l.snow <= 0) continue;
      let sum = 0, n = 0;
      for (let j = 0; j < 4; j++) {
        const nx = l.ix + (j === 0 ? 1 : j === 1 ? -1 : 0), nz = l.iz + (j === 2 ? 1 : j === 3 ? -1 : 0);
        const nl = this.levelAt(nx, nz, l.y, tol);
        if (nl && (nl.conf >= P.levelConfOn || nl.virtual)) { sum += nl.snow; n++; }
      }
      if (n) {
        l.snow += (sum / n - l.snow) * a * (n / 4);
        this.markDirty(l);
      }
    }
  }

  isLive(l, P) { return l.virtual || l.conf >= P.levelConfOn; }

  // Find the highest live level whose snow top was crossed between yPrev and yNow.
  landing(x, z, yPrev, yNow, P) {
    if (this.frame) {
      const f = this.frame, dx = x - f.px, dz = z - f.pz;
      x = f.c * dx - f.s * dz; z = f.s * dx + f.c * dz; yPrev -= f.py; yNow -= f.py;
    }
    const arr = this.cols.get(colKey(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!arr) return null;
    for (let k = 0; k < arr.length; k++) {
      const l = arr[k];
      if (!this.isLive(l, P)) continue;
      const top = l.y + l.vis;
      if (yPrev >= top - 0.002 && yNow <= top) return l;
    }
    return null;
  }

  // Level close below a point (used for depth hits in view).
  near(x, y, z, P) {
    if (this.frame) { const o = this.local(x, y, z); x = o[0]; y = o[1]; z = o[2]; }
    const arr = this.cols.get(colKey(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!arr) return null;
    for (let k = 0; k < arr.length; k++) {
      const l = arr[k];
      if (!this.isLive(l, P)) continue;
      if (y >= l.y - 0.06 && y <= l.y + l.vis + 0.1) return l;
    }
    return null;
  }

  // Add snow around a level, spread over 3x3 cells.
  deposit(l, amount, P) {
    const W = [0.4, 0.1, 0.05];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const w = W[Math.abs(dx) + Math.abs(dz)];
        const nl = (dx || dz) ? this.levelAt(l.ix + dx, l.iz + dz, l.y, P.levelMerge) : l;
        if (!nl || !this.isLive(nl, P)) continue;
        const cap = nl.virtual ? P.logoSnow * 1.6 : P.maxSnow * 1.3;
        if (nl.snow < cap) { nl.snow = Math.min(cap, nl.snow + amount * w / 0.4); this.markDirty(nl); }
      }
    }
  }

  // Dynamic samples (points of real moving things) knock snow off levels below them.
  // emit(level, amount, dirX, dirZ) is called for every level that loses snow.
  knock(points, nPoints, P, now, emit) {
    if (!nPoints) return 0;
    const cell = this.cell;
    const hits = new Map();
    for (let p = 0; p < nPoints; p++) {
      let x = points[p * 3], y = points[p * 3 + 1], z = points[p * 3 + 2];
      if (this.frame) { const o = this.local(x, y, z); x = o[0]; y = o[1]; z = o[2]; }
      const arr = this.cols.get(colKey(Math.floor(x / cell), Math.floor(z / cell)));
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const l = arr[k];
        if (!this.isLive(l, P)) continue;
        const h = y - (l.y + l.vis);
        if (h > Math.max(P.knockMinH, 3 * l.noise) && h < P.knockMaxH) {
          hits.set(l, (hits.get(l) || 0) + 1);
        }
      }
    }
    let knocked = 0;
    const R = P.knockRadius | 0;
    for (const [l, cnt] of hits) {
      if (cnt < P.knockMinPts) continue;
      // Intrusion direction: from columns that were intruded a moment ago toward this one.
      let dx = 0, dz = 0;
      for (let oz = -3; oz <= 3; oz++) {
        for (let ox = -3; ox <= 3; ox++) {
          if (!ox && !oz) continue;
          const nl = this.levelAt(l.ix + ox, l.iz + oz, l.y, P.levelMerge);
          if (nl && now - nl.intrudeT < 0.6 && now - nl.intrudeT > 0.02) { dx -= ox; dz -= oz; }
        }
      }
      l.intrudeT = now;
      const len = Math.hypot(dx, dz);
      if (len > 0) { dx /= len; dz /= len; }
      for (let oz = -R; oz <= R; oz++) {
        for (let ox = -R; ox <= R; ox++) {
          if (ox * ox + oz * oz > R * R + 0.5) continue;
          const nl = (ox || oz) ? this.levelAt(l.ix + ox, l.iz + oz, l.y, P.levelMerge) : l;
          if (!nl) continue;
          nl.knockT = now;
          if (nl.vis > 0.002) {
            emit(nl, nl.vis, dx, dz);
            nl.snow = 0; nl.vis = 0;
            this.markDirty(nl);
            knocked++;
          }
        }
      }
    }
    return knocked;
  }
}

export class Occupancy {
  constructor() {
    this.map = new Map();
    this.list = [];
    this.frame = 0;
    this.cursor = 0;
    this.dynPts = new Float32Array(3 * 4096);
    this.nDyn = 0;
    this.push = new Map();        // coarse cell -> [x,y,z,...] of dynamic voxel centers
    this.pushCell = 0.25;
    this.size = 0.1;
  }

  clear() { this.map.clear(); this.list.length = 0; this.push.clear(); this.nDyn = 0; }

  update(df, P, now, gateDynamic) {
    this.frame++;
    const s = this.size = P.vox;
    const { cols, rows, valid, wx, wy, wz } = df;
    this.nDyn = 0;
    const dyn = this.dynPts;
    for (let i = 0, n = cols * rows; i < n; i++) {
      if (!valid[i]) continue;
      const x = wx[i], y = wy[i], z = wz[i];
      const ix = Math.floor(x / s), iy = Math.floor(y / s), iz = Math.floor(z / s);
      const key = voxKey(ix, iy, iz);
      let v = this.map.get(key);
      if (!v) {
        v = { key, x: (ix + 0.5) * s, y: (iy + 0.5) * s, z: (iz + 0.5) * s, occ: 0, freeT: -1e9, freeN: 0, hitT: now, dynT: -1e9, frame: 0, run: 0 };
        this.map.set(key, v);
        this.list.push(v);
      }
      if (v.frame !== this.frame) {
        // Dynamic = clearly seen empty (more than once) shortly before, and now hit in consecutive
        // frames. Single-frame hits near edges of static furniture are the usual false alarms.
        v.run = v.frame === this.frame - 1 ? v.run + 1 : 1;
        v.frame = this.frame;
        if (gateDynamic && v.run >= 2 && v.freeN >= 2 && now - v.freeT < P.dynWindow && v.occ < P.dynOccMax) v.dynT = now;
        v.occ += (1 - v.occ) * P.occGain;
        if (v.occ > 0.9) v.freeN = 0;
        v.hitT = now;
      }
      if (v.dynT === now && this.nDyn < 4096) {
        dyn[this.nDyn * 3] = x; dyn[this.nDyn * 3 + 1] = y; dyn[this.nDyn * 3 + 2] = z;
        this.nDyn++;
      }
    }

    // "Seen empty" evidence, round robin so big rooms stay cheap.
    const out = [0];
    const d = df.d;
    const budget = Math.min(this.list.length, 9000);
    for (let b = 0; b < budget; b++) {
      if (this.cursor >= this.list.length) this.cursor = 0;
      const v = this.list[this.cursor];
      const idx = df.project(v.x, v.y, v.z, out);
      if (idx >= 0 && v.frame !== this.frame) {
        const dm = d[idx];
        if (dm > 0) {
          const margin = P.freeMargin + P.freeMarginQuad * dm * dm + s * 0.5;
          if (out[0] < dm - margin) { v.occ *= 1 - P.occLoss; v.freeT = now; if (v.freeN < 6) v.freeN++; }
        }
      }
      // Forget long-empty voxels.
      if (v.occ < 0.02 && now - v.hitT > 8) {
        this.map.delete(v.key);
        const last = this.list.pop();
        if (last !== v) this.list[this.cursor] = last;
        continue;
      }
      this.cursor++;
    }

    // Coarse push grid from recently dynamic voxels.
    this.push.clear();
    const pc = this.pushCell;
    for (let k = 0; k < this.list.length; k++) {
      const v = this.list[k];
      if (now - v.dynT > 0.25) continue;
      const key = voxKey(Math.floor(v.x / pc), Math.floor(v.y / pc), Math.floor(v.z / pc));
      let arr = this.push.get(key);
      if (!arr) { arr = []; this.push.set(key, arr); }
      arr.push(v.x, v.y, v.z);
    }
  }

  // Push sources near a point (returns array of x,y,z triples or undefined).
  sourcesAt(x, y, z) {
    const pc = this.pushCell;
    return this.push.get(voxKey(Math.floor(x / pc), Math.floor(y / pc), Math.floor(z / pc)));
  }
}
