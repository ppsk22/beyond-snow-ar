// Surface confirmation (dev option). The floor is the main objective: the lowest big flat region,
// assumed perfectly flat and endless once confirmed. Other big flat regions (tables) can be confirmed
// too. Candidates show a neon square; tap it to confirm, long press a confirmed surface to remove it.
// Confirmed surfaces skip the strict certification: their cells get snow right away and are never
// forgotten, and the floor snaps every cell to one height.

import * as THREE from 'three';

let nextId = 1;

export class SurfaceConfirm {
  constructor(P, scene, world) {
    this.P = P;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cands = [];
    this.t = 0;
    this.floorCand = null;
    world.confirmed = world.confirmed || [];
  }

  get floor() { return this.world.confirmed.find((c) => c.floor) || null; }

  clear() {
    for (const c of this.cands) this.group.remove(c.mesh);
    for (const c of this.world.confirmed) if (c.mesh) this.group.remove(c.mesh);
    this.cands.length = 0;
    this.world.confirmed.length = 0;
    this.floorCand = null;
  }

  // Flat regions from confident levels (not only certified ones: the point is to offer them early).
  clusters() {
    const P = this.P, w = this.world, cell = w.cell;
    const seen = new Set(), out = [];
    for (const l of w.levels) {
      if (seen.has(l) || l.conf < P.candConf || l.noise > P.certNoise * 1.5) continue;
      const stack = [l]; seen.add(l);
      let minx = l.ix, maxx = l.ix, minz = l.iz, maxz = l.iz, sy = 0, sx = 0, sz = 0, n = 0;
      while (stack.length) {
        const c = stack.pop();
        n++; sy += c.y; sx += c.x; sz += c.z;
        if (c.ix < minx) minx = c.ix; if (c.ix > maxx) maxx = c.ix;
        if (c.iz < minz) minz = c.iz; if (c.iz > maxz) maxz = c.iz;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nl = w.levelAt(c.ix + dx, c.iz + dz, c.y, P.levelMerge);
          if (nl && !seen.has(nl) && nl.conf >= P.candConf && nl.noise <= P.certNoise * 1.5) { seen.add(nl); stack.push(nl); }
        }
      }
      out.push({ y: sy / n, cx: sx / n, cz: sz / n, area: n * cell * cell, minx: minx * cell, maxx: (maxx + 1) * cell, minz: minz * cell, maxz: (maxz + 1) * cell });
    }
    return out;
  }

  covered(c) {
    for (const k of this.world.confirmed) {
      if (Math.abs(k.y - c.y) > 0.05) continue;
      if (k.floor) return true;
      if (c.maxx > k.minx && c.minx < k.maxx && c.maxz > k.minz && c.minz < k.maxz) return true;
    }
    return false;
  }

  update(dt, now, camY) {
    const P = this.P;
    for (const c of this.cands) {
      // Pulse the candidate frames.
      c.mesh.children[0].material.opacity = 0.55 + 0.35 * Math.sin(now * 5);
      c.mesh.visible = P.confirmMode && now - c.since >= P.candStable;
    }
    for (const k of this.world.confirmed) {
      if (!k.mesh) continue;
      const f = Math.max(0, 1 - (now - k.at) / 0.8);
      k.mesh.children[1].material.opacity = 0.45 * f;
      k.mesh.visible = P.showConfirmed || f > 0;
    }
    this.t += dt;
    if (this.t < 0.5) return;
    this.t = 0;
    if (!P.confirmMode) { for (const c of this.cands) c.mesh.visible = false; return; }
    const cl = this.clusters().filter((c) => !this.covered(c));
    // Floor: the lowest height well below the phone that has enough area, all pieces at that height merged.
    let floor = null;
    if (!this.floor) {
      const low = cl.filter((c) => c.y < camY - P.floorBelowMin).sort((a, b) => a.y - b.y);
      for (const c of low) {
        const parts = low.filter((d) => Math.abs(d.y - c.y) < 0.04);
        const area = parts.reduce((a, d) => a + d.area, 0);
        if (area >= P.floorMinArea) {
          let sy = 0, sx = 0, sz = 0;
          for (const d of parts) { sy += d.y * d.area; sx += d.cx * d.area; sz += d.cz * d.area; }
          floor = { y: sy / area, cx: sx / area, cz: sz / area, area, floor: true };
          for (const d of parts) d.used = true;
          break;
        }
      }
    }
    const want = [];
    if (floor) want.push(floor);
    for (const c of cl) if (!c.used && c.area >= P.candMinArea && !(floor && Math.abs(c.y - floor.y) < 0.04)) want.push(c);
    // Match with existing candidates (same kind and height, overlapping) so they stay stable.
    const keep = [];
    for (const w of want) {
      let m = this.cands.find((c) => !keep.includes(c) && !!c.floor === !!w.floor && Math.abs(c.y - w.y) < 0.05 &&
        (w.floor || (w.maxx > c.minx && w.minx < c.maxx && w.maxz > c.minz && w.minz < c.maxz)));
      if (!m) { m = { id: nextId++, since: now }; this.cands.push(m); }
      Object.assign(m, w);
      this.build(m);
      keep.push(m);
    }
    for (const c of this.cands) if (!keep.includes(c)) this.group.remove(c.mesh);
    this.cands = keep;
    this.floorCand = keep.find((c) => c.floor) || null;
    if (floor && P.autoFloor && floor.area >= P.autoFloorArea && now - this.floorCand.since > 4) this.confirm(this.floorCand, now);
  }

  // Neon frame + invisible pick plane. Floor: a square around the centroid; others: their bounds.
  build(c) {
    const P = this.P;
    let x0, x1, z0, z1;
    if (c.floor) {
      const h = P.floorSquare / 2;
      x0 = c.cx - h; x1 = c.cx + h; z0 = c.cz - h; z1 = c.cz + h;
    } else {
      x0 = c.minx + 0.02; x1 = c.maxx - 0.02; z0 = c.minz + 0.02; z1 = c.maxz - 0.02;
    }
    const key = [x0, x1, z0, z1, c.y].map((v) => v.toFixed(2)).join();
    if (c.key === key) return;
    c.key = key;
    if (c.mesh) this.group.remove(c.mesh);
    c.mesh = frameMesh(x0, x1, z0, z1, c.y + 0.008, c.floor ? 0.03 : 0.018, P.colNeon, 0.04);
    this.group.add(c.mesh);
  }

  confirm(c, now) {
    const P = this.P;
    const k = { y: c.y, floor: !!c.floor, minx: c.minx, maxx: c.maxx, minz: c.minz, maxz: c.maxz, at: now, id: c.id };
    // Confirmed look: a short neon flash, then (dev) thin corner marks.
    k.mesh = frameMesh(c.floor ? c.cx - P.floorSquare / 2 : c.minx, c.floor ? c.cx + P.floorSquare / 2 : c.maxx,
      c.floor ? c.cz - P.floorSquare / 2 : c.minz, c.floor ? c.cz + P.floorSquare / 2 : c.maxz, c.y + 0.006, 0.01, '#ffffff', 0.45);
    k.mesh.children[0].material.opacity = 0.6;
    this.group.add(k.mesh);
    this.world.confirmed.push(k);
    this.group.remove(c.mesh);
    this.cands = this.cands.filter((x) => x !== c);
    console.info('[surface] confirmed', k.floor ? 'floor' : 'surface', k.y.toFixed(3));
    return k;
  }

  remove(k) {
    const list = this.world.confirmed;
    const i = list.indexOf(k);
    if (i < 0) return;
    list.splice(i, 1);
    if (k.mesh) this.group.remove(k.mesh);
    // Its cells go back to the normal (strict) rules.
    for (const l of this.world.levels) if (l.lockedBy === k.id) { l.lockedBy = 0; }
    console.info('[surface] removed', k.floor ? 'floor' : 'surface');
  }

  pickCandidate(ray) {
    const meshes = this.cands.filter((c) => c.mesh && c.mesh.visible).map((c) => c.mesh.children[1]);
    const h = ray.intersectObjects(meshes, false)[0];
    if (!h) return null;
    return this.cands.find((c) => c.mesh.children[1] === h.object) || null;
  }

  pickConfirmed(ray) {
    let best = null, bd = Infinity;
    for (const k of this.world.confirmed) {
      const o = ray.ray.origin, d = ray.ray.direction;
      if (Math.abs(d.y) < 1e-3) continue;
      const t = (k.y - o.y) / d.y;
      if (t <= 0 || t > 8) continue;
      const x = o.x + d.x * t, z = o.z + d.z * t;
      if (!k.floor && (x < k.minx || x > k.maxx || z < k.minz || z > k.maxz)) continue;
      if (t < bd) { bd = t; best = k; }
    }
    return best;
  }
}

// Rectangle outline on a horizontal plane (4 strips) plus a faint fill used for picking.
function frameMesh(x0, x1, z0, z1, y, wd, color, fillOpacity) {
  const g = new THREE.Group();
  const lineMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const shape = new THREE.Shape();
  shape.moveTo(x0, z0); shape.lineTo(x1, z0); shape.lineTo(x1, z1); shape.lineTo(x0, z1); shape.lineTo(x0, z0);
  const hole = new THREE.Path();
  hole.moveTo(x0 + wd, z0 + wd); hole.lineTo(x0 + wd, z1 - wd); hole.lineTo(x1 - wd, z1 - wd); hole.lineTo(x1 - wd, z0 + wd); hole.lineTo(x0 + wd, z0 + wd);
  shape.holes.push(hole);
  const ring = new THREE.ShapeGeometry(shape);
  // Shape is in x/z: rotate the xy shape into the horizontal plane.
  ring.rotateX(Math.PI / 2);
  const line = new THREE.Mesh(ring, lineMat);
  line.position.y = y;
  line.renderOrder = 6;
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: fillOpacity, depthWrite: false, side: THREE.DoubleSide }));
  fill.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  fill.renderOrder = 6;
  g.add(line, fill);
  return g;
}
