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
  // Certification: a level only carries snow when all of these hold (very strict by default)
  certConf: 0.85,         // confidence (about 15 supporting samples)
  certAge: 2.0,           // s since first seen
  certViews: 2,           // distinct phone positions that saw it
  certViewDist: 0.12,     // m the phone must move to count as a new viewpoint
  certNoise: 0.025,       // m: max height jitter
  certNeighbors: 13,      // of 24 cells around it at the same height (flat patch test, kills heads and specks)
  certDynQuiet: 3.0,      // s with no movement at or just above it
  uncertConf: 0.35,       // certified levels drop out below this confidence (hysteresis)

  // Surface confirmation (dev): the floor first; tap a neon square to confirm, long press to remove
  confirmMode: true,
  onlyConfirmed: false,   // snow only on confirmed surfaces (strict auto-certification off)
  autoFloor: false,       // confirm the floor by itself once it is very sure
  autoFloorArea: 3.0,     // m2 of floor needed for that
  candConf: 0.6,          // confidence a cell needs to be part of a candidate
  candMinArea: 0.2,       // m2: smallest non-floor candidate (a small table)
  floorMinArea: 0.6,      // m2: floor candidate
  floorBelowMin: 0.7,     // m: the floor is at least this far below the phone
  floorSquare: 1.2,       // m: size of the floor square
  candStable: 0.8,        // s a candidate must exist before its square shows
  confirmedConf: 0.3,     // cells of confirmed surfaces need only this confidence
  showConfirmed: true,    // keep a thin white frame on confirmed surfaces
  longPress: 0.6,         // s
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
  knockMaxH: 1.0,         // and below this height above the level
  knockMinPts: 1,         // dynamic samples needed in a column neighborhood
  knockRadius: 3,         // in cells: neighbors that also lose snow (dramatic: everything under a foot goes)
  knockUp: 1.8,           // upward kick
  knockSide: 1.6,         // sideways kick along the intrusion direction
  knockRandom: 0.6,
  knockEdge: 1.0,         // how much snow the edge of a knock-off hole loses (0 = soft rim stays)
  knockPersonAll: true,   // with the ML mask: all snow under a detected person goes, no height band

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
  ambientRate: 0.0016,    // m of snow per second on certified surfaces (invisible snowfall)
  patchSpeed: 0.06,       // how fast patches spread after certification (1 / s)
  patchScale: 2.4,        // patch noise frequency (1 / m): bigger = smaller, more patches
  patchSoft: 4,           // how hard patch edges grow in
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

  // People masking
  mlMask: false,          // ML person cutout (MediaPipe on the camera image, needs camera-access)
  segModel: 'deeplab',    // deeplab (general, full bodies) | selfie (fast, close people) | multiclass
  segFps: 12,             // segmentation runs per second (runs in a worker)
  segWidth: 160,          // width of the image sent to the model (height follows the screen)
  maskThreshold: 0.55,
  maskFeather: 0.12,      // soft edge of the cutout
  maskDilate: 1,          // depth samples next to the mask also count as person (mask lags a bit)
  maskDepthAgree: true,   // cutout only where depth also sees something near (hides mask lag ghosts)
  camFlipY: false,        // flip if the cutout or mask shows up upside down on the device
  debugView: 'off',       // off | mask | depth: overlay to check alignment on the device
  simMaskLag: 0.08,       // preview: delay of the fake mask, like a real model

  // Screen show: find the desktop screen by its neon frame, then things come out of it
  screenMode: true,       // start every AR / preview session by looking for the screen
  findHz: 5,              // detection attempts per second
  findWidth: 320,         // camera image width used for detection
  findHueMin: 50,         // neon window (degrees, saturation, value)
  findHueMax: 115,
  findSat: 0.45,
  findVal: 0.45,
  findMinPx: 0.004,       // smallest frame (share of image pixels)
  findMinArea: 0.015,     // smallest frame quad (share of the image)
  findLock: 3,            // consistent detections in a row before it locks
  findAssumeW: 0.6,       // m: screen width assumed when the screen has no depth
  burstCount: 14,         // objects in the opening burst
  burstTime: 2.0,
  dropEvery: 2.5,         // s between steady drops (0 = off)
  dropOutShare: 0.25,     // share of steady drops that come out of the screen instead of over the top
  mixE: 1,                // weights: logo E, O/0 pills, buzzword pills
  mixO: 1,
  mixPill: 1.5,
  objScale: 1,
  pillHeight: 0.045,      // m
  objDepth: 0.006,        // m: thickness of the flat 2D cut-outs (new objects only)
  outSpeed: 1.8,          // m/s out of the screen
  outLift: 0.9,
  spin: 6,
  maxObjects: 40,
  objGravity: 6.5,
  objFriction: 0.45,
  objBounce: 0.25,
  objPush: 1.2,           // how hard people shove objects
  objPushRadius: 0.3,
  shatterOnPush: true,    // pills break into letters when someone walks into them
  shatterOnTap: true,     // ... or when tapped
  shatterForce: 1,
  letterColor: 'neon',    // neon | white | ink
  letterScale: 1.8,       // letters from a broken pill, relative to the printed text size
  shatterMinPts: 6,       // moving points that must touch a pill before it breaks
  assumeFloorBelow: 1.35, // m below the phone, until a floor is found
  screenSnowShare: 0.5,   // share of the snow that comes out of the screen
  screenSnowTop: 0.35,    // of that, the share that tips over the top edge
  screenSnowSpeed: 0.8,
  panelOn: false,         // 3D page in front of the screen
  panelScale: 0.9,
  panelOffset: 0.15,
  panelOpacity: 0.95,
  panelScrollSpeed: 1.5,

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
    ['patchSpeed', 'Patch spread speed', 0.005, 0.5, 0.005],
    ['patchScale', 'Patch size (bigger = smaller)', 0.5, 8, 0.1],
    ['flakeDeposit', 'Snow per flake', 0, 0.02, 0.0005],
    ['maxSnow', 'Max height', 0.005, 0.12, 0.001],
    ['smooth', 'Smoothing', 0, 0.5, 0.01],
  ]],
  ['Confirm surfaces (dev)', [
    ['confirmMode', 'Offer squares to confirm'],
    ['onlyConfirmed', 'Snow only on confirmed'],
    ['autoFloor', 'Confirm floor by itself'],
    ['floorMinArea', 'Floor area before square (m2)', 0.1, 4, 0.05],
    ['candMinArea', 'Other surfaces min area (m2)', 0.05, 2, 0.01],
    ['candConf', 'Candidate confidence', 0.2, 0.95, 0.01],
    ['floorBelowMin', 'Floor at least below phone (m)', 0.2, 1.5, 0.05],
    ['floorSquare', 'Floor square size (m)', 0.3, 3, 0.05],
    ['showConfirmed', 'Show confirmed frames'],
    ['longPress', 'Long press (s)', 0.3, 1.5, 0.05],
  ]],
  ['Surfaces', [
    ['cell', 'Column size (resets)', 0.02, 0.12, 0.005],
    ['upNormal', 'Flatness needed', 0.5, 0.98, 0.01],
    ['certConf', 'Confidence to snow', 0.3, 0.99, 0.01],
    ['certAge', 'Steady for (s)', 0, 8, 0.1],
    ['certViews', 'Viewpoints needed', 1, 5, 1],
    ['certNoise', 'Max jitter (m)', 0.005, 0.08, 0.001],
    ['certNeighbors', 'Flat patch (of 24)', 0, 24, 1],
    ['certDynQuiet', 'Quiet before snow (s)', 0, 10, 0.1],
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
    ['knockEdge', 'Hole edge strength', 0, 1, 0.05],
    ['knockPersonAll', 'Person clears everything (ML)'],
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
  ]],
  ['Logo', [
    ['logoWidth', 'Width (m, re-place)', 0.3, 4, 0.05],
    ['logoSnow', 'Snow on logo', 0, 0.1, 0.001],
  ]],
  ['Screen show', [
    ['screenMode', 'Look for the screen at start'],
    ['burstCount', 'Opening burst', 0, 60, 1],
    ['burstTime', 'Burst length (s)', 0.2, 8, 0.1],
    ['dropEvery', 'Drop every (s, 0 = off)', 0, 10, 0.1],
    ['dropOutShare', 'Drops out of screen', 0, 1, 0.05],
    ['mixE', 'Weight: E', 0, 5, 0.1],
    ['mixO', 'Weight: O / 0', 0, 5, 0.1],
    ['mixPill', 'Weight: word pills', 0, 5, 0.1],
    ['objScale', 'Object size', 0.3, 3, 0.05],
    ['objDepth', 'Thickness (m, new objects)', 0.002, 0.05, 0.001],
    ['outSpeed', 'Out speed', 0, 5, 0.05],
    ['outLift', 'Out lift', 0, 3, 0.05],
    ['spin', 'Spin', 0, 20, 0.5],
    ['maxObjects', 'Max objects', 5, 120, 1],
    ['screenSnowShare', 'Snow from screen', 0, 1, 0.05],
    ['screenSnowTop', 'Of that over the top', 0, 1, 0.05],
    ['screenSnowSpeed', 'Screen snow speed', 0, 3, 0.05],
  ]],
  ['Objects', [
    ['objGravity', 'Gravity', 1, 15, 0.1],
    ['objFriction', 'Friction', 0, 1, 0.01],
    ['objBounce', 'Bounce', 0, 0.9, 0.01],
    ['objPush', 'People shove', 0, 5, 0.05],
    ['objPushRadius', 'Shove radius', 0.05, 0.8, 0.01],
    ['shatterOnPush', 'Pills break when walked into'],
    ['shatterOnTap', 'Pills break when tapped'],
    ['shatterForce', 'Break force', 0, 4, 0.05],
    ['letterColor', 'Letter color', ['neon', 'white', 'ink']],
    ['letterScale', 'Letter size', 0.5, 4, 0.05],
    ['shatterMinPts', 'Walk-through needed (points)', 1, 40, 1],
  ]],
  ['Page panel', [
    ['panelOn', 'Show page at start'],
    ['panelScale', 'Size (of screen)', 0.3, 2, 0.05],
    ['panelOffset', 'Distance from screen', 0, 1, 0.01],
    ['panelOpacity', 'Opacity', 0.2, 1, 0.01],
    ['panelScrollSpeed', 'Scroll speed', 0.2, 5, 0.1],
  ]],
  ['Screen detection', [
    ['findHueMin', 'Hue min', 0, 180, 1],
    ['findHueMax', 'Hue max', 0, 180, 1],
    ['findSat', 'Saturation min', 0, 1, 0.01],
    ['findVal', 'Brightness min', 0, 1, 0.01],
    ['findLock', 'Detections to lock', 1, 10, 1],
    ['findAssumeW', 'Assumed width (m)', 0.2, 2, 0.01],
  ]],
  ['Masking', [
    ['occlusionOn', 'Depth mask'],
    ['mlMask', 'ML person cutout'],
    ['segModel', 'Model', ['deeplab', 'selfie', 'multiclass']],
    ['debugView', 'Debug overlay', ['off', 'mask', 'depth']],
    ['camFlipY', 'Flip camera image'],
    ['segFps', 'Model runs per s', 2, 30, 1],
    ['segWidth', 'Model input width', 96, 320, 16],
    ['maskThreshold', 'Mask threshold', 0.1, 0.9, 0.01],
    ['maskFeather', 'Soft edge', 0, 0.4, 0.01],
    ['maskDilate', 'Grow mask (samples)', 0, 4, 1],
    ['maskDepthAgree', 'Cutout needs depth too'],
    ['occlusionBias', 'Depth mask bias', 0, 0.2, 0.005],
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
