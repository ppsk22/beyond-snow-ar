// Renders the snow of a SnowWorld as a continuous blanket: one quad per surface cell, corner heights
// averaged over the 4 touching cells of the same level, so caps round off at edges (like the 2D glyph caps).
// The world is split into tiles; only dirty tiles are rebuilt, within a per-frame budget.

import * as THREE from 'three';

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

  ensure(t, quads) {
    if (quads <= t.cap) return;
    let cap = Math.max(64, t.cap);
    while (cap < quads) cap *= 2;
    t.cap = cap;
    t.pos = new Float32Array(cap * 12);
    t.nor = new Float32Array(cap * 12);
    t.idx = new Uint32Array(cap * 6);
    t.geo.setAttribute('position', new THREE.BufferAttribute(t.pos, 3).setUsage(THREE.DynamicDrawUsage));
    t.geo.setAttribute('normal', new THREE.BufferAttribute(t.nor, 3).setUsage(THREE.DynamicDrawUsage));
    t.geo.setIndex(new THREE.BufferAttribute(t.idx, 1).setUsage(THREE.DynamicDrawUsage));
  }

  // Height of the snow in a cell that belongs to the same level as y (0 if no live level there).
  lv(ix, iz, y, P) {
    const l = this.world.levelAt(ix, iz, y, P.levelMerge);
    return l && this.world.isLive(l, P) ? l : null;
  }

  build(t, P) {
    const cell = this.world.cell;
    const lift = this.lift;
    let q = 0;
    this.ensure(t, t.levels.length);
    const pos = t.pos, nor = t.nor, idx = t.idx;
    const hh = new Float32Array(9);   // 3x3 cell snow heights around the current cell (-1 = no surface)
    const yy = new Float32Array(9);   // 3x3 surface heights
    for (const l of t.levels) {
      if (!this.world.isLive(l, P)) continue;
      let any = l.vis > 0.0005;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nl = (dx || dz) ? this.lv(l.ix + dx, l.iz + dz, l.y, P) : l;
          const k = (dz + 1) * 3 + (dx + 1);
          // Lumps are applied per cell, so heights and normals agree (and the toon steps show them).
          hh[k] = nl ? nl.vis * lump((l.ix + dx + 0.5) * cell, (l.iz + dz + 0.5) * cell, P.lumps * this.lumpScale) : -1;
          yy[k] = nl ? nl.y : l.y;
          if (nl && nl.vis > 0.0005) any = true;
        }
      }
      if (!any) continue;
      // Corners: (0,0) is the -x,-z corner of this cell.
      for (let c = 0; c < 4; c++) {
        const cx = c & 1, cz = c >> 1;
        // the 4 cells touching this corner, in 3x3 indices
        const ka = cz * 3 + cx, kb = ka + 1, kd = ka + 3, ke = ka + 4;
        const A = Math.max(0, hh[ka]), B = Math.max(0, hh[kb]), D = Math.max(0, hh[kd]), E = Math.max(0, hh[ke]);
        // Shared base height: average surface height of the touching cells, so the blanket has no
        // steps between cells even though every cell's measured height is a bit noisy.
        let ys = 0, yn = 0;
        if (hh[ka] >= 0) { ys += yy[ka]; yn++; }
        if (hh[kb] >= 0) { ys += yy[kb]; yn++; }
        if (hh[kd] >= 0) { ys += yy[kd]; yn++; }
        if (hh[ke] >= 0) { ys += yy[ke]; yn++; }
        const baseY = yn ? ys / yn : l.y;
        // Missing cells (surface ends) count as zero height: caps round off at table edges.
        const height = (A + B + D + E) * 0.25;
        const gx = ((B + E) - (A + D)) / (2 * cell);
        const gz = ((D + E) - (A + B)) / (2 * cell);
        const nl = Math.hypot(gx, 1, gz);
        const o = q * 12 + c * 3;
        // Quads overlap their neighbors a little: tiles are rebuilt at different moments, and the
        // overlap hides hairline cracks from tiny height differences in between.
        const grow = 0.08;
        pos[o] = (l.ix + cx + (cx ? grow : -grow)) * cell;
        pos[o + 1] = baseY + height + lift;
        pos[o + 2] = (l.iz + cz + (cz ? grow : -grow)) * cell;
        nor[o] = -gx / nl; nor[o + 1] = 1 / nl; nor[o + 2] = -gz / nl;
      }
      const v0 = q * 4, io = q * 6;
      idx[io] = v0; idx[io + 1] = v0 + 2; idx[io + 2] = v0 + 1;
      idx[io + 3] = v0 + 1; idx[io + 4] = v0 + 2; idx[io + 5] = v0 + 3;
      q++;
    }
    const g = t.geo;
    if (g.attributes.position) {
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
      g.index.needsUpdate = true;
      g.attributes.position.updateRanges.length = 0;
      g.attributes.normal.updateRanges.length = 0;
      g.index.updateRanges.length = 0;
      g.attributes.position.addUpdateRange(0, q * 12);
      g.attributes.normal.addUpdateRange(0, q * 12);
      g.index.addUpdateRange(0, q * 6);
    }
    g.setDrawRange(0, q * 6);
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
