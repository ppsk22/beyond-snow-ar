// World model built from depth frames.
//  SnowWorld: horizontal surface levels per column (x,z cell), each holding a snow height.
//             Multiple levels per column are allowed (floor under a table, the table top).
//             A level only carries snow once it is certified: steady over time, seen from more than
//             one viewpoint, low jitter, part of a flat patch, and nothing moved there recently.
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
    this.confirmed = [];       // surfaces confirmed by the user (see surfaces.js)
  }

  // Confirmed surface this level belongs to (floor: any cell at its height; others: inside the rect).
  confirmedFor(l, P) {
    for (const k of this.confirmed) {
      if (Math.abs(l.y - k.y) > P.levelMerge) continue;
      if (k.floor) return k;
      if (l.x >= k.minx - 0.05 && l.x <= k.maxx + 0.05 && l.z >= k.minz - 0.05 && l.z <= k.maxz + 0.05) return k;
    }
    return null;
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
      firstT: now, views: 1, vcx: 0, vcy: 0, vcz: 0, cert: false, certT: 0, pn: -1, lockedBy: 0, py: y, tiny: false,
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

  // Feed horizontal samples from a depth frame. Samples of people or moving things never count.
  support(df, P, now, occ) {
    const { cols, rows, valid, ny, wx, wy, wz, camPos, person, dyn } = df;
    const cell = this.cell;
    // Each sample covers a footprint that grows with distance and with how flat the view ray hits
    // the surface. Splat it over that footprint so far floors do not end up as a sparse checkerboard.
    const perSample = Math.abs(df.rayX[cols - 1] - df.rayX[0]) / Math.max(1, cols - 1);
    for (let i = 0, n = cols * rows; i < n; i++) {
      if (!valid[i] || ny[i] < P.upNormal || person[i] || dyn[i]) continue;
      const x = wx[i], y = wy[i], z = wz[i];
      if (occ && occ.recentDyn(x, y + 0.05, z, P.certDynQuiet)) continue;
      const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
      this.supportCell(ix, iz, y, P, now, P.levelGain, P.levelYLerp, camPos);
      const dx = x - camPos.x, dyc = y - camPos.y, dz = z - camPos.z;
      const dist = Math.hypot(dx, dyc, dz);
      const r = Math.min(0.12, 0.5 * dist * perSample / Math.max(0.2, Math.abs(dyc) / dist));
      const rc = Math.min(2, Math.round(r / cell));
      if (rc < 1) continue;
      for (let oz = -rc; oz <= rc; oz++) {
        for (let ox = -rc; ox <= rc; ox++) {
          if ((!ox && !oz) || ox * ox + oz * oz > rc * rc + 0.5) continue;
          this.supportCell(ix + ox, iz + oz, y, P, now, P.levelGain * 0.5, P.levelYLerp * 0.3, camPos);
        }
      }
    }
  }

  supportCell(ix, iz, y, P, now, gain, lerp, cam) {
    let l = this.levelAt(ix, iz, y, P.levelMerge);
    if (!l) {
      l = this.addLevel(ix, iz, y, gain, now);
      l.vcx = cam.x; l.vcy = cam.y; l.vcz = cam.z;
      return;
    }
    const dy = y - l.y;
    if (!l.lockedBy || !this.confirmed.find((k) => k.id === l.lockedBy && k.floor)) l.y += dy * lerp;
    l.noise = l.noise * 0.96 + Math.abs(dy) * 0.04;
    l.conf += (1 - l.conf) * gain;
    l.sup = now;
    // Count distinct viewpoints: a surface that only one camera position ever saw can be an artifact.
    const mx = cam.x - l.vcx, my = cam.y - l.vcy, mz = cam.z - l.vcz;
    if (mx * mx + my * my + mz * mz > P.certViewDist * P.certViewDist) {
      l.views++;
      l.vcx = cam.x; l.vcy = cam.y; l.vcz = cam.z;
    }
  }

  // Group certified cells into connected regions (neighbors joined when their heights differ by less
  // than plateStep, so a gentle slope stays one region but a table edge splits). Regions smaller than
  // snowMinArea get no snow (monitor edges, cables, mugs). With snowLook 'plates' each region is drawn
  // on its best-fit plane (slopes allowed), which removes the depth wobble that made the blanket spiky.
  plates(P) {
    const seen = new Set();
    const cell = this.cell, tol = P.levelMerge;
    const flat = P.snowLook === 'plates';
    for (const l of this.levels) {
      if (l.virtual || !l.cert || seen.has(l)) continue;
      const group = [l];
      seen.add(l);
      for (let k = 0; k < group.length; k++) {
        const c = group[k];
        for (let d = 0; d < 4; d++) {
          const nl = this.levelAt(c.ix + (d === 0 ? 1 : d === 1 ? -1 : 0), c.iz + (d === 2 ? 1 : d === 3 ? -1 : 0), c.y, tol);
          if (nl && nl.cert && !seen.has(nl) && Math.abs(nl.y - c.y) <= P.plateStep) { seen.add(nl); group.push(nl); }
        }
      }
      const tiny = group.length * cell * cell < P.snowMinArea;
      // Least squares plane y = a x + b z + c (centered for stability).
      let a = 0, b = 0, c0 = 0, mx = 0, mz = 0;
      if (flat && !tiny) {
        const n = group.length;
        let my = 0;
        for (const g of group) { mx += g.x; mz += g.z; my += g.y; }
        mx /= n; mz /= n; my /= n;
        let sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
        for (const g of group) {
          const dx = g.x - mx, dz = g.z - mz, dy = g.y - my;
          sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxy += dx * dy; szy += dz * dy;
        }
        const det = sxx * szz - sxz * sxz;
        if (Math.abs(det) > 1e-9) { a = (sxy * szz - szy * sxz) / det; b = (szy * sxx - sxy * sxz) / det; }
        // Surfaces steeper than about 25 degrees are not snow surfaces anyway: clamp the fit.
        const sl = Math.hypot(a, b);
        if (sl > 0.45) { a *= 0.45 / sl; b *= 0.45 / sl; }
        c0 = my;
      }
      for (const g of group) {
        let ny = g.y;
        if (flat && !tiny) {
          ny = c0 + a * (g.x - mx) + b * (g.z - mz);
          if (Math.abs(ny - g.y) > 0.06) ny = g.y;   // bad fit here: keep the measured height
        }
        if (g.tiny !== tiny || Math.abs(g.py - ny) > 0.002) { g.tiny = tiny; g.py = ny; this.markDirty(g); }
      }
    }
  }

  // Certify levels that are trustworthy, and drop certification when confidence falls apart.
  // uncert(level) is called for levels that lose it (their snow falls).
  certify(P, now, occ, uncert) {
    const tol = P.levelMerge;
    for (let k = 0; k < this.levels.length; k++) {
      const l = this.levels[k];
      if (l.virtual) continue;
      // Confirmed surfaces: certify right away (only a short quiet check), floor cells snap flat.
      if (!l.lockedBy && this.confirmed.length && l.conf >= P.confirmedConf) {
        const k = this.confirmedFor(l, P);
        if (k && !(occ && occ.recentDyn(l.x, l.y + 0.1, l.z, 0.5))) {
          l.lockedBy = k.id;
          if (k.floor) l.y = k.y;
          if (!l.cert) { l.cert = true; l.certT = now; }
          l.conf = Math.max(l.conf, 0.95);
          this.markDirty(l);
        }
      }
      if (l.lockedBy) { if (!l.cert) { l.cert = true; l.certT = now; } continue; }
      if (P.onlyConfirmed) { if (l.cert) { l.cert = false; if (l.vis > 0.002) uncert(l); l.snow = l.vis = 0; this.markDirty(l); } continue; }
      if (l.cert) {
        if (l.conf < P.uncertConf) {
          l.cert = false;
          if (l.vis > 0.002) uncert(l);
          l.snow = 0; l.vis = 0;
          this.markDirty(l);
        }
        continue;
      }
      // Cheap checks first, the neighborhood check last.
      if (l.conf < P.certConf || now - l.firstT < P.certAge || l.views < P.certViews || l.noise > P.certNoise) continue;
      if (occ && (occ.recentDyn(l.x, l.y + 0.05, l.z, P.certDynQuiet) || occ.recentDyn(l.x, l.y + 0.15, l.z, P.certDynQuiet) || occ.recentDyn(l.x, l.y + 0.25, l.z, P.certDynQuiet))) continue;
      let nb = 0;
      const need = P.certNeighbors;
      for (let oz = -2; oz <= 2 && nb < need; oz++) {
        for (let ox = -2; ox <= 2; ox++) {
          if (!ox && !oz) continue;
          const nl = this.levelAt(l.ix + ox, l.iz + oz, l.y, tol);
          if (nl && nl.conf >= P.certConf * 0.75) nb++;
        }
      }
      if (nb < need) continue;
      l.cert = true;
      l.certT = now;
      this.markDirty(l);
    }
  }

  // Levels that are seen through (the real depth is clearly behind them) lose confidence.
  // Returns levels that were removed so their snow can fall.
  freeEvidence(df, P, now, removed) {
    const out = [0];
    const d = df.d;
    for (let k = this.levels.length - 1; k >= 0; k--) {
      const l = this.levels[k];
      if (l.lockedBy) continue;    // confirmed by the user: static by definition
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
      if (!this.isVirtual && l.cert && now - l.knockT > regrow && l.snow < P.maxSnow) {
        // Organic patches: every spot has a noise threshold; "wetness" rises after certification
        // and snow only starts sticking where it passes the threshold. Patches appear, grow, merge.
        if (l.pn < 0) l.pn = patchNoise(l.x, l.z, P.patchScale);
        const wet = (now - l.certT) * P.patchSpeed;
        const g = Math.min(1, Math.max(0, (wet - l.pn) * P.patchSoft));
        // Covered levels (under a table) get only a little snow.
        const rate = P.ambientRate * g * (l.covered ? 0.08 : 1);
        if (rate > 0) l.snow = Math.min(P.maxSnow, l.snow + rate * dt);
      }
      const target = this.isLive(l, P) ? l.snow : 0;
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
      if (!this.isLive(l, P)) continue;
      let sum = 0, n = 0;
      for (let j = 0; j < 4; j++) {
        const nx = l.ix + (j === 0 ? 1 : j === 1 ? -1 : 0), nz = l.iz + (j === 2 ? 1 : j === 3 ? -1 : 0);
        const nl = this.levelAt(nx, nz, l.y, tol);
        if (nl && this.isLive(nl, P)) { sum += nl.snow; n++; }
      }
      if (n) {
        l.snow += (sum / n - l.snow) * a * (n / 4);
        this.markDirty(l);
      }
    }
  }

  isLive(l) { return l.virtual || (l.cert && !l.tiny); }

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
  knock(points, nPoints, P, now, emit, band) {
    const minH = band ? band.minH : null, maxH = band ? band.maxH : P.knockMaxH, minPts = band ? band.minPts : P.knockMinPts;
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
        const lo = minH !== null ? minH : Math.max(P.knockMinH, 3 * l.noise);
        if (h > lo && h < maxH) {
          hits.set(l, (hits.get(l) || 0) + 1);
        }
      }
    }
    let knocked = 0;
    const R = P.knockRadius | 0;
    for (const [l, cnt] of hits) {
      if (cnt < minPts) continue;
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
      // Soft hole: full removal in the middle, fading out toward the radius. Part of the removed snow is
      // pushed into a low ring just outside the hole (knockBerm) instead of flying.
      let removedTotal = 0;
      for (let oz = -R; oz <= R; oz++) {
        for (let ox = -R; ox <= R; ox++) {
          const dd = Math.sqrt(ox * ox + oz * oz);
          if (dd > R + 0.5) continue;
          const nl = (ox || oz) ? this.levelAt(l.ix + ox, l.iz + oz, l.y, P.levelMerge) : l;
          if (!nl || !this.isLive(nl, P)) continue;
          const frac = dd < 0.75 ? 1 : Math.max(0, 1 - (dd - 0.5) / (R + 0.5)) * P.knockEdge;
          if (frac > 0.5) nl.knockT = now;
          const amount = nl.vis * frac;
          if (amount > 0.001) {
            emit(nl, amount * (1 - P.knockBerm), dx, dz);
            removedTotal += amount;
            nl.vis -= amount; nl.snow = Math.max(0, nl.snow - amount);
            this.markDirty(nl);
            knocked++;
          }
        }
      }
      if (P.knockBerm > 0 && removedTotal > 0) {
        const ring = [];
        const R1 = R + 1;
        for (let oz = -R1 - 1; oz <= R1 + 1; oz++) {
          for (let ox = -R1 - 1; ox <= R1 + 1; ox++) {
            const dd = Math.sqrt(ox * ox + oz * oz);
            if (dd < R + 0.6 || dd > R1 + 1.2) continue;
            const nl = this.levelAt(l.ix + ox, l.iz + oz, l.y, P.levelMerge);
            if (nl && this.isLive(nl, P)) ring.push(nl);
          }
        }
        if (ring.length) {
          const add = (removedTotal * P.knockBerm) / ring.length;
          const cap = P.maxSnow * 1.5;
          for (const nl of ring) { nl.snow = Math.min(cap, nl.snow + add); this.markDirty(nl); }
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
    this.personPts = new Float32Array(3 * 4096);
    this.nPerson = 0;
    this.push = new Map();        // coarse cell -> [x,y,z,...] of dynamic voxel centers
    this.pushCell = 0.25;
    this.size = 0.1;
    this.now = 0;
  }

  clear() { this.map.clear(); this.list.length = 0; this.push.clear(); this.nDyn = 0; }

  update(df, P, now, gateDynamic) {
    this.frame++;
    const s = this.size = P.vox;
    const { cols, rows, valid, wx, wy, wz, person, dyn: dflag } = df;
    this.now = now;
    this.nDyn = 0;
    this.nPerson = 0;
    const pp = this.personPts;
    dflag.fill(0);
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
      if (person[i]) {
        // The person mask is direct evidence: always dynamic, no history needed.
        v.dynT = now;
        if (this.nPerson < 4096) { pp[this.nPerson * 3] = x; pp[this.nPerson * 3 + 1] = y; pp[this.nPerson * 3 + 2] = z; this.nPerson++; }
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
      dflag[i] = v.dynT === now ? 1 : 0;
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

  // Was the voxel at this point dynamic within the last `win` seconds?
  recentDyn(x, y, z, win) {
    const s = this.size;
    const v = this.map.get(voxKey(Math.floor(x / s), Math.floor(y / s), Math.floor(z / s)));
    return !!v && this.now - v.dynT < win;
  }

  // Push sources near a point (returns array of x,y,z triples or undefined).
  sourcesAt(x, y, z) {
    const pc = this.pushCell;
    return this.push.get(voxKey(Math.floor(x / pc), Math.floor(y / pc), Math.floor(z / pc)));
  }
}

// Fractal value noise in 0..1 for patch thresholds (world space, stable per spot).
function h2(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vn(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function patchNoise(x, z, scale) {
  const n = vn(x * scale, z * scale) * 0.6 + vn(x * scale * 2.3 + 31, z * scale * 2.3 - 7) * 0.3 + vn(x * scale * 5.1 - 3, z * scale * 5.1 + 11) * 0.1;
  // Stretch to use the whole 0..1 range (value noise clusters around 0.5).
  return Math.min(1, Math.max(0, (n - 0.5) * 1.8 + 0.5));
}
