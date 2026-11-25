// 3D logo from assets/logo.svg: extruded, cel shaded, inverted hull outline, pre-baked snow caps.
// Swap assets/logo.svg for the real CI logo; any SVG with filled paths works.

import * as THREE from 'three';
import { SVGLoader } from './vendor/addons/SVGLoader.js';
import { mergeVertices } from './vendor/addons/BufferGeometryUtils.js';
import { toonMaterial, outlineMaterial } from './look.js';

export class Logo {
  constructor(P, scene) {
    this.P = P;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.inner = new THREE.Group();
    this.root.add(this.inner);
    this.meshes = [];
    this.outlineMats = [];
    this.capMat = toonMaterial({ base: P.colNeon, shade: shadeOf(P.colNeon, 0.72), steps: P.toonSteps });
    this.sideMat = toonMaterial({ base: '#2a2a2a', shade: P.colInk, steps: P.toonSteps });
    this.ready = false;
    this.placed = false;
  }

  async load(url) {
    const data = await new SVGLoader().loadAsync(url);
    const P = this.P;
    const shapes = [];
    for (const path of data.paths) shapes.push(...path.toShapes(true));
    // SVG units -> meters (width = logoWidth), y flipped (SVG y points down).
    const box = new THREE.Box2();
    for (const s of shapes) for (const p of s.getPoints(8)) box.expandByPoint(p);
    const w = box.max.x - box.min.x;
    const scale = P.logoWidth / w;
    const depth = P.logoDepth / scale;
    for (const s of shapes) {
      const geo = new THREE.ExtrudeGeometry(s, {
        depth, curveSegments: 6, bevelEnabled: true,
        bevelThickness: depth * 0.06, bevelSize: 0.9, bevelSegments: 1,
      });
      geo.translate(-(box.min.x + w / 2), -box.max.y, -depth / 2);
      geo.scale(scale, -scale, scale);
      // scale(-y) flips winding; flip the index back so faces point outward again
      flipWinding(geo);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, [this.capMat, this.sideMat]);
      mesh.renderOrder = 1;
      this.inner.add(mesh);
      this.meshes.push(mesh);
      const og = mergeVertices(stripForOutline(geo), 1e-4);
      og.computeVertexNormals();
      og.setAttribute('smoothNormal', og.getAttribute('normal'));
      const om = outlineMaterial(P.colOutline, 2.2);
      this.outlineMats.push(om);
      const outline = new THREE.Mesh(og, om);
      outline.renderOrder = 1;
      this.inner.add(outline);
    }
    this.ready = true;
  }

  setViewH(h) { for (const m of this.outlineMats) m.uniforms.uViewH.value = h; }

  // Stand the logo on a surface point, facing the viewer.
  place(pos, camPos, world) {
    const yaw = Math.atan2(camPos.x - pos.x, camPos.z - pos.z);
    // Bake in the logo's own frame (identity transform), then move it into place.
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    world.frame = null;
    this.bakeSnow(world);
    this.root.position.copy(pos);
    this.root.rotation.set(0, yaw, 0);
    this.root.visible = true;
    this.root.updateMatrixWorld(true);
    world.setFrame(pos.x, pos.y, pos.z, yaw);
    this.placed = true;
  }

  // Raycast down over the logo footprint; every upward face becomes a virtual snow level with snow on it.
  bakeSnow(world) {
    const P = this.P;
    world.clear();
    const box = new THREE.Box3().setFromObject(this.inner);
    const cell = world.cell;
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const o = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    const n = new THREE.Vector3();
    const x0 = Math.floor(box.min.x / cell), x1 = Math.ceil(box.max.x / cell);
    const z0 = Math.floor(box.min.z / cell), z1 = Math.ceil(box.max.z / cell);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        o.set((ix + 0.5) * cell, box.max.y + 0.1, (iz + 0.5) * cell);
        ray.set(o, down);
        const hits = ray.intersectObjects(this.meshes, false);
        let lastY = Infinity;
        for (const h of hits) {
          if (!h.face) continue;
          nm.getNormalMatrix(h.object.matrixWorld);
          n.copy(h.face.normal).applyMatrix3(nm).normalize();
          if (n.y < 0.6) continue;
          if (lastY - h.point.y < 0.03) continue;
          lastY = h.point.y;
          const l = world.addLevel(ix, iz, h.point.y, 1, 0);
          // Less snow where the top curves away (O, S, D): it collects on the crest only.
          const k = Math.pow(Math.max(0, (n.y - 0.6) / 0.4), 2.5);
          l.snow = l.vis = P.logoSnow * k;
        }
      }
    }
    for (let k = 0; k < 3; k++) world.smooth(P);
  }

  recolor(P) {
    this.capMat.uniforms.uBase.value.set(P.colNeon);
    this.capMat.uniforms.uShade.value.set(shadeOf(P.colNeon, 0.72));
  }
}

function stripForOutline(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  return g;
}

function flipWinding(geo) {
  if (geo.index) {
    const a = geo.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    geo.index.needsUpdate = true;
  } else {
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i += 3) {
      swap(pos, i + 1, i + 2);
      if (uv) swap(uv, i + 1, i + 2);
    }
    pos.needsUpdate = true;
  }
}

function swap(attr, a, b) {
  const s = attr.itemSize, arr = attr.array;
  for (let k = 0; k < s; k++) { const t = arr[a * s + k]; arr[a * s + k] = arr[b * s + k]; arr[b * s + k] = t; }
}

export function shadeOf(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}
