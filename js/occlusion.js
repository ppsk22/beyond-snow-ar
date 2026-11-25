// Real-world masking, two layers:
//  1. Depth prepass: writes the measured depth into the z-buffer before anything virtual is drawn,
//     so real things in front hide snow and logo. With the person mask on, moving non-person samples
//     are left out (ARCore depth lags behind people, which otherwise leaves a ghost hole in the snow).
//  2. Person cutout (ML mask): after the snow, the real camera pixels of people are drawn back over
//     it with a soft edge, at the person's depth, so only snow behind them gets covered.
// Plus a debug overlay to check that mask and depth line up with the camera image.

import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec2 vPZ;
  void main() {
    vPZ = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const depthFns = /* glsl */`
  uniform sampler2D uDepth;
  // Manual bilinear with texelFetch: float textures are often not filterable on phones,
  // and invalid samples (0) must not drag the depth toward the camera. ch: 0 = R, 1 = G.
  float depthAt(vec2 v, int ch) {
    ivec2 ts = textureSize(uDepth, 0);
    vec2 f = v * vec2(ts) - 0.5;
    ivec2 i0 = ivec2(floor(f));
    vec2 t = fract(f);
    float d = 0.0, wsum = 0.0;
    for (int k = 0; k < 4; k++) {
      ivec2 o = ivec2(k & 1, k >> 1);
      ivec2 q = clamp(i0 + o, ivec2(0), ts - 1);
      vec4 s4 = texelFetch(uDepth, q, 0);
      float s = ch == 0 ? s4.r : s4.g;
      float w = (o.x == 1 ? t.x : 1.0 - t.x) * (o.y == 1 ? t.y : 1.0 - t.y);
      if (s > 0.0) { d += s * w; wsum += w; }
    }
    return wsum > 0.001 ? d / wsum : 0.0;
  }
  // projectionMatrix only exists in the vertex stage, so its two depth terms come in as a varying.
  varying vec2 vPZ;
  float ndcDepth(float d) {
    float z = -d;
    float cz = vPZ.x * z + vPZ.y;
    return clamp((cz / -z) * 0.5 + 0.5, 0.0, 1.0);
  }
`;

export class Occlusion {
  constructor(scene) {
    this.tex = null;
    this.data = null;
    this.vp = new THREE.Vector4(0, 0, 1, 1);
    this.prepass = new THREE.ShaderMaterial({
      uniforms: { uDepth: { value: null }, uBias: { value: 0.04 }, uBiasRel: { value: 0.015 }, uVP: { value: this.vp } },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        uniform float uBias;
        uniform float uBiasRel;
        uniform vec4 uVP;
        ${depthFns}
        void main() {
          vec2 uv = (gl_FragCoord.xy - uVP.xy) / uVP.zw;
          float d = depthAt(vec2(uv.x, 1.0 - uv.y), 0);
          if (d <= 0.0) { gl_FragDepth = 1.0; gl_FragColor = vec4(0.0); return; }
          gl_FragDepth = ndcDepth(d + uBias + uBiasRel * d);
          gl_FragColor = vec4(0.0);
        }`,
      // Depth test must stay enabled (with ALWAYS): a disabled depth test also disables depth writes.
      depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, colorWrite: false,
    });
    this.mesh = fullscreen(this.prepass, -1000);
    scene.add(this.mesh);

    this.cutoutMat = new THREE.ShaderMaterial({
      uniforms: {
        uDepth: { value: null }, uVP: { value: this.vp },
        uCam: { value: null }, uMask: { value: null },
        uCamFlip: { value: 0 }, uThresh: { value: 0.5 }, uFeather: { value: 0.15 },
        uDebug: { value: 0 }, uNeon: { value: new THREE.Color('#c6ff00') },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        uniform vec4 uVP;
        uniform sampler2D uCam;
        uniform sampler2D uMask;
        uniform float uCamFlip;
        uniform float uThresh;
        uniform float uFeather;
        uniform float uDebug;
        uniform vec3 uNeon;
        ${depthFns}
        void main() {
          vec2 uv = (gl_FragCoord.xy - uVP.xy) / uVP.zw;
          vec2 v = vec2(uv.x, 1.0 - uv.y);          // normalized view coords, top-left origin
          float m = texture2D(uMask, v).r;           // mask rows are stored top-down
          float a = smoothstep(uThresh - uFeather, uThresh + uFeather, m);
          if (uDebug > 0.5) {
            // 1: mask in neon, 2: depth as bands (near = warm), both drawn over everything
            gl_FragDepth = 0.0;
            if (uDebug < 1.5) { gl_FragColor = vec4(uNeon, 0.5 * a); return; }
            float d = depthAt(v, 0);
            if (d <= 0.0) { gl_FragColor = vec4(1.0, 0.0, 0.0, 0.35); return; }
            float b = fract(d * 2.0);
            gl_FragColor = vec4(mix(vec3(1.0, 0.45, 0.1), vec3(0.1, 0.5, 1.0), clamp(d / 4.0, 0.0, 1.0)) * (0.6 + 0.4 * b), 0.45);
            return;
          }
          if (a < 0.01) discard;
          float pd = depthAt(v, 1);
          if (pd <= 0.0) discard;
          gl_FragDepth = ndcDepth(pd);
          vec2 cuv = uCamFlip > 0.5 ? v : uv;
          gl_FragColor = vec4(texture2D(uCam, cuv).rgb, a);
        }`,
      transparent: true, depthTest: true, depthWrite: false,
    });
    this.cutout = fullscreen(this.cutoutMat, 1000);
    scene.add(this.cutout);
    this.personDepth = 0;
  }

  // Build the depth texture: R = depth for the prepass, G = person depth for the cutout.
  update(df, P, vp, mask, camTex) {
    const cols = df.cols, rows = df.rows, n = cols * rows;
    if (!this.tex || this.tex.image.width !== cols || this.tex.image.height !== rows) {
      this.data = new Float32Array(n * 2);
      this.tex?.dispose();
      this.tex = new THREE.DataTexture(this.data, cols, rows, THREE.RGFormat, THREE.FloatType);
      this.tex.magFilter = THREE.NearestFilter;
      this.tex.minFilter = THREE.NearestFilter;
      this.prepass.uniforms.uDepth.value = this.tex;
      this.cutoutMat.uniforms.uDepth.value = this.tex;
    }
    const d = df.d, person = df.person, dyn = df.dyn, out = this.data;
    const useMask = P.mlMask && mask && mask.active;
    // Robust person depth: median of person samples. Local minimum below, capped by it.
    let med = 0;
    if (useMask) {
      const vals = [];
      for (let i = 0; i < n; i += 2) if (person[i] && d[i] > 0) vals.push(d[i]);
      if (vals.length) { vals.sort((a, b) => a - b); med = vals[vals.length >> 1]; }
    }
    this.personDepth = med;
    const R = 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let dr = d[i];
        if (useMask && !person[i] && dyn[i]) dr = 0;   // ghost fix: moving non-person samples do not occlude
        out[i * 2] = dr;
        let pd = 0;
        // With depth agreement on, a sample only counts if its own depth is near the person's depth:
        // where the mask lags behind a fast leg, the camera floor would otherwise be pasted over snow.
        const agree = !P.maskDepthAgree || (d[i] > 0 && (!med || d[i] <= med + 0.6));
        if (useMask && person[i] && agree) {
          pd = 1e9;
          for (let rr = Math.max(0, r - R); rr <= Math.min(rows - 1, r + R); rr++) {
            for (let cc = Math.max(0, c - R); cc <= Math.min(cols - 1, c + R); cc++) {
              const q = d[rr * cols + cc];
              if (q > 0 && q < pd) pd = q;
            }
          }
          if (pd > 1e8) pd = med || 0;
          if (med > 0) pd = Math.min(pd, med + 0.3);
        }
        out[i * 2 + 1] = pd;
      }
    }
    this.tex.needsUpdate = true;
    this.vp.copy(vp);
    const u = this.prepass.uniforms;
    u.uBias.value = P.occlusionBias;
    u.uBiasRel.value = P.occlusionBiasRel;
    this.mesh.visible = P.occlusionOn;
    const cu = this.cutoutMat.uniforms;
    cu.uMask.value = mask ? mask.tex : null;
    cu.uCam.value = camTex || null;
    cu.uCamFlip.value = P.camFlipY ? 1 : 0;
    cu.uThresh.value = P.maskThreshold;
    cu.uFeather.value = P.maskFeather;
    cu.uNeon.value.set(P.colNeon);
    const debug = P.debugView === 'mask' ? 1 : P.debugView === 'depth' ? 2 : 0;
    cu.uDebug.value = debug;
    this.cutout.visible = debug > 0 ? (debug === 2 || !!(mask && mask.mask)) : (useMask && !!camTex);
  }

  hide() { this.mesh.visible = false; this.cutout.visible = false; }
}

function fullscreen(mat, order) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false;
  m.renderOrder = order;
  m.visible = false;
  return m;
}
