# BEYOND THE BUZZ: Let it snow (AR)

Phone web app: scan the QR code on the desktop page, tap **Start AR**, point the phone back at the screen (it finds it by the neon frame), and snow, logo shapes and buzzword pills come out of the screen into the room.
Snow settles on real floors, tables and shelves (found through ARCore depth), and real people or
things moving through it knock it loose. A placed 3D logo has snow caps that get knocked off too.
Cel-shaded in CI colors. iPhones and desktops get a 3D preview room with simulated people.

Version 0.3.0.

## Map

**Files you work with (short, tunable)**

| File | What it is |
|---|---|
| `js/config.js` | Every tunable value (colors, snow, physics, thresholds) plus the dev panel layout |
| `assets/logo.svg` | The logo that gets extruded. Placeholder; swap in the real CI logo (filled paths) |
| `index.html`, `css/style.css` | Start screens (desktop QR with neon frame, phone button) and the AR overlay |
| `js/shapes.js` | The 15 buzzwords (`WORDS`, same as the voting page) and the shape builders |
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
| `js/occlusion.js` | Depth mask (real depth into the z-buffer), ML person cutout, debug overlays |
| `js/segmenter.js` | Person mask: grabs the AR camera image and sends it to the worker (or takes the preview's mask) |
| `js/segworker.js` | Runs the MediaPipe person segmentation model off the main thread |
| `js/sim.js` | Preview room: furniture, walking people, simulated depth, camera feed and person mask (same passes as AR) |
| `js/snow2d.js` | 2D snow on the start screen (site style); its flakes hand over into the 3D room |
| `js/tuner.js` | Dev panel with the config field (copy, paste, apply) |
| `js/screen.js` | Finds the desktop screen: neon frame in the camera image, plane from depth, locked pose |
| `js/show.js` | The screen show: burst out of the screen, drops over the top edge, pills breaking into letters |
| `js/physics.js` | Rigid bodies (cannon-es); colliders from certified surfaces; people shove objects |
| `js/panel.js` | The scrollable 3D page in front of the screen |
| `js/surfaces.js` | Dev: floor-first surface confirmation (neon squares, tap to confirm, long press to remove) |

**Reference only:** `tests/smoke.py` (headless test), `tools/make_logo_svg.mjs` (rebuilds the
placeholder logo), `tools/make_glyphs.mjs` (rebuilds `assets/glyphs.json`, the letter outlines), `js/vendor/` (three.js r187, qrcode-generator, MediaPipe tasks-vision 1.2.3, cannon-es 0.20, untouched copies).
Optional: `assets/models/` for local copies of the segmentation models (otherwise they download from Google on first use).

## Run and host

- Local: `python3 -m http.server 8777` in this folder, open `http://localhost:8777/?desk` or `?phone`.
- WebXR needs HTTPS, so the phone test needs real hosting. GitHub Pages works as is (static files, `.nojekyll` included).
- `?dev` opens the tuning panel. On the phone: long press the status pill. "Copy JSON" copies the current values; send them to me and they become the defaults.
- Test: `python3 tests/smoke.py` (needs Playwright and Chrome, server running).

## How it works (short)

1. Each frame ARCore depth is sampled on a grid (64 across) and turned into world points with normals.
2. Points with an upward normal feed **surface levels**: one per 5 cm column and height, so the floor under a table and the table top are separate. Points on people (ML mask) or in moving voxels never count.
3. **Certification (strict):** a level only gets snow once it has high confidence, has been seen for 2 s, from 2 phone positions at least 12 cm apart, with less than 2.5 cm jitter, inside a flat patch (13 of its 24 neighbors at the same height), and nothing moved there for 3 s. It loses certification (snow drops) when the camera keeps seeing through it.
4. **Organic patches:** after certification a "wetness" value rises; each spot has a noise threshold and snow starts sticking where wetness passes it, so patches appear, grow and merge. Flakes that land add snow directly. The blanket is cut along smooth contours (marching squares), with a little falloff past the edge.
5. **Movement detection:** 10 cm voxels remember when they were seen empty. A voxel that was clearly empty and is now hit in consecutive frames is dynamic; person-mask samples are always dynamic. Dynamic points 6 to 45 cm above snow knock it off, with a soft-edged hole, flying in the direction of the movement.
6. **Masking:** the depth mask writes real depth into the z-buffer first. The optional ML cutout runs MediaPipe person segmentation on the camera image (12 per second, in a worker) and paints the real camera pixels of people back over the snow with a soft edge, at the person's depth.

## The screen show (v0.3)

1. The desktop page has a thick neon frame. On the phone, after Start AR, the status says "Point your phone at the screen with the neon frame".
2. Five times a second the camera image is checked for the frame; its corners plus the depth on the screen give the screen's position and size. After 3 consistent hits it locks (the dev pill shows `screen locked 0.62 x 0.35 m`).
3. Then: an opening burst out of the screen, after that a steady drop over the top edge (sometimes out of the screen again). Half of the snow now comes from the screen.
4. Objects land on certified surfaces (desk, floor) and tip over. People shove them; walking through a buzzword pill (or tapping it) breaks it into its letters.
5. **Page** button: a scrollable copy of the campaign page floats in front of the screen. Swipe up and down to scroll; tap a buzzword on it to throw that pill into the room.
6. **No screen? Skip** goes straight to room snow.

## Confirming surfaces (dev, on by default)

- The floor is the main objective: the lowest big flat region at least 0.7 m below the phone. As soon as there is about 0.6 m2 of it, a pulsing **neon square** appears on it and the status says "Tap the neon square to confirm the floor".
- **Tap** the square: the floor is confirmed. From then on it counts as perfectly flat and endless at that height: every floor cell the phone sees gets snow right away (no 2 s / 2 viewpoints / flat patch wait) and is never forgotten. Objects from the screen land on it.
- Other big flat regions (tables, desks, at least 0.2 m2) get a neon frame too; tap to confirm them the same way (they stay limited to their rectangle).
- **Long press** (0.6 s) on a confirmed surface removes it; its cells fall back to the normal strict rules.
- A thin white frame marks confirmed surfaces ("Show confirmed frames").
- Panel section "Confirm surfaces (dev)": turn the squares off, "Snow only on confirmed" (strict auto snow off, so only what you confirmed gets snow), or "Confirm floor by itself" when it is very sure (3 m2, steady 4 s).

## Dev panel quick guide (`?dev`, or long press the status pill)

- **Masking > ML person cutout:** on/off. **Model:** deeplab (whole bodies, slower), selfie (fast, best for close people), multiclass.
- **Masking > Debug overlay:** `mask` tints what the model sees as person in neon, `depth` shows the depth map (warm = near, red = no depth). Use these to check alignment. If the mask or cutout is upside down, tick **Flip camera image**.
- **Surfaces:** the certification thresholds. If snow takes too long to appear, lower "Steady for" or "Flat patch"; if it appears on wrong spots, raise them.
- **Config field** at the top of the panel: always shows the current settings as JSON. Copy sends it to the clipboard (send it to me); paste one in and press Apply pasted to load it.
- **Screen show / Objects / Page panel / Screen detection:** everything about the show. If the frame is not found, check the dev pill line `screen ...`, then widen the hue window or lower Saturation min / Brightness min.
- The dev pill shows `mask <state> <model> <ms>`: `ready GPU deeplab_v3.tflite 35ms` is good; `error ...` tells why it failed.

## Expected bugs and caveats

- **Screen show untested on a phone.** In the preview room the finder locks onto the monitor within millimetres of the true size, and the whole show runs. On a real phone the neon on a real monitor looks different through the camera (exposure, moire, glare); the thresholds are in "Screen detection".
- **Screen detection needs camera-access.** If Chrome does not grant it, the pill says "no camera image"; use Skip.
- **Screens without depth** (glossy, or too far): the finder then assumes an upright screen 0.6 m wide ("Assumed width"), which gets the distance wrong for other sizes.
- **Phone rotated more than about 30 degrees** against the screen confuses the corner order; hold it roughly level.
- **The frame must be fully in view** and unbroken; a browser window that is not fullscreen still works as long as the whole frame shows.
- **Colliders are boxes over each flat region** (bounding rectangle), so on an L-shaped desk objects can rest on air at the inner corner. Before a floor is certified, a floor plane 1.35 m below the phone is used.
- **Objects do not collect snow** and are not hidden by people via the ML cutout (only by the depth mask).
- **Letters use Reddit Sans Black** (placeholder, like the logo); the word pills are drawn with the system font on the phone.
- **Confirmed floor is one height everywhere.** If the floor really slopes, or tracking drifts, snow far away can float or sink a little. Long press and confirm again to re-measure.
- **Candidate squares only show where the phone has looked;** a floor seen only at a flat angle (far away) may take a while.
- **Long press in AR** is measured between Chrome's selectstart and select; if long presses are not recognised on the phone, tell me.
- **Show objects are flat cut-outs** (6 mm, "Thickness"): seen exactly edge-on they become thin lines; that is the 2D look. Their colliders are a little thicker (8 mm) so they do not fall through surfaces.
- **Dramatic knock-off** (v0.3 defaults): radius 3 cells, full holes, one moving point is enough, up to 1 m above the snow. If snow now vanishes without anyone walking, raise "Points needed" back to 2.

- **v0.1 had no working depth mask on the phone.** Two shader bugs (a matrix used in the wrong stage, and depth writes disabled together with the depth test). Both fixed in v0.2 and verified in the preview, where occlusion now uses the same depth pass as AR.
- **The ML cutout is untested on a real phone.** The model files cannot be downloaded in my workspace; the worker, the WebAssembly runtime and the whole compositing path are tested with a perfect fake mask from the preview room. Unknowns: speed on the Xiaomi, mask quality at room distances, whether the camera image comes in upside down (then tick Flip camera image).
- **Camera access** is requested as an optional feature on every AR start (so the ML cutout can be switched on mid-session). If Chrome asks for an extra permission or the AR start gets slower, tell me and I make it opt-in.
- **Mask lag:** the model runs about 12 times per second, so on fast legs the mask trails. "Cutout needs depth too" hides most of the lag ghosting; switch it off to compare.
- **Depth-only mask edges** are blocky and a bit dark-haloed (ARCore depth is about 160x90). The ML cutout gives soft edges.
- **First ML start downloads** about 15 MB (runtime) plus the model (deeplab about 2.7 MB) from Google. Put the .tflite files in `assets/models/` to serve them yourself.
- **Strict surfaces mean slower snow:** expect 3 to 6 seconds after you look at a surface (and move the phone a bit) before the first patches appear. Small things (narrow shelves, chair seats, table corners) may never get snow; that is the price of no snow in wrong spots.
- **Preview:** the camera sways slightly on its own (a still camera would never give the second viewpoint).
- **Depth readout:** a fast raw-buffer path is checked against `getDepthInMeters()` on the first 20 frames and only used if it matches.
- **Assumption:** depth values are distances along the camera axis. If a floor looks curved at the screen edges, this is the reason.
- **QR scanner apps and in-app browsers** open a webview without WebXR. Android then shows "Open in Chrome for room AR".
- **iPhones:** no WebXR in Safari, preview only.
- **Depth lags fast motion.** Knock-off pauses while the phone turns faster than 1.6 rad/s, moves faster than 1.2 m/s, or tracking jumps.
- **Depth struggles with** glass, mirrors, glossy black floors, plain white walls and dim rooms.
- **Drift:** snow stays where it was found. If ARCore drifts or relocalizes, snow can sit a few cm off. Reset clears it.
- **Snow on people:** intentionally none. Flakes that hit a person melt.
- **Heat and battery:** camera plus depth plus simulation (plus the model) runs hot. The performance guard thins out flakes in 3 steps; the model rate is fixed (lower "Model runs per s" if it gets hot).
- **Placeholder assets:** the logo is Reddit Sans Black outlines; the neon green hex is a guess (`colNeon`).
- **Saved panel values** from v0.1 (if you pressed Save) stay in the browser and override new defaults. Press "Defaults" once in the panel.
