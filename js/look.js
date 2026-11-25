// Cel-shaded look: toon steps, illustrated top outline, outlined snow flakes, inverted hull outlines.

import * as THREE from 'three';

export const LIGHT_DIR = new THREE.Vector3(-0.35, 1, 0.45).normalize();

const toonVert = /* glsl */`
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const toonFrag = /* glsl */`
  uniform vec3 uBase;
  uniform vec3 uShade;
  uniform vec3 uOutline;
  uniform vec3 uLight;
  uniform float uSteps;
  uniform float uOutlineW;
  uniform float uRim;
  uniform float uGain;
  #ifdef USE_MAP
  uniform sampler2D uMap;
  #endif
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vUv;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    if (!gl_FrontFacing) N = -N;
    float t;
    if (uGain > 0.0) {
      // Relative to a flat surface: flat snow is fully lit, bumps turned away from the light get bands.
      t = clamp(1.0 + (dot(N, uLight) - uLight.y) * uGain, 0.0, 1.0);
      t = floor(t * (uSteps - 1.0) + 0.5) / max(1.0, uSteps - 1.0);
    } else {
      float ndl = dot(N, uLight) * 0.5 + 0.5;
      t = clamp(floor(ndl * uSteps) / max(1.0, uSteps - 1.0), 0.0, 1.0);
    }
    #ifdef USE_MAP
    vec3 tex = texture2D(uMap, vUv).rgb;
    vec3 col = mix(tex * uShade, tex * uBase, t);
    #else
    vec3 col = mix(uShade, uBase, t);
    #endif
    // Illustrated outline only where the surface turns away from the viewer on its upper side.
    // Compared with a flat surface seen from the same spot, so far-away flat floors stay clean.
    float rel = dot(N, V) - V.y;
    if (uRim > 0.5 && rel < -uOutlineW * 0.5 && N.y > 0.05) col = uOutline;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function toonMaterial(opts) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(opts.base) },
      uShade: { value: new THREE.Color(opts.shade) },
      uOutline: { value: new THREE.Color(opts.outline || '#0b0b0b') },
      uLight: { value: LIGHT_DIR.clone() },
      uSteps: { value: opts.steps || 3 },
      uOutlineW: { value: opts.outlineW ?? 0.3 },
      uRim: { value: opts.rim ? 1 : 0 },
      uGain: { value: opts.gain || 0 },
    },
    vertexShader: toonVert,
    fragmentShader: toonFrag,
    side: opts.side ?? THREE.FrontSide,
    polygonOffset: !!opts.polygonOffset,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  if (opts.map) {
    // Textured: base and shade act as light multipliers on the texture.
    m.defines = { USE_MAP: '' };
    m.uniforms.uMap = { value: opts.map };
  }
  return m;
}

// Inverted hull outline with roughly constant screen width.
export function outlineMaterial(color, widthPx) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uWidth: { value: widthPx },
      uViewH: { value: 1000 },
    },
    vertexShader: /* glsl */`
      attribute vec3 smoothNormal;
      uniform float uWidth;
      uniform float uViewH;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vec4 clip = projectionMatrix * viewMatrix * w;
        vec3 n = normalize(mat3(viewMatrix) * normalize(mat3(modelMatrix) * smoothNormal));
        vec2 dir = normalize(n.xy + 1e-5);
        clip.xy += dir * uWidth * 2.0 / uViewH * clip.w;
        gl_Position = clip;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `,
    side: THREE.BackSide,
  });
}

// Round points: white flake with cel shade crescent and an outline that is thick on top, gone at the bottom.
export function flakeMaterial(P) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uViewH: { value: 1000 },
      uMaxPx: { value: 0.028 },
      uSnow: { value: new THREE.Color(P.colSnow) },
      uShade: { value: new THREE.Color(P.colSnowShade) },
      uOutline: { value: new THREE.Color(P.colOutline) },
      uOW: { value: P.flakeOutline },
    },
    vertexShader: /* glsl */`
      attribute float size;
      uniform float uViewH;
      uniform float uMaxPx;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float z = -mv.z;
        float px = size * projectionMatrix[1][1] * uViewH * 0.5 / max(0.05, z);
        // Flakes right in front of the lens would turn into huge discs: fade them out by size.
        float nearFade = smoothstep(0.25, 0.5, z);
        gl_PointSize = min(px * 2.0, uViewH * uMaxPx) * nearFade;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSnow;
      uniform vec3 uShade;
      uniform vec3 uOutline;
      uniform float uOW;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;   // y points down
        float d = length(p);
        if (d > 1.0) discard;
        vec3 col = uSnow;
        if (p.x * 0.45 + p.y * 0.8 > 0.42) col = uShade;
        float ow = uOW * smoothstep(0.7, -0.5, p.y);
        if (d > 1.0 - ow) col = uOutline;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
