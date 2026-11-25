// The screen show: once the desktop screen is locked, snow and CI shapes come out of it.
//  - Burst: objects fly out through the screen toward the viewer.
//  - Steady: objects tip over the top edge and drop in front of the screen.
// Objects are rigid bodies; they land on real surfaces and tip over. People shove them; buzzword
// pills break into their letters when someone walks through them or taps them.

import * as THREE from 'three';

export class ScreenShow {
  constructor(P, scene, kit, physics) {
    this.P = P;
    this.scene = scene;
    this.kit = kit;
    this.physics = physics;
    this.pose = null;
    this.active = false;
    this.queue = [];        // pending burst spawns: times
    this.nextDrop = 0;
    this.spawned = 0;
    this.wordIdx = Math.floor(Math.random() * 15);
    this.tmp = new THREE.Vector3();
  }

  start(pose, now) {
    this.pose = pose;
    this.active = true;
    this.queue.length = 0;
    const P = this.P;
    for (let k = 0; k < P.burstCount; k++) this.queue.push(now + 0.3 + (k / Math.max(1, P.burstCount)) * P.burstTime);
    this.nextDrop = now + 0.3 + P.burstTime + P.dropEvery;
  }

  stop() {
    this.active = false;
    for (const it of [...this.physics.items]) this.physics.remove(it);
  }

  pickKind() {
    const P = this.P;
    const tot = P.mixE + P.mixO + P.mixPill;
    if (tot <= 0) return null;
    let r = Math.random() * tot;
    if ((r -= P.mixE) < 0) return 'E';
    if ((r -= P.mixO) < 0) return Math.random() < 0.6 ? 'O' : '0';
    return 'pill';
  }

  make(kind, word) {
    const P = this.P, kit = this.kit, s = P.objScale;
    if (kind === 'E') return kit.makeE(0.11 * s);
    if (kind === 'O') return kit.makeRing(0.13 * s, true);
    if (kind === '0') return kit.makeRing(0.11 * s, false);
    const words = this.words || [];
    const w = word || (words.length ? words[this.wordIdx++ % words.length] : 'BUZZ');
    return kit.makePill(w, P.pillHeight * s);
  }

  spawn(kind, mode, at, word) {
    const P = this.P, p = this.pose;
    if (!kind || !p) return null;
    const obj = this.make(kind, word);
    if (!obj) return null;
    this.scene.add(obj.mesh);
    const pos = new THREE.Vector3(), vel = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    // Start aligned with the screen (facing the viewer), slightly tilted.
    const m = new THREE.Matrix4().makeBasis(p.right, p.up, p.normal);
    quat.setFromRotationMatrix(m);
    quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6)));
    if (at) {
      pos.copy(at.pos); vel.copy(at.vel);
    } else if (mode === 'out') {
      const u = (Math.random() * 2 - 1) * 0.38, v = (Math.random() * 2 - 1) * 0.32;
      pos.copy(p.center).addScaledVector(p.right, u * p.w).addScaledVector(p.up, v * p.h).addScaledVector(p.normal, 0.03 + obj.size.z);
      vel.copy(p.normal).multiplyScalar(P.outSpeed * (0.7 + Math.random() * 0.6))
        .addScaledVector(p.up, P.outLift * (0.4 + Math.random() * 0.8))
        .addScaledVector(p.right, (Math.random() * 2 - 1) * 0.5);
    } else {
      const u = (Math.random() * 2 - 1) * 0.35;
      pos.copy(p.center).addScaledVector(p.right, u * p.w).addScaledVector(p.up, p.h / 2 + obj.size.y / 2 + 0.03).addScaledVector(p.normal, obj.size.z + 0.02);
      vel.copy(p.normal).multiplyScalar(0.25 + Math.random() * 0.3);
    }
    const spin = new THREE.Vector3((Math.random() - 0.5) * P.spin, (Math.random() - 0.5) * P.spin, (Math.random() - 0.5) * P.spin);
    const mass = kind === 'pill' ? 0.25 : kind === 'letter' ? 0.05 : 0.18;
    const it = this.physics.add(obj, pos, quat, vel, spin, mass);
    // Grow in over a short moment, as if coming through the glass.
    it.growT = performance.now() / 1000;
    it.targetScale = obj.mesh.scale.x;
    obj.mesh.scale.setScalar(it.targetScale * 0.05);
    this.spawned++;
    this.trim();
    return it;
  }

  trim() {
    const live = this.physics.items.filter((i) => i.dying < 0);
    let extra = live.length - this.P.maxObjects;
    for (let k = 0; k < live.length && extra > 0; k++, extra--) this.physics.kill(live[k]);
  }

  // Break a pill into its letters, laid out along the pill, inheriting its motion.
  shatter(it) {
    if (it.kind !== 'pill' || it.dying >= 0) return;
    const P = this.P, kit = this.kit;
    const word = it.obj.word || '';
    const h = P.pillHeight * P.objScale * 0.62 * P.letterScale;
    let total = 0;
    for (const ch of word) total += kit.advance(ch) * h;
    const mesh = it.obj.mesh;
    mesh.updateMatrixWorld(true);
    const body = it.body;
    let x = -total / 2;
    for (const ch of word) {
      const adv = kit.advance(ch) * h;
      if (ch !== ' ') {
        const obj = kit.makeLetter(ch, h, P.letterColor);
        if (obj) {
          this.scene.add(obj.mesh);
          const pos = new THREE.Vector3(x + adv / 2, 0, 0).applyMatrix4(mesh.matrixWorld);
          const vel = new THREE.Vector3(body.velocity.x, body.velocity.y, body.velocity.z)
            .add(new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2).multiplyScalar(P.shatterForce));
          const spin = new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
          const li = this.physics.add(obj, pos, mesh.quaternion, vel, spin, 0.05);
          li.targetScale = obj.mesh.scale.x;
        }
      }
      x += adv;
    }
    this.physics.kill(it);
    this.trim();
  }

  // Tap on an object: pills break, everything else gets flicked away.
  tap(hit, rayDir) {
    if (!hit || !hit.item) return false;
    const it = hit.item;
    if (it.kind === 'pill' && this.P.shatterOnTap) { this.shatter(it); return true; }
    const b = it.body;
    b.wakeUp();
    b.velocity.x += rayDir.x * 2.5; b.velocity.y += 2.2; b.velocity.z += rayDir.z * 2.5;
    b.angularVelocity.x += (Math.random() - 0.5) * 12; b.angularVelocity.z += (Math.random() - 0.5) * 12;
    return true;
  }

  update(dt, now) {
    if (!this.active) return;
    const P = this.P;
    while (this.queue.length && this.queue[0] <= now) { this.queue.shift(); this.spawn(this.pickKind(), 'out'); }
    if (P.dropEvery > 0 && now >= this.nextDrop) {
      this.nextDrop = now + P.dropEvery * (0.7 + Math.random() * 0.6);
      this.spawn(this.pickKind(), Math.random() < P.dropOutShare ? 'out' : 'top');
    }
    // Grow-in animation
    const t = performance.now() / 1000;
    for (const it of this.physics.items) {
      if (it.growT === undefined || it.dying >= 0) continue;
      const f = Math.min(1, (t - it.growT) / 0.3);
      it.obj.mesh.scale.setScalar(it.targetScale * (0.05 + 0.95 * f * f * (3 - 2 * f)));
      if (f >= 1) it.growT = undefined;
    }
  }

  // Where screen snow comes from: a point on the screen and a velocity (out through it or over the top).
  snowSource(out, vel) {
    const p = this.pose;
    if (Math.random() < this.P.screenSnowTop) {
      const u = (Math.random() * 2 - 1) * 0.5;
      out.copy(p.center).addScaledVector(p.right, u * p.w).addScaledVector(p.up, p.h / 2 + 0.01).addScaledVector(p.normal, 0.02);
      vel.copy(p.normal).multiplyScalar(0.1 + Math.random() * 0.15);
    } else {
      const u = (Math.random() * 2 - 1) * 0.5, v = (Math.random() * 2 - 1) * 0.5;
      out.copy(p.center).addScaledVector(p.right, u * p.w).addScaledVector(p.up, v * p.h).addScaledVector(p.normal, 0.02);
      vel.copy(p.normal).multiplyScalar(this.P.screenSnowSpeed * (0.5 + Math.random()))
        .addScaledVector(p.up, Math.random() * 0.3).addScaledVector(p.right, (Math.random() - 0.5) * 0.4);
    }
  }
}
