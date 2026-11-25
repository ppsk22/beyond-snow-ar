// All tunable parameters. The dev panel (?dev) edits this object live and can copy it as JSON.
// Units: meters, seconds, meters per second unless noted.

export const P = {
  // Colors (CI). Neon green hex is a placeholder until the exact CI value is confirmed.
  colNeon: '#c6ff00',
  colInk: '#0b0b0b',
  colSnow: '#ffffff',
  colSnowShade: '#b9c7dc',
  colOutline: '#0b0b0b',

  // Depth sampling
  depthCols: 64,          // samples across the view (rows follow the aspect ratio); ARCore depth is ~160x90 natively
  depthMin: 0.25,
  depthMax: 5.0,          // ARCore depth gets noisy past ~5 m
  edgeReject: 0.08,       // drop samples whose neighbors differ by more than this share (flying pixels)

  // Surfaces (snow columns)
  cell: 0.05,             // snow column size
  upNormal: 0.82,         // normal.y above this counts as horizontal
  levelMerge: 0.07,       // points within this height belong to the same surface level
  levelConfOn: 0.55,      // confidence needed before a level collects snow
  levelGain: 0.12,        // confidence gain per supporting sample
  levelLoss: 0.08,        // confidence loss per frame when seen as empty
  levelYLerp: 0.15,       // how fast the level height follows new samples

  // Occupancy voxels (dynamic detection)
  vox: 0.1,
  occGain: 0.35,
  occLoss: 0.2,
  freeMargin: 0.06,       // base margin for "seen empty"
  freeMarginQuad: 0.02,   // extra margin per m^2 of distance (depth error grows ~quadratically)
  dynWindow: 1.2,         // a voxel hit within this time after being seen empty is dynamic
  dynOccMax: 0.7,
  camGateMove: 1.2,       // m/s: same for walking fast with the phone or tracking jumps
  camGate: 1.6,           // rad/s: while the phone turns faster than this, no knock-off (depth lags behind)

  // Knock-off
  knockMinH: 0.06,        // intruder must be at least this far above the snow top
  knockMaxH: 0.45,        // and below this height above the level
  knockMinPts: 2,         // dynamic samples needed in a column neighborhood
  knockRadius: 2,         // in cells: neighbors that also lose snow
  knockUp: 1.4,           // upward kick
  knockSide: 1.1,         // sideways kick along the intrusion direction
  knockRandom: 0.6,

  // Snowfall
  flakes: 1400,
  fallSpeed: 0.42,
  fallVar: 0.18,
  sway: 0.12,
  swayFreq: 0.9,
  spawnRadius: 3.2,       // horizontal box around the viewer
  spawnAbove: 1.6,        // top of the snow box above the viewer
  spawnBelow: 2.2,        // bottom of the snow box below the viewer
  flakeSize: 0.011,
  flakeSizeVar: 0.5,
  flakeOutline: 0.22,     // outline share of the flake radius

  // Accumulation
  ambientRate: 0.0016,    // m of snow per second on every confirmed surface (invisible snowfall)
  flakeDeposit: 0.004,    // m of snow per landed flake (spread over a few cells)
  maxSnow: 0.045,
  smoothEvery: 0.5,       // s between smoothing passes
  smooth: 0.18,
  freshFade: 1.2,         // s for a new pile to grow in visually

  // Knocked-off chunks
  chunks: 1600,
  chunkSize: 0.012,
  gravity: 6.0,           // a bit softer than real gravity, reads better on a phone
  drag: 1.6,
  chunkLife: 6,
  chunkStickSpeed: 1.2,   // chunks slower than this re-settle on surfaces

  // Push (falling snow pushed by moving things)
  pushOn: true,
  pushStrength: 1.6,
  pushRadius: 0.16,

  // Logo
  logoWidth: 1.4,         // meters
  logoDepth: 0.12,
  logoSnow: 0.035,        // pre-baked snow height on the logo
  logoSample: 0.016,      // snow column size on the logo

  // Look
  toonSteps: 3,
  shadeGain: 7,           // how quickly snow bumps facing away from the light fall into the shade band
  outlineWidth: 0.6,      // how steep a snow edge must turn away before it gets the outline (bigger = fewer lines)
  lumps: 0.7,            // height variation of the snow blanket (0 = perfectly flat)
  occlusionOn: true,
  occlusionBias: 0.04,
  occlusionBiasRel: 0.015,

  // Performance guard (work time per frame, not fps: ARCore often runs at 30 fps)
  perfOn: true,
  perfBudgetMs: 14,
  perfDown: 1.0,
  perfUp: 4.0,

  // Handoff from the 2D start screen snow
  handoffNear: 0.35,
  handoffFar: 2.2,

  // Simulation (preview mode)
  simNoise: 0.005,        // depth noise at 1 m (scaled with distance^2)
  simPeople: 2,
};

// Panel schema: [key, label, min, max, step] or [key, label] for booleans/colors.
export const SCHEMA = [
  ['Snowfall', [
    ['flakes', 'Flakes', 0, 4000, 50],
    ['fallSpeed', 'Fall speed', 0.05, 2, 0.01],
    ['sway', 'Sway', 0, 0.6, 0.01],
    ['flakeSize', 'Flake size', 0.004, 0.06, 0.001],
    ['spawnRadius', 'Snow box radius', 1, 6, 0.1],
  ]],
  ['Accumulation', [
    ['ambientRate', 'Invisible snowfall', 0, 0.01, 0.0001],
    ['flakeDeposit', 'Snow per flake', 0, 0.02, 0.0005],
    ['maxSnow', 'Max height', 0.005, 0.12, 0.001],
    ['smooth', 'Smoothing', 0, 0.5, 0.01],
  ]],
  ['Surfaces', [
    ['cell', 'Column size (resets)', 0.02, 0.12, 0.005],
    ['upNormal', 'Flatness needed', 0.5, 0.98, 0.01],
    ['levelConfOn', 'Confidence to snow', 0.1, 1, 0.01],
    ['levelLoss', 'Forget speed', 0, 0.5, 0.01],
    ['depthMax', 'Max distance', 1, 8, 0.1],
    ['depthCols', 'Depth samples across', 24, 128, 4],
    ['edgeReject', 'Edge reject', 0.01, 0.3, 0.005],
  ]],
  ['Knock-off', [
    ['knockMinH', 'Min height above snow', 0, 0.3, 0.005],
    ['knockMaxH', 'Max height', 0.1, 1, 0.01],
    ['knockMinPts', 'Points needed', 1, 10, 1],
    ['knockRadius', 'Radius (cells)', 0, 5, 1],
    ['knockUp', 'Up kick', 0, 4, 0.05],
    ['knockSide', 'Side kick', 0, 4, 0.05],
    ['dynWindow', 'Dynamic window (s)', 0.2, 4, 0.1],
    ['camGate', 'Pause while turning (rad/s)', 0.3, 5, 0.1],
  ]],
  ['Chunks and push', [
    ['gravity', 'Gravity', 1, 15, 0.1],
    ['drag', 'Air drag', 0, 6, 0.05],
    ['chunkSize', 'Chunk size', 0.004, 0.05, 0.001],
    ['pushOn', 'Push falling snow'],
    ['pushStrength', 'Push strength', 0, 5, 0.05],
  ]],
  ['Look', [
    ['colNeon', 'Neon'],
    ['colSnowShade', 'Snow shade'],
    ['toonSteps', 'Toon steps', 2, 5, 1],
    ['shadeGain', 'Shade contrast', 0.5, 20, 0.1],
    ['outlineWidth', 'Outline threshold', 0, 1.5, 0.01],
    ['lumps', 'Lumps', 0, 1, 0.01],
    ['occlusionOn', 'Real objects hide snow'],
    ['occlusionBias', 'Occlusion bias', 0, 0.2, 0.005],
  ]],
  ['Logo', [
    ['logoWidth', 'Width (m, re-place)', 0.3, 4, 0.05],
    ['logoSnow', 'Snow on logo', 0, 0.1, 0.001],
  ]],
  ['Performance', [
    ['perfOn', 'Performance guard'],
    ['perfBudgetMs', 'Budget (ms)', 6, 30, 1],
  ]],
  ['Preview', [
    ['simNoise', 'Depth noise', 0, 0.05, 0.001],
  ]],
];

export const DEFAULTS = JSON.parse(JSON.stringify(P));

export function loadSaved() {
  try {
    const s = localStorage.getItem('bsar-config');
    if (s) Object.assign(P, JSON.parse(s));
  } catch (e) { /* storage may be unavailable */ }
}

export function save() {
  try { localStorage.setItem('bsar-config', JSON.stringify(P)); } catch (e) { /* ignore */ }
}
