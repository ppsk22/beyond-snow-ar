// Show objects in the CI look: logo E (three bars), O and 0 pills, buzzword pills with their word,
// single letters (pills break into them). Each builder returns { mesh, colliders, kind, ... } where
// colliders are boxes in the object's local frame ({ hx, hy, hz, x, y, z }).

import * as THREE from 'three';
import { SVGLoader } from './vendor/addons/SVGLoader.js';
import { mergeVertices } from './vendor/addons/BufferGeometryUtils.js';
import { toonMaterial, outlineMaterial } from './look.js';
import { shadeOf } from './logo.js';

export const WORDS = [
  'GAME-CHANGER', 'LOW-HANGING FRUIT', 'PARADIGM SHIFT', 'THOUGHT LEADERSHIP', 'CIRCLE BACK',
  'DEEP DIVE', 'HOLISTIC APPROACH', 'AI-POWERED', 'THE SECRET SAUCE', 'HUMBLED TO ANNOUNCE',
  "IT'S NOT X, IT'S Y", 'BOIL THE OCEAN', 'TAKE IT TO THE NEXT LEVEL', 'OUT OF THE BOX', 'THE ALGORITHM NEEDS TO LEARN',
];

export class ShapeKit {
  constructor(P) {
    this.P = P;
    this.glyphs = null;
    this.letterGeo = new Map();
    this.outlineMats = [];
    this.mats = {};
    this.makeMats();
  }

  makeMats() {
    const P = this.P;
    this.mats.neon = toonMaterial({ base: P.colNeon, shade: shadeOf(P.colNeon, 0.72), steps: 3 });
    this.mats.white = toonMaterial({ base: '#ffffff', shade: '#c9d2e0', steps: 3 });
    this.mats.ink = toonMaterial({ base: '#2a2a2a', shade: '#0b0b0b', steps: 3 });
  }

  recolor(P) {
    this.mats.neon.uniforms.uBase.value.set(P.colNeon);
    this.mats.neon.uniforms.uShade.value.set(shadeOf(P.colNeon, 0.72));
  }

  setViewH(h) { for (const m of this.outlineMats) m.uniforms.uViewH.value = h; }

  async load(url) {
    this.glyphs = await (await fetch(url)).json();
  }

  outline(geo, px = 2) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.getAttribute('position').clone());
    if (geo.index) g.setIndex(geo.index.clone());
    const og = mergeVertices(g, 1e-4);
    og.computeVertexNormals();
    og.setAttribute('smoothNormal', og.getAttribute('normal'));
    const m = outlineMaterial(this.P.colOutline, px);
    this.outlineMats.push(m);
    const mesh = new THREE.Mesh(og, m);
    mesh.renderOrder = 1;
    return mesh;
  }

  // Extruded shape centered on its bounding box, extruded along z, centered in z.
  extrude(shape, depth, bevel) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 10, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    geo.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
    geo.computeBoundingBox();
    return geo;
  }

  wrap(geo, mats, kind) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mats);
    m.renderOrder = 1;
    g.add(m);
    g.add(this.outline(geo));
    const b = geo.boundingBox;
    const size = new THREE.Vector3().subVectors(b.max, b.min);
    return { mesh: g, kind, size, colliders: [{ hx: size.x / 2, hy: size.y / 2, hz: size.z / 2, x: 0, y: 0, z: 0 }] };
  }

  // Logo E: three horizontal rounded bars, no spine.
  makeE(s) {
    const t = s * 0.2, gap = t * 0.7, d = this.P.objDepth;
    const g = new THREE.Group();
    const colliders = [];
    const bar = this.extrude(stadium(s, t), d, 0);
    for (let k = -1; k <= 1; k++) {
      const y = k * (t + gap);
      const m = new THREE.Mesh(bar, [this.mats.neon, this.mats.ink]);
      m.position.y = y; m.renderOrder = 1;
      const o = this.outline(bar);
      o.position.y = y;
      g.add(m, o);
      colliders.push({ hx: s / 2, hy: t / 2, hz: d / 2, x: 0, y, z: 0 });
    }
    return { mesh: g, kind: 'E', size: new THREE.Vector3(s, 3 * t + 2 * gap, d), colliders };
  }

  // Logo O (2:1, wide) and 0 (1:1.3, tall): pill rings.
  makeRing(s, wide) {
    const w = wide ? s : s / 1.3 * 1.0, h = wide ? s / 2 : s;
    const stroke = Math.min(w, h) * 0.26;
    const outer = stadium(w, h);
    outer.holes.push(stadium(w - 2 * stroke, h - 2 * stroke, true));
    const geo = this.extrude(outer, this.P.objDepth, 0);
    const r = this.wrap(geo, [wide ? this.mats.white : this.mats.neon, this.mats.ink], wide ? 'O' : '0');
    return r;
  }

  // Buzzword pill: white face with a thick black rim and the word printed on both faces.
  makePill(word, h) {
    const tex = pillTexture(word, this.P);
    const aspect = tex.image.width / tex.image.height;
    const w = h * aspect;
    const geo = this.extrude(stadium(w, h), this.P.objDepth, 0);
    capUVs(geo);
    const face = toonMaterial({ base: '#ffffff', shade: '#c9d2e0', steps: 3, map: tex });
    const r = this.wrap(geo, [face, this.mats.ink], 'pill');
    r.word = word;
    r.faceMat = face;
    return r;
  }

  // One letter from glyphs.json, cap height h.
  makeLetter(ch, h, color) {
    if (!this.glyphs || !this.glyphs.glyphs[ch] || !this.glyphs.glyphs[ch].d) return null;
    let geo = this.letterGeo.get(ch);
    if (!geo) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${this.glyphs.glyphs[ch].d}"/></svg>`;
      const data = new SVGLoader().parse(svg);
      const shapes = [];
      for (const p of data.paths) shapes.push(...p.toShapes(true));
      // Font units (size 100, y down) -> cap height 1. Scaling y and z by -1 together is a rotation,
      // so the glyph turns upright without flipping the triangle winding.
      const cap = this.glyphs.capHeight, sc = 1 / cap;
      // Thin cut-out: depth relative to cap height so it ends up near objDepth at the default letter size.
      geo = new THREE.ExtrudeGeometry(shapes, { depth: 0.1 * cap, curveSegments: 6, bevelEnabled: false });
      geo.scale(sc, -sc, -sc);
      geo.computeBoundingBox();
      const b0 = geo.boundingBox;
      geo.translate(-(b0.min.x + b0.max.x) / 2, -(b0.min.y + b0.max.y) / 2, -(b0.min.z + b0.max.z) / 2);
      geo.computeBoundingBox();
      geo.computeVertexNormals();
      this.letterGeo.set(ch, geo);
    }
    const mat = color === 'ink' ? this.mats.ink : color === 'white' ? this.mats.white : this.mats.neon;
    const side = color === 'ink' ? this.mats.neon : this.mats.ink;
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, [mat, side]);
    m.renderOrder = 1;
    g.add(m);
    g.add(this.outline(geo, 1.6));
    g.scale.setScalar(h);
    const b = geo.boundingBox;
    const size = new THREE.Vector3().subVectors(b.max, b.min).multiplyScalar(h);
    return { mesh: g, kind: 'letter', size, colliders: [{ hx: size.x / 2, hy: size.y / 2, hz: size.z / 2, x: 0, y: 0, z: 0 }] };
  }

  advance(ch) {
    const g = this.glyphs && this.glyphs.glyphs[ch];
    return g ? g.adv / this.glyphs.capHeight : 0.6;
  }
}

// Stadium (pill) shape centered at 0, width w, height h.
function stadium(w, h, asPath = false) {
  const r = Math.min(w, h) / 2;
  const s = asPath ? new THREE.Path() : new THREE.Shape();
  if (w >= h) {
    const x0 = -w / 2 + r, x1 = w / 2 - r;
    s.moveTo(x0, -r);
    s.lineTo(x1, -r);
    s.absarc(x1, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(x0, r);
    s.absarc(x0, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  } else {
    const y0 = -h / 2 + r, y1 = h / 2 - r;
    s.moveTo(r, y0);
    s.lineTo(r, y1);
    s.absarc(0, y1, r, 0, Math.PI, false);
    s.lineTo(-r, y0);
    s.absarc(0, y0, r, Math.PI, Math.PI * 2, false);
  }
  return s;
}

// Planar UVs on the front and back caps (group 0) from the bounding box; the back is mirrored back.
function capUVs(geo) {
  const pos = geo.attributes.position, uv = geo.attributes.uv, nor = geo.attributes.normal;
  const b = geo.boundingBox;
  const w = b.max.x - b.min.x, h = b.max.y - b.min.y;
  const g0 = geo.groups.find((g) => g.materialIndex === 0);
  if (!g0) return;
  for (let i = g0.start; i < g0.start + g0.count; i++) {
    let u = (pos.getX(i) - b.min.x) / w;
    const v = (pos.getY(i) - b.min.y) / h;
    if (nor.getZ(i) < 0) u = 1 - u;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

// Canvas texture: white pill, thick black rim, the word in heavy caps.
function pillTexture(word, P) {
  const font = '900 120px "Euclid Circular B", "Reddit Sans", system-ui, -apple-system, Arial, sans-serif';
  const c0 = document.createElement('canvas').getContext('2d');
  c0.font = font;
  const tw = c0.measureText(word).width;
  const H = 200, W = Math.ceil(tw + H * 0.95);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const r = H / 2, lw = H * 0.09;
  c.fillStyle = '#0b0b0b';
  c.fillRect(0, 0, W, H);
  c.beginPath();
  c.moveTo(r, lw); c.lineTo(W - r, lw);
  c.arc(W - r, r, r - lw, -Math.PI / 2, Math.PI / 2);
  c.lineTo(r, H - lw);
  c.arc(r, r, r - lw, Math.PI / 2, Math.PI * 1.5);
  c.closePath();
  c.fillStyle = '#ffffff';
  c.fill();
  c.fillStyle = '#0b0b0b';
  c.font = font;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(word, W / 2, H / 2 + H * 0.04);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}
