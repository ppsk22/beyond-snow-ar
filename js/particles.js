// Falling flakes (always snowing) and knocked-off chunks.

import * as THREE from 'three';
import { flakeMaterial } from './look.js';

function pointsObject(n, mat) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  return { pts, pos, size, geo };
}

const tmp = [0];

// Test a particle against the real depth in view. Returns sample index of the surface it hit, or -1.
function depthHit(df, x, y, z) {
  if (!df || !df.ok) return -1;
  const idx = df.project(x, y, z, tmp);
  if (idx < 0) return -1;
  const dm = df.d[idx];
  if (!(dm > 0)) return -1;
  const dp = tmp[0];
  return dp > dm + 0.015 && dp < dm + 0.3 ? idx : -1;
}

export class Flakes {
  constructor(P, scene, max = 4000) {
    this.max = max;
    this.mat = flakeMaterial(P);
    const o = pointsObject(max, this.mat);
    Object.assign(this, o);
    scene.add(this.pts);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.spd = new Float32Array(max); this.ph = new Float32Array(max);
    this.r = new Float32Array(max);
    this.count = 0;
    this.seeded = false;
    this.landed = 0;
  }

  respawn(i, P, cam, top) {
    const R = P.spawnRadius;
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R;
    this.pos[i * 3] = cam.x + Math.cos(a) * rr;
    this.pos[i * 3 + 2] = cam.z + Math.sin(a) * rr;
    this.pos[i * 3 + 1] = top
      ? cam.y + P.spawnAbove - Math.random() * 0.2
      : cam.y - P.spawnBelow + Math.random() * (P.spawnAbove + P.spawnBelow);
    this.spd[i] = P.fallSpeed * (1 + (Math.random() * 2 - 1) * P.fallVar);
    this.ph[i] = Math.random() * 100;
    this.r[i] = P.flakeSize * (1 + (Math.random() * 2 - 1) * P.flakeSizeVar * 0.5);
    this.size[i] = this.r[i];
    this.vx[i] = this.vy[i] = this.vz[i] = 0;
  }

  // Continue 2D start-screen flakes in 3D: same screen position, depth picked so the size matches.
  handoff(list, df, P, viewW, viewH) {
    const proj = df.proj.elements;
    const p11 = proj[5];
    const m = df.camWorld.elements;
    const inv = df.projInv;
    const v = new THREE.Vector3();
    let n = 0;
    for (const f of list) {
      if (n >= this.max) break;
      const x = f.x / viewW, y = f.y / viewH;
      if (x < 0 || x > 1 || y < 0 || y > 1) continue;
      let d = (P.flakeSize * p11 * viewH * 0.5) / Math.max(0.5, f.r);
      d = Math.min(P.handoffFar, Math.max(P.handoffNear, d * (0.8 + Math.random() * 0.4)));
      v.set(x * 2 - 1, 1 - y * 2, 0.5).applyMatrix4(inv);
      const rx = v.x / -v.z * d, ry = v.y / -v.z * d, rz = -d;
      const i = n++;
      this.respawn(i, P, df.camPos, false);
      this.pos[i * 3] = m[0] * rx + m[4] * ry + m[8] * rz + m[12];
      this.pos[i * 3 + 1] = m[1] * rx + m[5] * ry + m[9] * rz + m[13];
      this.pos[i * 3 + 2] = m[2] * rx + m[6] * ry + m[10] * rz + m[14];
    }
    return n;
  }

  update(dt, ctx) {
    const { P, worlds, occ, df, cam, now, quality } = ctx;
    const want = Math.min(this.max, Math.round(P.flakes * quality));
    if (!this.seeded) {
      for (let i = this.count; i < this.max; i++) this.respawn(i, P, cam, false);
      this.seeded = true;
    }
    if (want > this.count) for (let i = this.count; i < want; i++) this.respawn(i, P, cam, false);
    this.count = want;
    const pos = this.pos, R = P.spawnRadius, R2 = R * 2;
    const yTop = cam.y + P.spawnAbove, yBot = cam.y - P.spawnBelow;
    const decay = Math.exp(-2.2 * dt);
    const pushR = P.pushRadius, pushR2 = pushR * pushR;
    const usePush = P.pushOn && occ && occ.push.size > 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      let x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const t = now * P.swayFreq + this.ph[i];
      if (usePush) {
        const src = occ.sourcesAt(x, y, z);
        if (src) {
          for (let k = 0; k < src.length; k += 3) {
            const dx = x - src[k], dy = y - src[k + 1], dz = z - src[k + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < pushR2 && d2 > 1e-8) {
              const d = Math.sqrt(d2), f = P.pushStrength * 8 * dt * (1 - d / pushR) / d;
              this.vx[i] += dx * f; this.vy[i] += Math.abs(dy) * f * 0.5; this.vz[i] += dz * f;
            }
          }
        }
      }
      this.vx[i] *= decay; this.vy[i] *= decay; this.vz[i] *= decay;
      const yPrev = y;
      x += (Math.sin(t) * P.sway + this.vx[i]) * dt;
      z += (Math.cos(t * 0.83) * P.sway * 0.6 + this.vz[i]) * dt;
      y += (-this.spd[i] + this.vy[i]) * dt;

      let gone = false;
      for (let w = 0; w < worlds.length && !gone; w++) {
        const l = worlds[w].landing(x, z, yPrev, y, P);
        if (l) { worlds[w].deposit(l, P.flakeDeposit, P); gone = true; this.landed++; }
      }
      if (!gone) {
        const hit = depthHit(df, x, y, z);
        if (hit >= 0) {
          // Hit something real. If it is a known surface, snow lands there; walls and people just melt it.
          if (df.valid[hit]) {
            const l = worlds[worlds.length - 1].near(df.wx[hit], df.wy[hit], df.wz[hit], P);
            if (l) { worlds[worlds.length - 1].deposit(l, P.flakeDeposit, P); this.landed++; }
          }
          gone = true;
        }
      }
      if (gone || y < yBot) {
        this.respawn(i, P, cam, true);
        continue;
      }
      if (y > yTop + 0.5) y = yBot + 0.1;
      // Wrap horizontally around the viewer so density stays even while walking.
      if (x - cam.x > R) x -= R2; else if (cam.x - x > R) x += R2;
      if (z - cam.z > R) z -= R2; else if (cam.z - z > R) z += R2;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }
}

export class Chunks {
  constructor(P, scene, max = 3000) {
    this.max = max;
    this.mat = flakeMaterial(P);
    const o = pointsObject(max, this.mat);
    Object.assign(this, o);
    scene.add(this.pts);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.age = new Float32Array(max); this.r = new Float32Array(max);
    this.count = 0;
    this.spawned = 0;
    this._wp = [0, 0, 0];
    this._wd = [0, 0];
  }

  emit(l, amount, dirX, dirZ, P, cell, cap, world) {
    const wp = world ? world.worldPos(l, this._wp) : [l.x, l.y, l.z];
    if (world) { const d = world.worldDir(dirX, dirZ, this._wd); dirX = d[0]; dirZ = d[1]; }
    const r = P.chunkSize;
    const vol = (4 / 3) * Math.PI * r * r * r;
    let n = Math.ceil((amount * cell * cell) / vol);
    n = Math.min(n, 12, cap);
    const hasDir = dirX || dirZ;
    for (let k = 0; k < n; k++) {
      if (this.count >= this.max) return;
      const i = this.count++;
      this.pos[i * 3] = wp[0] + (Math.random() - 0.5) * cell;
      this.pos[i * 3 + 1] = wp[1] + amount * (0.3 + Math.random() * 0.7);
      this.pos[i * 3 + 2] = wp[2] + (Math.random() - 0.5) * cell;
      let dx = dirX, dz = dirZ;
      if (!hasDir) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
      const side = P.knockSide * (0.5 + Math.random() * 0.7);
      this.vx[i] = dx * side + (Math.random() * 2 - 1) * P.knockRandom;
      this.vz[i] = dz * side + (Math.random() * 2 - 1) * P.knockRandom;
      this.vy[i] = P.knockUp * (0.5 + Math.random() * 0.7);
      this.age[i] = 0;
      this.r[i] = r * (0.6 + Math.random() * 0.8);
      this.size[i] = this.r[i];
      this.spawned++;
    }
  }

  // Snow of a vanished surface just drops.
  drop(l, P, cell) {
    const r = P.chunkSize;
    const vol = (4 / 3) * Math.PI * r * r * r;
    const n = Math.min(6, Math.ceil((l.vis * cell * cell) / vol));
    for (let k = 0; k < n && this.count < this.max; k++) {
      const i = this.count++;
      this.pos[i * 3] = l.x + (Math.random() - 0.5) * cell;
      this.pos[i * 3 + 1] = l.y + l.vis * Math.random();
      this.pos[i * 3 + 2] = l.z + (Math.random() - 0.5) * cell;
      this.vx[i] = this.vz[i] = 0; this.vy[i] = 0;
      this.age[i] = 0; this.r[i] = r; this.size[i] = r;
    }
  }

  kill(i) {
    const j = --this.count;
    if (i === j) return;
    this.pos[i * 3] = this.pos[j * 3]; this.pos[i * 3 + 1] = this.pos[j * 3 + 1]; this.pos[i * 3 + 2] = this.pos[j * 3 + 2];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.age[i] = this.age[j]; this.r[i] = this.r[j]; this.size[i] = this.size[j];
  }

  update(dt, ctx) {
    const { P, worlds, occ, df, cam } = ctx;
    const pos = this.pos;
    const drag = Math.exp(-P.drag * dt);
    const usePush = P.pushOn && occ && occ.push.size > 0;
    const pushR = P.pushRadius, pushR2 = pushR * pushR;
    const yBot = cam.y - P.spawnBelow - 1;
    const chunkVol = (4 / 3) * Math.PI * Math.pow(P.chunkSize, 3);
    for (let i = this.count - 1; i >= 0; i--) {
      const o = i * 3;
      this.age[i] += dt;
      if (this.age[i] > P.chunkLife) { this.kill(i); continue; }
      let x = pos[o], y = pos[o + 1], z = pos[o + 2];
      if (usePush) {
        const src = occ.sourcesAt(x, y, z);
        if (src) {
          for (let k = 0; k < src.length; k += 3) {
            const dx = x - src[k], dy = y - src[k + 1], dz = z - src[k + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < pushR2 && d2 > 1e-8) {
              const d = Math.sqrt(d2), f = P.pushStrength * 10 * dt * (1 - d / pushR) / d;
              this.vx[i] += dx * f; this.vy[i] += Math.max(0, dy) * f; this.vz[i] += dz * f;
            }
          }
        }
      }
      this.vy[i] -= P.gravity * dt;
      this.vx[i] *= drag; this.vz[i] *= drag; this.vy[i] *= Math.exp(-P.drag * 0.3 * dt);
      const yPrev = y;
      x += this.vx[i] * dt; y += this.vy[i] * dt; z += this.vz[i] * dt;
      let gone = false;
      for (let w = 0; w < worlds.length && !gone; w++) {
        const l = worlds[w].landing(x, z, yPrev, y, P);
        if (!l) continue;
        const sp = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
        if (sp < P.chunkStickSpeed) {
          const cell = worlds[w].cell;
          worlds[w].deposit(l, chunkVol / (cell * cell) * 0.4, P);
          gone = true;
        } else {
          y = l.y + l.vis + 0.001;
          this.vy[i] = Math.abs(this.vy[i]) * 0.25;
          this.vx[i] *= 0.55; this.vz[i] *= 0.55;
        }
      }
      if (!gone) {
        const hit = depthHit(df, x, y, z);
        if (hit >= 0) {
          // Real obstacle (wall, leg): lose sideways speed, keep falling. Settle if it is a known surface.
          const real = worlds[worlds.length - 1];
          const l = df.valid[hit] ? real.near(df.wx[hit], df.wy[hit], df.wz[hit], P) : null;
          if (l && Math.hypot(this.vx[i], this.vy[i], this.vz[i]) < P.chunkStickSpeed * 1.5) {
            real.deposit(l, chunkVol / (real.cell * real.cell) * 0.4, P);
            gone = true;
          } else {
            x -= this.vx[i] * dt; z -= this.vz[i] * dt;
            this.vx[i] *= -0.2; this.vz[i] *= -0.2;
          }
        }
      }
      if (gone || y < yBot) { this.kill(i); continue; }
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      const life = P.chunkLife - this.age[i];
      this.size[i] = this.r[i] * Math.min(1, life / 0.6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }
}
