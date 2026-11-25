// Renders the snow of a SnowWorld as one continuous blanket.
// Corner heights are averaged over the 4 touching cells of the same level, then every cell is cut
// along the iso line "height = threshold" (marching squares). Empty cells next to snow ("fringe")
// are cut too, so patch borders become smooth curves instead of 5 cm squares.
// The world is split into tiles; only dirty tiles are rebuilt, within a per-frame budget.

import * as THREE from 'three';

const EPS = 0.0015;          // snow thinner than this is not drawn (the contour threshold)
const MAXV = 6;              // marching squares yields at most 6 vertices per cell
const MAXI = 12;             // and at most 4 triangles

export class BlanketRenderer {
  constructor(world, material, parent) {
    this.world = world;
    this.material = material;
    this.group = new THREE.Group();
    parent.add(this.group);
    this.tiles = new Map();       // tileKey -> { mesh, cap, levels: [] }
    this.indexVersion = -1;
    this.lift = 0.004;            // keeps the blanket from z-fighting with noisy real surfaces
    this.lumpScale = 1;
    this.edgeTilt = 1.2;          // how strongly patch edges lean outward (drives outline and shade band)
    // scratch
    this.hh = new Float32Array(16);  // 4x4 cell heights around the cell (-1 = no live level)
    this.yy = new Float32Array(16);
    this.cx = new Float32Array(4); this.cy = new Float32Array(4); this.cz = new Float32Array(4);
    this.ch = new Float32Array(4);
    this.nx = new Float32Array(4); this.ny = new Float32Array(4); this.nz = new Float32Array(4);
    this.fringe = new Set();
  }

  reindex() {
    for (const t of this.tiles.values()) t.levels.length = 0;
    for (const l of this.world.levels) {
      let t = this.tiles.get(l.tile);
      if (!t) t = this.makeTile(l.tile);
      t.levels.push(l);
    }
    this.indexVersion = this.world.version;
  }

  makeTile(key) {
    const geo = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    const t = { key, mesh, geo, cap: 0, levels: [], pos: null, nor: null, idx: null };
    this.tiles.set(key, t);
    return t;
  }

  ensure(t, cells) {
    if (cells <= t.cap) return;
    let cap = Math.max(64, t.cap);
    while (cap < cells) cap *= 2;
    t.cap = cap;
    t.pos = new Float32Array(cap * MAXV * 3);
    t.nor = new Float32Array(cap * MAXV * 3);
    t.idx = new Uint32Array(cap * MAXI);
    t.geo.setAttribute('position', new THREE.BufferAttribute(t.pos, 3).setUsage(THREE.DynamicDrawUsage));
    t.geo.setAttribute('normal', new THREE.BufferAttribute(t.nor, 3).setUsage(THREE.DynamicDrawUsage));
    t.geo.setIndex(new THREE.BufferAttribute(t.idx, 1).setUsage(THREE.DynamicDrawUsage));
  }

  lv(ix, iz, y, P) {
    const l = this.world.levelAt(ix, iz, y, P.levelMerge);
    return l && this.world.isLive(l, P) ? l : null;
  }

  // Fill the 4x4 neighborhood (cells ix-1..ix+2, iz-1..iz+2) used by this cell's 4 corners.
  gather(ix, iz, y, P) {
    const cell = this.world.cell;
    const amt = P.lumps * this.lumpScale;
    for (let dz = -1; dz <= 2; dz++) {
      for (let dx = -1; dx <= 2; dx++) {
        const k = (dz + 1) * 4 + (dx + 1);
        const nl = this.lv(ix + dx, iz + dz, y, P);
        // Lumps are applied per cell, so heights and normals agree (and the toon steps show them).
        this.hh[k] = nl ? nl.vis * lump((ix + dx + 0.5) * cell, (iz + dz + 0.5) * cell, amt) : -1;
        this.yy[k] = nl ? nl.y : y;
      }
    }
  }

  // Corner c (0..3 = (0,0),(1,0),(1,1),(0,1)) of the current cell: height, base y, normal.
  corner(c, ix, iz, y) {
    const cell = this.world.cell, hh = this.hh, yy = this.yy;
    const cx = c === 1 || c === 2 ? 1 : 0, cz = c >= 2 ? 1 : 0;
    // The 4 cells around this corner in the 4x4 grid: rows cz..cz+1, cols cx..cx+1
    const a = cz * 4 + cx, b = a + 1, d = a + 4, e = a + 5;
    const A = Math.max(0, hh[a]), B = Math.max(0, hh[b]), D = Math.max(0, hh[d]), E = Math.max(0, hh[e]);
    let ys = 0, yn = 0;
    if (hh[a] >= 0) { ys += yy[a]; yn++; }
    if (hh[b] >= 0) { ys += yy[b]; yn++; }
    if (hh[d] >= 0) { ys += yy[d]; yn++; }
    if (hh[e] >= 0) { ys += yy[e]; yn++; }
    this.ch[c] = (A + B + D + E) * 0.25;
    this.cy[c] = yn ? ys / yn : y;
    // Corners sit a little outside the cell: tiles are rebuilt at different moments and the small
    // overlap hides hairline cracks between them.
    const g = 0.06;
    this.cx[c] = (ix + cx + (cx ? g : -g)) * cell;
    this.cz[c] = (iz + cz + (cz ? g : -g)) * cell;
    const gx = ((B + E) - (A + D)) / (2 * cell);
    const gz = ((D + E) - (A + B)) / (2 * cell);
    const nl = Math.hypot(gx, 1, gz);
    this.nx[c] = -gx / nl; this.ny[c] = 1 / nl; this.nz[c] = -gz / nl;
  }

  // Emit the marching squares polygon of the current cell. Returns vertices written.
  emit(t, v0, i0) {
    const pos = t.pos, nor = t.nor, idx = t.idx, lift = this.lift;
    const { ch, cx, cy, cz, nx, ny, nz } = this;
    let n = 0;
    const put = (x, y, z, a, b, c) => {
      const o = (v0 + n) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      nor[o] = a; nor[o + 1] = b; nor[o + 2] = c;
      n++;
    };
    for (let c = 0; c < 4; c++) {
      const c2 = (c + 1) & 3;
      const inA = ch[c] > EPS, inB = ch[c2] > EPS;
      if (inA) put(cx[c], cy[c] + ch[c] + lift, cz[c], nx[c], ny[c], nz[c]);
      if (inA !== inB) {
        const t2 = (EPS - ch[c]) / (ch[c2] - ch[c]);
        // Contour vertex sits on the surface; its normal leans outward so the edge reads as a rounded lip.
        const ex = cx[c] + (cx[c2] - cx[c]) * t2, ez = cz[c] + (cz[c2] - cz[c]) * t2;
        const ey = cy[c] + (cy[c2] - cy[c]) * t2;
        // Tilt the normal outward (from the snowy corner toward the empty one), like a rounded edge.
        let ox = cx[c2] - cx[c], oz = cz[c2] - cz[c];
        if (inB) { ox = -ox; oz = -oz; }
        const ol = Math.hypot(ox, oz) || 1;
        const k = this.edgeTilt;
        let qx = nx[c] + (nx[c2] - nx[c]) * t2 + (ox / ol) * k;
        let qy = ny[c] + (ny[c2] - ny[c]) * t2;
        let qz = nz[c] + (nz[c2] - nz[c]) * t2 + (oz / ol) * k;
        const ql = Math.hypot(qx, qy, qz);
        put(ex, ey + lift, ez, qx / ql, qy / ql, qz / ql);
      }
    }
    if (n < 3) return [0, 0];
    // Fan triangulation; winding chosen so faces point up (corner order runs +x then +z).
    let k = 0;
    for (let j = 1; j < n - 1; j++) {
      idx[i0 + k++] = v0; idx[i0 + k++] = v0 + j + 1; idx[i0 + k++] = v0 + j;
    }
    return [n, k];
  }

  build(t, P) {
    const fr = this.fringe;
    fr.clear();
    // Fringe cells: empty neighbors of live cells, so borders get a smooth falloff instead of a cut.
    for (const l of t.levels) {
      if (!this.world.isLive(l, P) || l.vis <= EPS) continue;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          if (this.lv(l.ix + dx, l.iz + dz, l.y, P)) continue;
          fr.add((l.ix + dx) + ',' + (l.iz + dz) + ',' + Math.round(l.y * 50));
        }
      }
    }
    this.ensure(t, t.levels.length + fr.size);
    let v = 0, i = 0;
    for (const l of t.levels) {
      if (!this.world.isLive(l, P)) continue;
      this.gather(l.ix, l.iz, l.y, P);
      let any = false;
      for (let k = 0; k < 16; k++) if (this.hh[k] > EPS) { any = true; break; }
      if (!any) continue;
      for (let c = 0; c < 4; c++) this.corner(c, l.ix, l.iz, l.y);
      const [nv, ni] = this.emit(t, v, i);
      v += nv; i += ni;
    }
    for (const key of fr) {
      const parts = key.split(',');
      const ix = +parts[0], iz = +parts[1], y = +parts[2] / 50;
      // Fringe cells belong to the tile of their live neighbor, so a cell may appear in two tiles
      // at a tile border; both draw the same polygon, which is harmless.
      this.gather(ix, iz, y, P);
      for (let c = 0; c < 4; c++) this.corner(c, ix, iz, y);
      const [nv, ni] = this.emit(t, v, i);
      v += nv; i += ni;
    }
    const g = t.geo;
    if (g.attributes.position) {
      for (const a of [g.attributes.position, g.attributes.normal, g.index]) {
        a.needsUpdate = true;
        a.updateRanges.length = 0;
      }
      g.attributes.position.addUpdateRange(0, v * 3);
      g.attributes.normal.addUpdateRange(0, v * 3);
      g.index.addUpdateRange(0, i);
    }
    g.setDrawRange(0, i);
    return t.levels.length;
  }

  update(P, budgetCells) {
    const w = this.world;
    if (w.dirtyTiles.has('all')) {
      for (const t of this.tiles.values()) { this.group.remove(t.mesh); t.geo.dispose(); }
      this.tiles.clear();
      w.dirtyTiles.clear();
      for (const l of w.levels) w.dirtyTiles.add(l.tile);
      this.indexVersion = -1;
    }
    if (this.indexVersion !== w.version) this.reindex();
    let spent = 0;
    for (const key of w.dirtyTiles) {
      const t = this.tiles.get(key);
      w.dirtyTiles.delete(key);
      if (!t) continue;
      spent += this.build(t, P);
      if (spent > budgetCells) break;
    }
    return spent;
  }
}

// Smooth value noise in world space: gentle lumps so the toon steps have something to draw.
function hash(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function lump(x, z, amount) {
  if (!amount) return 1;
  const n = vnoise(x * 3.0, z * 3.0) * 0.6 + vnoise(x * 8.0 + 17, z * 8.0 - 5) * 0.4;
  return 1 + (n - 0.5) * 2 * amount;
}
