// Preview mode: a stylized room with walking people. Its depth is rendered into the same DepthFrame
// format as WebXR depth (low resolution, with noise), so the whole snow pipeline runs unchanged.
// Used for testing here and as the fallback on iPhones and desktops.

import * as THREE from 'three';
import { toonMaterial } from './look.js';

const SIM_LAYER = 1;

export class SimRoom {
  constructor(scene, P) {
    this.P = P;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.solids = [];
    const wall = toonMaterial({ base: '#d9d4cc', shade: '#a9a39a', steps: 3 });
    const floor = toonMaterial({ base: '#8b8478', shade: '#6d675d', steps: 3 });
    const wood = toonMaterial({ base: '#7a5a3c', shade: '#57402b', steps: 3 });
    const sofa = toonMaterial({ base: '#3e5a7a', shade: '#2c4058', steps: 3 });
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.layers.enable(SIM_LAYER);
      this.group.add(m);
      this.solids.push(m);
      return m;
    };
    add(new THREE.BoxGeometry(7, 0.1, 7), floor, 0, -0.05, 0);
    add(new THREE.BoxGeometry(7, 3, 0.1), wall, 0, 1.5, -3.5);
    add(new THREE.BoxGeometry(0.1, 3, 7), wall, -3.5, 1.5, 0);
    add(new THREE.BoxGeometry(0.1, 3, 7), wall, 3.5, 1.5, 0);
    add(new THREE.BoxGeometry(7, 3, 0.1), wall, 0, 1.5, 3.5);
    // table
    add(new THREE.BoxGeometry(1.4, 0.05, 0.8), wood, 1.3, 0.75, -1.2);
    for (const [dx, dz] of [[-0.62, -0.32], [0.62, -0.32], [-0.62, 0.32], [0.62, 0.32]]) add(new THREE.BoxGeometry(0.06, 0.73, 0.06), wood, 1.3 + dx, 0.365, -1.2 + dz);
    // sofa and a low box
    add(new THREE.BoxGeometry(2.0, 0.45, 0.85), sofa, -1.6, 0.225, -2.6);
    add(new THREE.BoxGeometry(2.0, 0.5, 0.2), sofa, -1.6, 0.7, -3.0);
    add(new THREE.BoxGeometry(0.6, 0.4, 0.6), wood, -2.6, 0.2, 0.9);
    // shelf on the right wall
    add(new THREE.BoxGeometry(0.35, 0.03, 1.4), wood, 3.25, 1.1, 0.4);

    // People: torso + two swinging legs, walking along loops.
    const skin = toonMaterial({ base: '#c98f6b', shade: '#9c6a4e', steps: 3 });
    const cloth = [toonMaterial({ base: '#b8423c', shade: '#842e2a', steps: 3 }), toonMaterial({ base: '#4a7a3e', shade: '#33562b', steps: 3 })];
    const pants = toonMaterial({ base: '#2b2f3a', shade: '#1b1e26', steps: 3 });
    this.people = [];
    const paths = [
      [[-2.2, 1.6], [2.2, 1.6], [2.2, -0.2], [-2.2, -0.2]],
      [[-0.3, 1.9], [-0.3, -2.0], [-1.4, -2.0], [-1.4, 1.9]],
    ];
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.55, 4, 10), cloth[k]);
      torso.position.y = 1.18;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), skin);
      head.position.y = 1.65;
      const legs = [];
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(0.1 * s, 0.86, 0);
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.68, 4, 8), pants);
        leg.position.y = -0.42;
        pivot.add(leg);
        g.add(pivot);
        legs.push(pivot);
        leg.layers.enable(SIM_LAYER);
      }
      for (const m of [torso, head]) { m.layers.enable(SIM_LAYER); g.add(m); }
      this.group.add(g);
      this.people.push({ g, legs, path: paths[k], seg: 0, t: k * 0.4, speed: 0.9 + k * 0.25, active: true });
    }

    // Depth capture
    this.rtW = 0; this.rtH = 0;
    this.rt = null;
    this.buf = null;
    this.depthMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */`
        varying float vZ;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vZ = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vZ;
        void main() { gl_FragColor = vec4(vZ, 0.0, 0.0, 1.0); }`,
    });
    this.time = 0;
    this.peopleOn = true;
  }

  update(dt) {
    this.time += dt;
    for (const p of this.people) {
      p.g.visible = this.peopleOn && p.active;
      if (!p.g.visible) continue;
      const a = p.path[p.seg], b = p.path[(p.seg + 1) % p.path.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      p.t += (p.speed * dt) / len;
      if (p.t >= 1) { p.t -= 1; p.seg = (p.seg + 1) % p.path.length; }
      const x = a[0] + (b[0] - a[0]) * p.t, z = a[1] + (b[1] - a[1]) * p.t;
      p.g.position.set(x, 0, z);
      p.g.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
      const sw = Math.sin(this.time * p.speed * 6.5) * 0.55;
      p.legs[0].rotation.x = sw; p.legs[1].rotation.x = -sw;
    }
  }

  // Render view depth of the room into the frame grid, add ARCore-like noise.
  captureDepth(renderer, scene, camera, df, cols, rows) {
    if (!this.rt || this.rtW !== cols || this.rtH !== rows) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(cols, rows, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
      this.rtW = cols; this.rtH = rows;
      this.buf = new Float32Array(cols * rows * 4);
    }
    const mask = camera.layers.mask;
    const bg = scene.background;
    const prevTarget = renderer.getRenderTarget();
    camera.layers.set(SIM_LAYER);
    scene.overrideMaterial = this.depthMat;
    scene.background = null;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = null;
    scene.background = bg;
    camera.layers.mask = mask;
    renderer.readRenderTargetPixels(this.rt, 0, 0, cols, rows, this.buf);
    df.resize(cols, rows);
    const noise = this.P.simNoise;
    for (let r = 0; r < rows; r++) {
      const src = (rows - 1 - r) * cols;
      for (let c = 0; c < cols; c++) {
        let z = this.buf[(src + c) * 4];
        if (z > 0) z += gauss() * noise * z * z;
        df.d[r * cols + c] = z > 0 ? z : 0;
      }
    }
    df.setCamera(camera.projectionMatrix.elements, camera.matrixWorld.elements);
  }

  // Ray hit against the room (used for placing the logo in preview).
  raycast(raycaster) {
    const hits = raycaster.intersectObjects(this.solids, false);
    for (const h of hits) {
      if (h.face && h.face.normal.y > 0.7) return h.point;
    }
    return null;
  }
}

function gauss() {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
}
