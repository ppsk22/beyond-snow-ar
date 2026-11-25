// BEYOND THE BUZZ AR snow: boot, mode switching (landing, AR, preview), main loop.

import * as THREE from 'three';
import { P, loadSaved } from './config.js';
import { DepthFrame } from './depthframe.js';
import { SnowWorld, Occupancy } from './world.js';
import { BlanketRenderer } from './blanket.js';
import { Flakes, Chunks } from './particles.js';
import { Logo } from './logo.js';
import { SimRoom } from './sim.js';
import { Occlusion } from './occlusion.js';
import { toonMaterial, LIGHT_DIR } from './look.js';
import { createSnow2D } from './snow2d.js';
import { createTuner } from './tuner.js';
import qrcode from './vendor/qrcode.mjs';

const qs = new URLSearchParams(location.search);
loadSaved();
const DEV = qs.has('dev');

const $ = (id) => document.getElementById(id);
const ui = {
  landing: $('landing'), desk: $('desk'), phone: $('phone'), hud: $('hud'), status: $('status'),
  startAR: $('startAR'), startPreview: $('startPreview'), deskPreview: $('deskPreview'), noAR: $('noAR'), arHint: $('arHint'),
  placeBtn: $('placeBtn'), resetBtn: $('resetBtn'), exitBtn: $('exitBtn'), devPill: $('devPill'), panel: $('panel'), overlay: $('overlay'),
};

// ---------- landing ----------
const snow2d = createSnow2D($('snow2d'), { colors: { snow: P.colSnow, shade: P.colSnowShade, line: P.colOutline } });
const isPhone = qs.has('phone') || (!qs.has('desk') && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900);
let arSupported = false;

function showLanding() {
  ui.landing.hidden = false;
  ui.hud.hidden = true;
  ui.desk.hidden = isPhone;
  ui.phone.hidden = !isPhone;
  snow2d.start();
  requestAnimationFrame(() => snow2d.rescan());
}

function makeQR() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  const qr = qrcode(0, 'M');
  qr.addData(url.toString());
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}

async function detectAR() {
  try {
    arSupported = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'));
  } catch (e) { arSupported = false; }
  if (!arSupported && isPhone && /Android/i.test(navigator.userAgent)) {
    // Android without WebXR AR is usually a webview or another browser (QR scanner apps, Mi Browser,
    // LinkedIn in-app). Offer to reopen the page in Chrome.
    const a = $('openChrome');
    a.href = `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;
    a.hidden = false;
  }
  if (!arSupported && isPhone) {
    ui.noAR.hidden = false;
    ui.arHint.hidden = true;
    ui.startAR.querySelector('span:last-child').textContent = 'Start 3D preview';
    ui.startPreview.hidden = true;
  }
}

makeQR();
showLanding();
detectAR();

// ---------- three ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.domElement.id = 'gl';
renderer.domElement.style.display = 'none';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 60);
scene.add(camera);

const df = new DepthFrame();
const world = new SnowWorld(P.cell);
const logoWorld = new SnowWorld(P.logoSample, true);
const worlds = [logoWorld, world];
const occ = new Occupancy();
const snowMat = toonMaterial({ base: P.colSnow, shade: P.colSnowShade, outline: P.colOutline, steps: P.toonSteps, outlineW: P.outlineWidth, rim: true, polygonOffset: true, gain: P.shadeGain });
const blanket = new BlanketRenderer(world, snowMat, scene);
const logo = new Logo(P, scene);
logo.load('assets/logo.svg').catch((e) => console.warn('logo', e));
// The logo's snow lives in the logo's own frame, so its grid lines up with the letters.
const logoBlanket = new BlanketRenderer(logoWorld, snowMat, logo.root);
logoBlanket.lift = 0.0015;
logoBlanket.lumpScale = 0.35;
const flakes = new Flakes(P, scene);
const chunks = new Chunks(P, scene);
const occl = new Occlusion(scene);

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.09, 0.12, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: P.colNeon, side: THREE.DoubleSide, depthTest: false }),
);
reticle.renderOrder = 10;
reticle.visible = false;
reticle.matrixAutoUpdate = false;
scene.add(reticle);

let sim = null;
let mode = 'landing';
let placing = false;
let handoff = null;
let lastT = 0;
let smoothT = 0;
let quality = 1, perfAcc = 0, perfLowT = 0, perfHighT = 0;
const QUALITY = [1, 0.7, 0.45, 0.3];
let qStep = 0;
const lastFwd = new THREE.Vector3(0, 0, -1);
let angVel = 0;
let linVel = 0;
let gateHold = 0;
const lastCamPos = new THREE.Vector3();
const stats = { knocks: 0, work: 0, levels: 0, live: 0, dyn: 0 };
const depthInfo = () => depthPath.mode + (depthPath.flipY ? ' flip' : '');

function applyLook(key) {
  snowMat.uniforms.uOutlineW.value = P.outlineWidth;
  snowMat.uniforms.uSteps.value = P.toonSteps;
  snowMat.uniforms.uGain.value = P.shadeGain;
  snowMat.uniforms.uShade.value.set(P.colSnowShade);
  for (const m of [flakes.mat, chunks.mat]) m.uniforms.uShade.value.set(P.colSnowShade);
  logo.recolor(P);
  reticle.material.color.set(P.colNeon);
  if (key === 'cell') { world.cell = P.cell; world.clear(); }
}

const tuner = createTuner(ui.panel, applyLook);
if (DEV) { ui.panel.hidden = false; ui.devPill.hidden = false; }
let pressT = 0;
ui.status.addEventListener('pointerdown', () => { pressT = performance.now(); });
ui.status.addEventListener('pointerup', () => {
  if (performance.now() - pressT > 600) { ui.panel.hidden = !ui.panel.hidden; ui.devPill.hidden = ui.panel.hidden && !DEV; }
});

// ---------- shared simulation step ----------
const emitCap = { n: 0 };
function emitReal(l, amount, dx, dz) { chunks.emit(l, amount, dx, dz, P, world.cell, 400, world); stats.knocks++; }
function emitLogo(l, amount, dx, dz) { chunks.emit(l, amount, dx, dz, P, logoWorld.cell, 400, logoWorld); stats.knocks++; }

function simulate(dt, now, haveDepth) {
  const t0 = performance.now();
  if (haveDepth) {
    df.process(P);
    // Turning speed: ARCore depth lags behind fast rotation, which would look like movement everywhere.
    const fwd = new THREE.Vector3(-df.camWorld.elements[8], -df.camWorld.elements[9], -df.camWorld.elements[10]).normalize();
    const ang = Math.acos(Math.min(1, Math.max(-1, fwd.dot(lastFwd))));
    angVel = angVel * 0.7 + (ang / Math.max(dt, 1e-3)) * 0.3;
    lastFwd.copy(fwd);
    // Same for fast moves and tracking jumps (relocalization): everything would look like it moved.
    const jump = lastCamPos.distanceTo(df.camPos);
    linVel = linVel * 0.7 + (jump / Math.max(dt, 1e-3)) * 0.3;
    lastCamPos.copy(df.camPos);
    if (jump > 0.25) gateHold = now + 1.0;
    const gate = angVel < P.camGate && linVel < P.camGateMove && now > gateHold;
    world.support(df, P, now);
    occ.update(df, P, now, gate);
    const removed = [];
    world.freeEvidence(df, P, now, removed);
    for (const l of removed) if (l.vis > 0.002) chunks.drop(l, P, world.cell);
    if (gate && occ.nDyn) {
      world.knock(occ.dynPts, occ.nDyn, P, now, emitReal);
      if (logo.placed) logoWorld.knock(occ.dynPts, occ.nDyn, P, now, emitLogo);
    }
    stats.dyn = occ.nDyn;
  }
  world.update(dt, P, now);
  logoWorld.update(dt, P, now);
  smoothT += dt;
  if (smoothT > P.smoothEvery) { smoothT = 0; world.smooth(P); logoWorld.smooth(P); }

  if (handoff && df.ok) {
    flakes.count = 0;
    flakes.seeded = true;
    for (let i = 0; i < flakes.max; i++) flakes.respawn(i, P, df.camPos, false);
    const vw = handoff.w, vh = handoff.h;
    flakes.handoff(handoff.list, df, P, vw, vh);
    handoff = null;
  }
  const ctx = { P, worlds, occ, df: haveDepth || df.ok ? df : null, cam: df.ok ? df.camPos : camera.position, now, quality };
  flakes.update(dt, ctx);
  chunks.update(dt, ctx);
  const budget = 4000 * quality;
  blanket.update(P, budget);
  logoBlanket.update(P, budget);

  // Performance guard on work time (not fps: AR often runs at 30 fps anyway).
  const work = performance.now() - t0;
  stats.work = stats.work * 0.9 + work * 0.1;
  if (P.perfOn) {
    if (stats.work > P.perfBudgetMs) { perfLowT += dt; perfHighT = 0; } else if (stats.work < P.perfBudgetMs * 0.6) { perfHighT += dt; perfLowT = 0; }
    if (perfLowT > P.perfDown && qStep < QUALITY.length - 1) { qStep++; perfLowT = 0; console.info('[snow] quality step', qStep); }
    if (perfHighT > P.perfUp && qStep > 0) { qStep--; perfHighT = 0; console.info('[snow] quality step', qStep); }
  } else qStep = 0;
  quality = QUALITY[qStep];
}

function updateStatus() {
  let live = 0;
  for (const l of world.levels) if (l.conf >= P.levelConfOn) live++;
  stats.levels = world.levels.length;
  stats.live = live;
  const area = live * world.cell * world.cell;
  let msg;
  if (mode === 'ar' && !df.ok) msg = 'Looking for depth. Move the phone slowly';
  else if (area < 0.3) msg = 'Move your phone slowly to find surfaces';
  else if (placing) msg = 'Tap to place the logo on the ring';
  else msg = `Snow on ${area.toFixed(1)} m². Walk through it!`;
  if (ui.status.textContent !== msg) ui.status.textContent = msg;
  if (!ui.devPill.hidden) {
    ui.devPill.textContent = `work ${stats.work.toFixed(1)} ms  q${qStep}\nlevels ${stats.levels} live ${live}\nvox ${occ.list.length} dyn ${stats.dyn}\nflakes ${flakes.count} chunks ${chunks.count}\nknocks ${stats.knocks}  turn ${angVel.toFixed(2)}\ndepth ${df.cols}x${df.rows} ${mode === 'ar' ? depthInfo() : 'sim'}`;
  }
}

// ---------- AR ----------
let xrSession = null;
let hitSource = null;
let lastHit = null;

async function requestARSession() {
  const overlay = { root: ui.overlay };
  const formats = [['luminance-alpha', 'float32'], ['float32'], ['unsigned-short', 'float32']];
  let lastErr = null;
  for (const f of formats) {
    try {
      return await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['depth-sensing'],
        optionalFeatures: ['hit-test', 'dom-overlay'],
        depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: f },
        domOverlay: overlay,
      });
    } catch (e) { lastErr = e; if (e.name !== 'TypeError') break; }
  }
  throw lastErr;
}

async function startAR() {
  const list = snow2d.getFlakes();
  let session;
  try {
    session = await requestARSession();
  } catch (e) {
    console.warn(e);
    ui.status.textContent = 'AR could not start: ' + (e.message || e.name);
    startSim();
    ui.status.textContent = 'No depth AR on this phone. Here is the 3D preview';
    return;
  }
  xrSession = session;
  mode = 'ar';
  handoff = { list, w: window.innerWidth, h: window.innerHeight };
  resetWorld();
  snow2d.stop();
  ui.landing.hidden = true;
  ui.hud.hidden = false;
  renderer.domElement.style.display = '';
  scene.background = null;
  if (sim) sim.group.visible = false;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  try {
    const viewer = await session.requestReferenceSpace('viewer');
    hitSource = await session.requestHitTestSource({ space: viewer });
  } catch (e) { hitSource = null; }
  session.addEventListener('select', onSelect);
  session.addEventListener('end', () => {
    xrSession = null; hitSource = null; mode = 'landing';
    renderer.setAnimationLoop(null);
    renderer.domElement.style.display = 'none';
    showLanding();
  });
  renderer.setAnimationLoop(onXRFrame);
}

const vp = new THREE.Vector4();
function onXRFrame(t, frame) {
  if (!frame) return;
  const now = t / 1000;
  const dt = Math.min(0.1, lastT ? now - lastT : 1 / 30);
  lastT = now;
  const ref = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(ref);
  let haveDepth = false;
  if (pose) {
    const view = pose.views[0];
    let di = null;
    try { di = frame.getDepthInformation(view); } catch (e) { di = null; }
    const layer = xrSession.renderState.baseLayer;
    const v = layer ? layer.getViewport(view) : null;
    const vh = v ? v.height : renderer.domElement.height;
    const vw = v ? v.width : renderer.domElement.width;
    if (v) vp.set(v.x, v.y, v.width, v.height);
    if (di) {
      const cols = P.depthCols | 0;
      const rows = Math.max(8, Math.round(cols * (vh / vw)));
      df.resize(cols, rows);
      readDepth(di, df, cols, rows);
      df.setCamera(view.projectionMatrix, view.transform.matrix);
      haveDepth = true;
    }
    for (const m of [flakes.mat, chunks.mat]) m.uniforms.uViewH.value = vh;
    logo.setViewH(vh);
    if (hitSource) {
      const res = frame.getHitTestResults(hitSource);
      if (res.length) {
        const hp = res[0].getPose(ref);
        reticle.matrix.fromArray(hp.transform.matrix);
        lastHit = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
        reticle.visible = placing;
      } else { reticle.visible = false; lastHit = null; }
    }
  }
  simulate(dt, now, haveDepth);
  if (haveDepth) occl.update(df, P, vp); else occl.mesh.visible = false;
  updateStatus();
  renderer.render(scene, camera);
}

// Depth readout. getDepthInMeters() is the safe path but costs one native call per sample.
// The fast path reads the raw buffer through normDepthBufferFromNormView. It is checked against the
// safe path on the first frames (both y orientations) and only used if it matches.
const depthPath = { mode: 'probe', flipY: false, checks: 0, good: [0, 0], tested: 0 };
function slowSample(di, x, y) {
  try { const z = di.getDepthInMeters(x, y); return z > 0 && isFinite(z) ? z : 0; } catch (e) { return 0; }
}
function fastSampler(di, flipY) {
  const m = di.normDepthBufferFromNormView && di.normDepthBufferFromNormView.matrix;
  if (!m || !di.data) return null;
  const w = di.width, h = di.height, scale = di.rawValueToMeters || 0.001;
  const isFloat = xrSession && xrSession.depthDataFormat === 'float32';
  const arr = isFloat ? new Float32Array(di.data) : new Uint16Array(di.data);
  return (x, y) => {
    const yy = flipY ? 1 - y : y;
    const u = m[0] * x + m[4] * yy + m[12];
    const v = m[1] * x + m[5] * yy + m[13];
    const px = Math.floor(u * w), py = Math.floor(v * h);
    if (px < 0 || py < 0 || px >= w || py >= h) return 0;
    const z = arr[py * w + px] * scale;
    return z > 0 && isFinite(z) ? z : 0;
  };
}
function readDepth(di, df, cols, rows) {
  const d = df.d;
  let sample = null;
  if (depthPath.mode === 'fast') sample = fastSampler(di, depthPath.flipY);
  if (depthPath.mode === 'probe' && depthPath.tested < 20) {
    // Compare a few samples from both fast variants with the safe path.
    for (const flip of [false, true]) {
      const f = fastSampler(di, flip);
      if (!f) { depthPath.mode = 'slow'; break; }
      let ok = 0, n = 0;
      for (let k = 0; k < 24; k++) {
        const x = 0.1 + Math.random() * 0.8, y = 0.1 + Math.random() * 0.8;
        const a = slowSample(di, x, y), b = f(x, y);
        if (a > 0) { n++; if (Math.abs(a - b) < 0.05 + 0.02 * a) ok++; }
      }
      if (n > 10 && ok / n > 0.9) depthPath.good[flip ? 1 : 0]++;
    }
    depthPath.tested++;
    if (depthPath.tested >= 20 && depthPath.mode === 'probe') {
      const [g0, g1] = depthPath.good;
      if (g0 >= 15 || g1 >= 15) { depthPath.mode = 'fast'; depthPath.flipY = g1 > g0; } else depthPath.mode = 'slow';
      console.info('[snow] depth read path:', depthPath.mode, depthPath.flipY ? '(y flipped)' : '', depthPath.good);
    }
  }
  if (!sample) sample = (x, y) => slowSample(di, x, y);
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) / rows;
    for (let c = 0; c < cols; c++) d[r * cols + c] = sample((c + 0.5) / cols, y);
  }
}

function onSelect() {
  if (!placing || !lastHit || !logo.ready) return;
  logo.place(lastHit, df.camPos, logoWorld);
  placing = false;
  ui.placeBtn.classList.remove('on');
  reticle.visible = false;
}

// ---------- preview (simulation) ----------
const look = { yaw: 0, pitch: -0.32, keys: new Set(), drag: null };

function startSim() {
  const list = snow2d.getFlakes();
  if (!sim) sim = new SimRoom(scene, P);
  sim.group.visible = true;
  mode = 'sim';
  handoff = { list, w: window.innerWidth, h: window.innerHeight };
  resetWorld();
  snow2d.stop();
  ui.landing.hidden = true;
  ui.hud.hidden = false;
  renderer.domElement.style.display = '';
  scene.background = new THREE.Color('#1a1a1a');
  camera.position.set(0.6, 1.45, 3.0);
  look.yaw = 0; look.pitch = -0.32;
  occl.mesh.visible = false;
  lastT = 0;
  renderer.setAnimationLoop(onSimFrame);
}

function onSimFrame(t) {
  const now = t / 1000;
  const dt = Math.min(0.05, lastT ? now - lastT : 1 / 60);
  lastT = now;
  const sp = 1.4 * dt;
  const f = new THREE.Vector3(-Math.sin(look.yaw), 0, -Math.cos(look.yaw));
  const r = new THREE.Vector3(-f.z, 0, f.x);
  if (look.keys.has('w')) camera.position.addScaledVector(f, sp);
  if (look.keys.has('s')) camera.position.addScaledVector(f, -sp);
  if (look.keys.has('a')) camera.position.addScaledVector(r, -sp);
  if (look.keys.has('d')) camera.position.addScaledVector(r, sp);
  camera.position.x = Math.max(-3.2, Math.min(3.2, camera.position.x));
  camera.position.z = Math.max(-3.2, Math.min(3.2, camera.position.z));
  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  sim.update(dt);
  const cols = P.depthCols | 0;
  const rows = Math.max(8, Math.round(cols * (window.innerHeight / window.innerWidth)));
  sim.captureDepth(renderer, scene, camera, df, cols, rows);
  const h = renderer.domElement.height;
  for (const m of [flakes.mat, chunks.mat]) m.uniforms.uViewH.value = h;
  logo.setViewH(h);
  // Reticle: center ray against the room
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const p = sim.raycast(ray);
  if (p) { reticle.matrix.makeTranslation(p.x, p.y + 0.003, p.z); lastHit = p.clone(); }
  reticle.visible = placing && !!p;
  simulate(dt, now, true);
  updateStatus();
  renderer.render(scene, camera);
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'sim') return;
  look.drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch, moved: 0 };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!look.drag) return;
  const dx = e.clientX - look.drag.x, dy = e.clientY - look.drag.y;
  look.drag.moved = Math.max(look.drag.moved, Math.hypot(dx, dy));
  look.yaw = look.drag.yaw + dx * 0.005;
  look.pitch = Math.max(-1.3, Math.min(0.9, look.drag.pitch + dy * 0.005));
});
renderer.domElement.addEventListener('pointerup', () => {
  if (look.drag && look.drag.moved < 6 && placing && lastHit && logo.ready) {
    logo.place(lastHit, camera.position, logoWorld);
    placing = false;
    ui.placeBtn.classList.remove('on');
  }
  look.drag = null;
});
addEventListener('keydown', (e) => look.keys.add(e.key.toLowerCase()));
addEventListener('keyup', (e) => look.keys.delete(e.key.toLowerCase()));
addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- buttons ----------
function noXRSelect(el) { el.addEventListener('beforexrselect', (e) => e.preventDefault()); }
[ui.placeBtn, ui.resetBtn, ui.exitBtn, ui.status].forEach(noXRSelect);

function resetWorld() {
  world.cell = P.cell;
  world.clear();
  logoWorld.clear();
  occ.clear();
  chunks.count = 0;
  logo.root.visible = false;
  logo.placed = false;
  df.ok = false;
  stats.knocks = 0;
}

ui.startAR.addEventListener('click', () => { if (arSupported) startAR(); else startSim(); });
ui.startPreview.addEventListener('click', startSim);
ui.deskPreview.addEventListener('click', startSim);
ui.placeBtn.addEventListener('click', () => {
  placing = !placing;
  ui.placeBtn.classList.toggle('on', placing);
});
ui.resetBtn.addEventListener('click', resetWorld);
ui.exitBtn.addEventListener('click', () => {
  if (xrSession) { xrSession.end(); return; }
  renderer.setAnimationLoop(null);
  renderer.domElement.style.display = 'none';
  if (sim) sim.group.visible = false;
  mode = 'landing';
  showLanding();
});

// Test hooks (used by the headless tests, harmless otherwise).
window.__bsar = {
  P, world, logoWorld, occ, df, flakes, chunks, logo, camera, look, stats,
  get sim() { return sim; },
  get mode() { return mode; },
  startSim, resetWorld,
  placeLogoAt(x, y, z) { logo.place(new THREE.Vector3(x, y, z), camera.position, logoWorld); },
  liveArea() { let n = 0; for (const l of world.levels) if (l.conf >= P.levelConfOn) n++; return n * world.cell * world.cell; },
  snowVolume() { let v = 0; for (const l of world.levels) v += l.vis; return v * world.cell * world.cell; },
};
void LIGHT_DIR; void emitCap; void tuner;
