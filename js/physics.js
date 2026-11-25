// Rigid bodies for the show objects (cannon-es). Static colliders come from certified snow surfaces:
// each connected flat region becomes a thin box, plus a floor plane as a safety net.

import * as THREE from 'three';
import * as CANNON from './vendor/cannon-es.js';

export class Physics {
  constructor(P) {
    this.P = P;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -P.objGravity, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.solver.iterations = 8;
    this.mat = new CANNON.Material('obj');
    this.world.defaultContactMaterial.friction = P.objFriction;
    this.world.defaultContactMaterial.restitution = P.objBounce;
    this.floor = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
    this.floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(this.floor);
    this.statics = [];
    this.items = [];          // { body, obj, born, dying, kind }
    this.floorY = null;
  }

  setFloor(y) {
    this.floorY = y;
    this.floor.position.set(0, y - 0.01, 0);
  }

  // Rebuild static boxes from certified levels: flood fill connected cells at the same height.
  rebuildStatics(world, P) {
    for (const b of this.statics) this.world.removeBody(b);
    this.statics.length = 0;
    const seen = new Set();
    const cell = world.cell;
    let lowest = null;
    for (const l of world.levels) {
      if (!l.cert || seen.has(l)) continue;
      const stack = [l];
      seen.add(l);
      let minx = l.ix, maxx = l.ix, minz = l.iz, maxz = l.iz, sy = 0, n = 0;
      while (stack.length) {
        const c = stack.pop();
        n++; sy += c.y;
        if (c.ix < minx) minx = c.ix; if (c.ix > maxx) maxx = c.ix;
        if (c.iz < minz) minz = c.iz; if (c.iz > maxz) maxz = c.iz;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nl = world.levelAt(c.ix + dx, c.iz + dz, c.y, P.levelMerge);
          if (nl && nl.cert && !seen.has(nl)) { seen.add(nl); stack.push(nl); }
        }
      }
      if (n < 12) continue;
      const y = sy / n;
      if (n > 200 && (lowest === null || y < lowest)) lowest = y;
      const hx = (maxx - minx + 1) * cell / 2, hz = (maxz - minz + 1) * cell / 2;
      const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(hx, 0.05, hz)) });
      body.position.set((minx + maxx + 1) * cell / 2, y - 0.05, (minz + maxz + 1) * cell / 2);
      this.world.addBody(body);
      this.statics.push(body);
    }
    if (lowest !== null) this.setFloor(lowest);
    return this.statics.length;
  }

  add(obj, pos, quat, vel, spin, mass = 0.2) {
    const body = new CANNON.Body({ mass, material: this.mat, linearDamping: 0.05, angularDamping: 0.08 });
    for (const c of obj.colliders) {
      // Thin cut-outs get a slightly thicker collider so they do not tunnel through surfaces.
      body.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, c.hy, Math.max(0.008, c.hz))), new CANNON.Vec3(c.x, c.y, c.z));
    }
    body.position.set(pos.x, pos.y, pos.z);
    body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    body.velocity.set(vel.x, vel.y, vel.z);
    body.angularVelocity.set(spin.x, spin.y, spin.z);
    body.sleepSpeedLimit = 0.08;
    body.sleepTimeLimit = 0.6;
    this.world.addBody(body);
    const item = { body, obj, born: performance.now() / 1000, dying: -1, kind: obj.kind };
    body.item = item;
    this.items.push(item);
    return item;
  }

  remove(item) {
    this.world.removeBody(item.body);
    item.obj.mesh.parent?.remove(item.obj.mesh);
    const k = this.items.indexOf(item);
    if (k >= 0) this.items.splice(k, 1);
  }

  // People (dynamic voxels) shove objects; strong shoves are reported (pills break on them).
  push(occ, P, onHit) {
    if (!occ || !occ.push.size) return;
    const R = P.objPushRadius;
    for (const it of this.items) {
      if (it.dying >= 0) continue;
      const p = it.body.position;
      const src = occ.sourcesAt(p.x, p.y, p.z);
      if (!src) continue;
      let fx = 0, fy = 0, fz = 0, n = 0;
      for (let k = 0; k < src.length; k += 3) {
        const dx = p.x - src[k], dy = p.y - src[k + 1], dz = p.z - src[k + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d < R && d > 1e-4) { fx += dx / d; fy += Math.max(0, dy / d); fz += dz / d; n++; }
      }
      if (!n) continue;
      it.pushN = (it.pushN || 0) + n;
      const len = Math.hypot(fx, fz) || 1;
      const m = it.body.mass * P.objPush;
      it.body.wakeUp();
      it.body.applyImpulse(new CANNON.Vec3(fx / len * m, (0.4 + fy / n) * m, fz / len * m));
      it.body.angularVelocity.x += (Math.random() - 0.5) * 6;
      it.body.angularVelocity.z += (Math.random() - 0.5) * 6;
      // Only a real walk-through counts as a hit: enough moving points, and not right after spawning.
      if (onHit && it.pushN >= P.shatterMinPts && performance.now() / 1000 - it.born > 1.0) onHit(it);
    }
  }

  step(dt, P) {
    this.world.gravity.set(0, -P.objGravity, 0);
    this.world.defaultContactMaterial.friction = P.objFriction;
    this.world.defaultContactMaterial.restitution = P.objBounce;
    this.world.step(1 / 60, dt, 3);
    const now = performance.now() / 1000;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      const m = it.obj.mesh;
      m.position.copy(it.body.position);
      m.quaternion.copy(it.body.quaternion);
      if (it.dying >= 0) {
        const f = 1 - (now - it.dying) / 0.5;
        if (f <= 0) { this.remove(it); continue; }
        m.scale.setScalar(it.baseScale * f);
      }
      // Lost below the floor (no surface there yet): remove quietly.
      if (this.floorY !== null && it.body.position.y < this.floorY - 2) this.remove(it);
    }
  }

  kill(it) {
    if (it.dying >= 0) return;
    it.dying = performance.now() / 1000;
    it.baseScale = it.obj.mesh.scale.x;
    this.world.removeBody(it.body);
  }

  // Ray against object meshes. Returns the item hit or null.
  raycast(raycaster) {
    const meshes = this.items.filter((i) => i.dying < 0).map((i) => i.obj.mesh);
    const hits = raycaster.intersectObjects(meshes, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !meshes.includes(o)) o = o.parent;
    return { item: this.items.find((i) => i.obj.mesh === o), point: hits[0].point };
  }
}

export { CANNON };
