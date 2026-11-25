# BEYOND THE BUZZ: Let it snow (AR)

Phone web app: scan the QR code on the desktop page, tap **Start AR**, and it snows in the room.
Snow settles on real floors, tables and shelves (found through ARCore depth), and real people or
things moving through it knock it loose. A placed 3D logo has snow caps that get knocked off too.
Cel-shaded in CI colors. iPhones and desktops get a 3D preview room with simulated people.

## Map

**Files you work with (short, tunable)**

| File | What it is |
|---|---|
| `js/config.js` | Every tunable value (colors, snow, physics, thresholds) plus the dev panel layout |
| `assets/logo.svg` | The logo that gets extruded. Placeholder; swap in the real CI logo (filled paths) |
| `index.html`, `css/style.css` | Start screens (desktop QR, phone button) and the AR overlay |
| `project.md` | Obsidian project note: scope, roadmap, progress, to-dos |

**Code (you only open this to change behavior)**

| File | What it does |
|---|---|
| `js/main.js` | Boot, desktop/phone detection, AR session, preview mode, main loop, performance guard |
| `js/depthframe.js` | Depth samples to world points and normals (same format for AR and preview) |
| `js/world.js` | Surface levels per 5 cm column with snow heights; occupancy voxels that detect movement |
| `js/blanket.js` | Turns the snow heights into one continuous mesh (rounded caps at edges, lumps) |
| `js/particles.js` | Falling flakes (always on) and knocked-off chunks |
| `js/look.js` | Toon shader with top outline, flake sprites, inverted hull outlines |
| `js/logo.js` | SVG to extruded 3D logo, bakes snow onto its tops |
| `js/occlusion.js` | Writes real depth into the z-buffer so real people hide the snow behind them |
| `js/sim.js` | Preview room: furniture, walking people, simulated depth with noise |
| `js/snow2d.js` | 2D snow on the start screen (site style); its flakes hand over into the 3D room |
| `js/tuner.js` | Dev panel |

**Reference only:** `tests/smoke.py` (headless test), `tools/make_logo_svg.mjs` (rebuilds the
placeholder logo), `js/vendor/` (three.js r187, qrcode-generator, untouched copies).

## Run and host

- Local: `python3 -m http.server 8777` in this folder, open `http://localhost:8777/?desk` or `?phone`.
- WebXR needs HTTPS, so the phone test needs real hosting. GitHub Pages works as is (static files, `.nojekyll` included).
- `?dev` opens the tuning panel. On the phone: long press the status pill. "Copy JSON" copies the current values; send them to me and they become the defaults.
- Test: `python3 tests/smoke.py` (needs Playwright and Chrome, server running).

## How it works (short)

1. Each frame ARCore depth is sampled on a grid (64 across) and turned into world points with normals.
2. Points with an upward normal feed **surface levels**: one per 5 cm column and height, so the floor under a table and the table top are separate. A level needs a few confirmations before it collects snow, and loses confidence when the camera sees through it.
3. **Movement detection:** 10 cm voxels remember when they were seen empty. A voxel that was clearly empty and is now hit in consecutive frames is dynamic. Dynamic points 6 to 45 cm above a snowy level knock its snow off (with a 2-cell radius), flying in the direction the intrusion moved.
4. Snow grows on its own (invisible snowfall) plus from every visible flake that lands. Covered levels (under a table) get only 8 percent.
5. Falling flakes collide with the real depth in view and with known levels out of view.

## Expected bugs and caveats

- **The AR path is untested on a real phone.** Everything is tested in the preview with simulated depth; the WebXR parts (depth readout, hit test, DOM overlay, occlusion pass) are written to the spec, but the first run on the Xiaomi 15 is the real test. The dev pill shows `depth ... fast/slow`, which tells which readout path was chosen.
- **Depth readout:** a fast raw-buffer path is checked against `getDepthInMeters()` on the first 20 frames and only used if it matches; otherwise it stays on the slow path (about 9000 native calls per frame).
- **Assumption:** depth values are distances along the camera axis. If Chrome delivers distances along the ray instead, surfaces near the screen edges would bend slightly. Visible as a floor that curves at the edges.
- **QR scanner apps and in-app browsers** (Xiaomi scanner, LinkedIn, Instagram) open a webview without WebXR. Android then shows "Open in Chrome for room AR". The Mi Browser probably has no WebXR either.
- **iPhones:** no WebXR in Safari, so preview only.
- **Depth lags fast motion.** Knock-off pauses while the phone turns faster than 1.6 rad/s, moves faster than 1.2 m/s, or tracking jumps (1 s hold). Very slow movers can still knock snow; very fast camera swings will not.
- **Depth struggles with** glass, mirrors, glossy black floors, plain white walls and dim rooms. Snow may not appear there or may float a bit.
- **False knock-offs** near furniture edges were 0 in the preview sweep test, but ARCore's real edges are softer. If snow vanishes by itself near furniture, raise "Points needed" or "Min height above snow" in the panel.
- **Drift:** snow stays where it was found. If ARCore drifts or relocalizes, snow can sit a few cm off. Reset clears it.
- **Snow on people:** intentionally none. Flakes that hit a person melt.
- **Start transition:** flakes continue at their screen positions, but Chrome shows its camera startup in between (about a second), so it is a handover, not a seamless cut.
- **Heat and battery:** camera plus depth plus simulation runs hot. The performance guard watches the work time per frame (not fps, because ARCore often runs at 30 fps) and thins out the flakes in 3 steps.
- **Big rooms:** the snow mesh is rebuilt in 1 m tiles within a budget per frame, so far changes can lag a few frames.
- **Placeholder assets:** the logo is Reddit Sans Black outlines, not the real CI logo; the neon green hex is a guess (`colNeon` in config.js). Euclid Circular B is only used if it is installed on the device.
- **Preview noise is white noise;** real ARCore noise is smoother but laggier, so thresholds will need tuning on the device.
