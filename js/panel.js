// Simple 3D page: a flat, scrollable copy of the campaign page floating in front of the screen.
// Drawn into a tall canvas; the panel shows a window of it. Swipe to scroll, tap a buzzword pill to
// throw it into the room.

import * as THREE from 'three';

const W = 1024;

export class PagePanel {
  constructor(P, scene) {
    this.P = P;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.tex = null;
    this.mesh = null;
    this.scene = scene;
    this.scroll = 0;            // 0..max in canvas px
    this.hits = [];             // { x, y, w, h, word }
    this.visible = false;
    this.pose = null;
  }

  draw(words) {
    const P = this.P;
    const c0 = this.canvas.getContext('2d');
    // Layout pass to know the height
    const pills = [];
    const font = (wt, px) => `${wt} ${px}px "Euclid Circular B", "Reddit Sans", system-ui, Arial, sans-serif`;
    c0.font = font(900, 46);
    let x = 70, y = 860;
    const rowH = 104, pad = 34, maxX = W - 70;
    for (const w of words) {
      const tw = c0.measureText(w).width + pad * 2;
      if (x + tw > maxX) { x = 70; y += rowH; }
      pills.push({ x, y, w: tw, h: 80, word: w });
      x += tw + 20;
    }
    const H = y + rowH + 420;
    this.canvas.height = H;
    const c = this.canvas.getContext('2d');
    c.fillStyle = '#0b0b0b';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = P.colNeon; c.lineWidth = 18; c.strokeRect(9, 9, W - 18, H - 18);
    // Kicker pill
    c.font = font(800, 34);
    pill(c, 70, 90, c.measureText('THE ANTI-MARKETING CAMPAIGN 2026').width + 64, 64, '#0b0b0b', '#ffffff', 6);
    c.fillStyle = '#ffffff'; c.textBaseline = 'middle'; c.fillText('THE ANTI-MARKETING CAMPAIGN 2026', 102, 124);
    // Hero
    c.font = font(900, 170);
    c.fillStyle = '#ffffff'; c.textBaseline = 'alphabetic';
    c.fillText('BEYOND', 62, 380);
    c.fillText('THE', 62, 540);
    c.fillStyle = P.colNeon; c.fillText('BUZZ', 62, 700);
    c.font = font(700, 40); c.fillStyle = '#ffffff';
    c.fillText('Vote the buzzword of 2026. Tap one to throw it.', 70, 790);
    // Buzzword pills
    c.font = font(900, 46); c.textBaseline = 'middle';
    for (const p of pills) {
      pill(c, p.x, p.y, p.w, p.h, '#ffffff', '#0b0b0b', 8);
      c.fillStyle = '#0b0b0b'; c.fillText(p.word, p.x + pad, p.y + p.h / 2 + 3);
    }
    // CTA
    const cy = y + rowH + 80;
    c.font = font(900, 54);
    const ct = 'VOTE AT BEYOND.GLOBAL';
    const cw = c.measureText(ct).width + 100;
    pill(c, (W - cw) / 2, cy, cw, 110, P.colNeon, '#0b0b0b', 8);
    c.fillStyle = '#0b0b0b'; c.textAlign = 'center'; c.fillText(ct, W / 2, cy + 58); c.textAlign = 'left';
    c.font = font(500, 30); c.fillStyle = '#ffffff';
    c.fillText('Plain Talk. Zero Buzzwords.  beyond global, Linz and Bremen', 70, cy + 210);
    this.hits = pills;
    if (this.tex) this.tex.dispose();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.anisotropy = 4;
    if (this.mesh) this.mesh.material.map = this.tex;
  }

  attach(pose, words) {
    this.pose = pose;
    if (!this.tex) this.draw(words);
    const P = this.P;
    this.wm = pose.w * P.panelScale;          // panel width in m
    this.hm = pose.h * P.panelScale;          // the window on the monitor, in m
    if (!this.mesh) {
      // The panel is a tall plane: its bottom part sits on the monitor; whatever was scrolled past
      // continues above the monitor's top edge (fading out) instead of disappearing.
      this.mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: this.tex }, uOffset: { value: 0 }, uRepeat: { value: 1 },
          uOpacity: { value: P.panelOpacity }, uWin: { value: 1 }, uFade: { value: 0.3 },
        },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */`
          uniform sampler2D uMap;
          uniform float uOffset, uRepeat, uOpacity, uWin, uFade;
          varying vec2 vUv;
          void main() {
            vec3 c = texture2D(uMap, vec2(vUv.x, uOffset + vUv.y * uRepeat)).rgb;
            // uWin: share of the plane height that is the monitor window (from the bottom).
            float above = max(0.0, vUv.y - uWin) / max(1e-4, 1.0 - uWin);
            float a = uOpacity * (vUv.y > uWin ? 1.0 - smoothstep(1.0 - uFade, 1.0, above) * 0.85 : 1.0);
            gl_FragColor = vec4(c, a);
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
      this.mesh.renderOrder = 5;
      this.scene.add(this.mesh);
    }
    this.mat.uniforms.uMap.value = this.tex;
    const m = new THREE.Matrix4().makeBasis(pose.right, pose.up, pose.normal);
    this.mesh.quaternion.setFromRotationMatrix(m);
    this.view = this.canvas.width * (this.hm / this.wm);   // visible canvas height in px on the monitor
    this.setScroll(this.scroll);
    this.mesh.visible = this.visible;
  }

  setScroll(s) {
    if (!this.tex || !this.pose) return;
    const P = this.P, pose = this.pose;
    const H = this.canvas.height, vh = Math.min(H, this.view || H);
    this.scroll = Math.max(0, Math.min(H - vh, s));
    // How much of the scrolled-past page shows above the monitor (in canvas px, capped).
    const pxPerM = this.canvas.width / this.wm;
    const ext = P.panelExtend ? Math.min(this.scroll, P.panelExtendMax * pxPerM) : 0;
    const shown = vh + ext;
    // Texture window: from (scroll - ext) down to (scroll + vh), v = 1 is the canvas top.
    const r = shown / H;
    const o = 1 - (this.scroll - ext + shown) / H;
    this.tex.repeat.set(1, r);       // kept for hit testing
    this.tex.offset.set(0, o);
    const u = this.mat.uniforms;
    u.uOffset.value = o; u.uRepeat.value = r;
    u.uWin.value = vh / shown;
    u.uFade.value = P.panelExtendFade;
    u.uOpacity.value = P.panelOpacity;
    // Plane: bottom on the monitor window's bottom, taller by the extension.
    const hTot = this.hm * shown / vh;
    this.mesh.scale.set(this.wm, hTot, 1);
    this.mesh.position.copy(pose.center)
      .addScaledVector(pose.normal, P.panelOffset)
      .addScaledVector(pose.up, -this.hm / 2 + hTot / 2);
  }

  scrollBy(px) { this.setScroll(this.scroll + px); }

  show(v) {
    this.visible = v;
    if (this.mesh) { this.mesh.visible = v; this.mat.uniforms.uOpacity.value = this.P.panelOpacity; }
  }

  // Ray hit: returns { word, point } for a pill under the ray, or { point } for the panel, or null.
  hit(raycaster) {
    if (!this.mesh || !this.visible) return null;
    const h = raycaster.intersectObject(this.mesh, false)[0];
    if (!h) return null;
    const H = this.canvas.height;
    const cx = h.uv.x * W;
    const cy = (1 - (h.uv.y * this.tex.repeat.y + this.tex.offset.y)) * H;
    for (const p of this.hits) {
      if (cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h) return { word: p.word, point: h.point };
    }
    return { point: h.point };
  }
}

function pill(c, x, y, w, h, fill, stroke, lw) {
  const r = h / 2;
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y);
  c.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  c.lineTo(x + r, y + h);
  c.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
  c.closePath();
  c.fillStyle = fill; c.fill();
  c.lineWidth = lw; c.strokeStyle = stroke; c.stroke();
}
