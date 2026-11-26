// Falling shapes, like the header snow: logo E, O / 0 and small buzzword pills drift down all around
// the viewer, swaying and fluttering. When they land on a surface they tumble flat, rest a moment and
// fade out, then start again from the top. No physics engine and no hull outlines (nothing black can
// fill the screen when one passes the lens).

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = [0];

export class Fallers {
  constructor(P, scene, kit) {
    this.P = P;
    this.scene = scene;
    this.kit = kit;
    this.items = [];
    this.wordIdx = Math.floor(Math.random() * 100);
    this.words = [];
  }

  clear() {
    for (const f of this.items) this.scene.remove(f.mesh);
    this.items.length = 0;
  }

  pickKind() {
    const P = this.P;
    const tot = P.mixE + P.mixO + P.mixPill;
    if (tot <= 0) return 'E';
    let r = Math.random() * tot;
    if ((r -= P.mixE) < 0) return 'E';
    if ((r -= P.mixO) < 0) return Math.random() < 0.6 ? 'O' : '0';
    return 'pill';
  }

  make(kind, word) {
    const P = this.P, kit = this.kit, s = P.shapeScale;
    const prev = kit.useOutline;
    kit.useOutline = false;
    let obj;
    if (kind === 'E') obj = kit.makeE(0.11 * s);
    else if (kind === 'O') obj = kit.makeRing(0.13 * s, true);
    else if (kind === '0') obj = kit.makeRing(0.11 * s, false);
    else obj = kit.makePill(word || (this.words.length ? this.words[this.wordIdx++ % this.words.length] : 'BUZZ'), P.pillHeight * s);
    kit.useOutline = prev;
    // Own material copies so each shape can fade on its own.
    const mats = [];
    obj.mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of [].concat(o.material)) { mats.push(m); }
      o.renderOrder = 3;
    });
    obj.mats = mats;
    return obj;
  }

  spawn(f, cam, anywhere) {
    const P = this.P;
    const yaw = this.yaw || 0;
    const R = P.spawnRadius * 0.85;
    let x, z;
    // Not right in front of the lens.
    for (let k = 0; k < 8; k++) {
      // Mostly in front of the viewer (where they can be seen), some all around.
      const a = Math.random() < P.shapeFront ? yaw + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const rr = 0.7 + Math.sqrt(Math.random()) * (R - 0.7);
      x = cam.x + Math.cos(a) * rr; z = cam.z + Math.sin(a) * rr;
      if (Math.hypot(x - cam.x, z - cam.z) > 0.7) break;
    }
    const y = anywhere ? cam.y - P.spawnBelow * 0.5 + Math.random() * (P.spawnAbove + P.spawnBelow * 0.5) : cam.y + P.spawnAbove - Math.random() * 0.3;
    f.mesh.position.set(x, y, z);
    f.mesh.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
    f.spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    f.spinSpeed = P.shapeSpin * (0.5 + Math.random());
    f.speed = P.shapeFall * (0.8 + Math.random() * 0.4);
    f.ph = Math.random() * 100;
    f.state = 'fall';
    f.t = 0;
    f.alpha = 0;           // fades in after spawning
    this.setAlpha(f, 0);
    f.mesh.visible = true;
  }

  setAlpha(f, a) {
    f.alpha = a;
    for (const m of f.obj.mats) {
      m.uniforms.uAlpha.value = a;
      const tr = a < 0.999;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
    }
  }

  // Extra shape dropped at a point (a buzzword tapped on the page): falls, lands, fades, then goes away.
  drop(word, pos, cam) {
    const obj = this.make('pill', word);
    this.scene.add(obj.mesh);
    const f = { obj, mesh: obj.mesh, size: Math.max(obj.size.x, obj.size.y), once: true };
    this.spawn(f, cam, false);
    f.mesh.position.copy(pos);
    this.setAlpha(f, 1);
    this.items.push(f);
  }

  // Where does a shape at (x, y, z) land? Returns the surface height or null.
  ground(x, yPrev, y, z, ctx) {
    const { P, worlds, df, floorY } = ctx;
    for (const w of worlds) {
      const l = w.landing(x, z, yPrev, y, P);
      if (l) {
        if (w.frame) return w.frame.py + l.y + l.vis;
        return l.py + l.vis;
      }
    }
    if (df && df.ok) {
      const idx = df.project(x, y, z, tmp);
      if (idx >= 0 && df.d[idx] > 0 && tmp[0] > df.d[idx] + 0.02 && tmp[0] < df.d[idx] + 0.25 && df.valid[idx] && df.ny[idx] > P.upNormal) return df.wy[idx];
    }
    if (floorY !== null && y <= floorY) return floorY;
    return null;
  }

  update(dt, ctx) {
    const P = this.P, cam = ctx.cam;
    if (ctx.fwd) this.yaw = Math.atan2(ctx.fwd.z, ctx.fwd.x);
    const want = P.fallersOn ? Math.round(P.shapeCount * (ctx.quality ?? 1)) : 0;
    if (this.items.some((f) => f.dead)) this.items = this.items.filter((f) => !f.dead);
    const regular = this.items.filter((f) => !f.once).length;
    for (let k = regular; k < want; k++) {
      const obj = this.make(this.pickKind());
      this.scene.add(obj.mesh);
      const f = { obj, mesh: obj.mesh, size: Math.max(obj.size.x, obj.size.y) };
      this.spawn(f, cam, true);
      this.items.push(f);
    }
    for (let k = regular; k > want; k--) {
      const idx = this.items.findIndex((f) => !f.once);
      if (idx < 0) break;
      this.scene.remove(this.items[idx].mesh);
      this.items.splice(idx, 1);
    }
    const q = new THREE.Quaternion();
    for (const f of this.items) {
      const m = f.mesh;
      f.t += dt;
      if (f.state === 'fall') {
        const yPrev = m.position.y;
        const t = ctx.now * 0.9 + f.ph;
        m.position.x += Math.sin(t) * P.sway * 1.4 * dt;
        m.position.z += Math.cos(t * 0.8) * P.sway * dt;
        m.position.y -= f.speed * dt;
        // Flutter like paper: slow spin around a wandering axis.
        q.setFromAxisAngle(f.spin, f.spinSpeed * dt);
        m.quaternion.premultiply(q);
        if (f.alpha < 1) this.setAlpha(f, Math.min(1, f.alpha + dt / 0.6));
        // Too close to the lens: fade out early.
        if (m.position.distanceTo(cam) < 0.45) { f.state = 'fade'; f.t = 0; continue; }
        const g = this.ground(m.position.x, yPrev - f.size * 0.25, m.position.y - f.size * 0.25, m.position.z, ctx);
        if (g !== null) {
          // Tumble: settle flat (face up or down), random turn, small hop and slide.
          f.state = 'land';
          f.t = 0;
          f.from = m.quaternion.clone();
          const faceUp = Math.random() < 0.5;
          const flat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, faceUp ? 1 : -1), UP);
          f.to = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2).multiply(flat);
          f.groundY = g + 0.004;
          f.slide = new THREE.Vector3(Math.sin(t), 0, Math.cos(t * 0.8)).multiplyScalar(0.12 + Math.random() * 0.1);
          f.startPos = m.position.clone();
          f.startPos.y = Math.max(f.startPos.y, f.groundY);
        } else if (m.position.y < cam.y - P.spawnBelow - 0.5) {
          this.spawn(f, cam, false);
        }
      } else if (f.state === 'land') {
        const k = Math.min(1, f.t / P.shapeTumble);
        const e = 1 - Math.pow(1 - k, 3);
        m.quaternion.slerpQuaternions(f.from, f.to, e);
        m.position.x = f.startPos.x + f.slide.x * e;
        m.position.z = f.startPos.z + f.slide.z * e;
        // one small hop on impact
        m.position.y = f.groundY + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.03 * (1 - k);
        if (k >= 1) { f.state = 'rest'; f.t = 0; }
      } else if (f.state === 'rest') {
        if (f.t > P.shapeRest) { f.state = 'fade'; f.t = 0; }
      } else if (f.state === 'fade') {
        const a = Math.max(0, f.alpha - dt / Math.max(0.05, P.shapeFade));
        this.setAlpha(f, a);
        if (a <= 0) {
          if (f.once) { this.scene.remove(f.mesh); f.dead = true; } else this.spawn(f, cam, false);
        }
      }
    }
  }
}
