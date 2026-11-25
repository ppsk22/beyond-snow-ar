// Real-world occlusion: a full-screen pass that writes the measured depth into the z-buffer before
// anything virtual is drawn. Real people and furniture in front then hide snow and logo.

import * as THREE from 'three';

export class Occlusion {
  constructor(scene) {
    this.tex = null;
    this.data = null;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uDepth: { value: null },
        uBias: { value: 0.04 },
        uBiasRel: { value: 0.015 },
        uVP: { value: new THREE.Vector4(0, 0, 1, 1) },
      },
      vertexShader: /* glsl */`
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uDepth;
        uniform float uBias;
        uniform float uBiasRel;
        uniform vec4 uVP;
        void main() {
          vec2 uv = (gl_FragCoord.xy - uVP.xy) / uVP.zw;
          // Manual bilinear with texelFetch: float textures are often not filterable on phones,
          // and invalid samples (0) must not drag the depth toward the camera.
          ivec2 ts = textureSize(uDepth, 0);
          vec2 f = vec2(uv.x, 1.0 - uv.y) * vec2(ts) - 0.5;
          ivec2 i0 = ivec2(floor(f));
          vec2 t = fract(f);
          float d = 0.0, wsum = 0.0;
          for (int k = 0; k < 4; k++) {
            ivec2 o = ivec2(k & 1, k >> 1);
            ivec2 q = clamp(i0 + o, ivec2(0), ts - 1);
            float s = texelFetch(uDepth, q, 0).r;
            float w = (o.x == 1 ? t.x : 1.0 - t.x) * (o.y == 1 ? t.y : 1.0 - t.y);
            if (s > 0.0) { d += s * w; wsum += w; }
          }
          d = wsum > 0.001 ? d / wsum : 0.0;
          if (d <= 0.0) { gl_FragDepth = 1.0; gl_FragColor = vec4(0.0); return; }
          float z = -(d + uBias + uBiasRel * d);
          float cz = projectionMatrix[2][2] * z + projectionMatrix[3][2];
          float cw = -z;
          gl_FragDepth = clamp((cz / cw) * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(0.0);
        }`,
      depthTest: false,
      depthWrite: true,
      colorWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(df, P, vp) {
    const n = df.cols * df.rows;
    if (!this.tex || this.tex.image.width !== df.cols || this.tex.image.height !== df.rows) {
      this.data = new Float32Array(n);
      this.tex = new THREE.DataTexture(this.data, df.cols, df.rows, THREE.RedFormat, THREE.FloatType);
      this.tex.magFilter = THREE.NearestFilter;
      this.tex.minFilter = THREE.NearestFilter;
      this.mat.uniforms.uDepth.value = this.tex;
    }
    // Grid row 0 is the top of the view; texture row 0 is v = 0. The shader flips v.
    this.data.set(df.d);
    this.tex.needsUpdate = true;
    this.mat.uniforms.uBias.value = P.occlusionBias;
    this.mat.uniforms.uBiasRel.value = P.occlusionBiasRel;
    this.mat.uniforms.uVP.value.copy(vp);
    this.mesh.visible = P.occlusionOn;
  }
}
