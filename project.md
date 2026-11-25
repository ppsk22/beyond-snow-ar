---
project: BEYOND THE BUZZ AR snow
status: prototype v0.3.1
deadline: 2026-12-07
tags: [beyond-global, christmas-2026, webxr, ar]
---

# BEYOND THE BUZZ: AR snow

## Scope
- Phone web app opened by a QR code on the desktop page (part of the BEYOND THE BUZZ demo)
- Android Chrome: room AR with ARCore depth. Snow falls all the time, settles on real surfaces as the phone discovers them, real people and moving things knock it loose
- Placeable 3D logo with snow caps that also get knocked off
- Look: CI colors, cel shaded (BotW-like), illustrated outline on top, soft toon bands
- iPhone and desktop: 3D preview room with simulated people
- 2D start screen snow in site style hands over into the room
- Not in scope: snow on people

## Roadmap
1. [x] v0.1: full pipeline in the preview (depth, surfaces, movement detection, snow, knock-off, logo, look)
2. [x] First device test on the Xiaomi 15 (USB, adb reverse): janky square spawning, snow over people, wrong spots, knock-off off
3. [x] v0.2: strict certified surfaces, organic patches with smooth contours, depth mask fixed, ML person cutout (experimental)
4. [ ] Second device test: compare depth mask vs ML cutout, tune certification
5. [x] v0.3: dramatic knock-off, screen show (neon frame detection, burst and drops of E / O / word pills, physics, pills break into letters), simple 3D page, config field, floor-first surface confirmation (dev), flat 2D cut-out objects
6. [ ] Device test of the screen show: detection on a real monitor, object sizes, mix
7. [ ] Tune thresholds on real depth, set defaults from the panel JSON
8. [ ] Real CI logo and neon hex
9. [ ] Hosting (GitHub Pages) and hook into the demo page (QR placement, wording, neon frame on the live page)
10. [ ] Final test on 2 or 3 other Android phones plus iPhone preview

## Progress
- 2026-11-24: v0.1.0 built. Preview smoke test passes: 0 false knock-offs while sweeping an empty room, people knock snow off, snow accumulates, logo has snow caps. Work time about 12 ms per frame in software rendering

- 2026-11-25: first phone test over USB. Feedback: snow spawned as squares, snow drawn over people, snow on wrong spots, knock-off felt off. Cause of "snow over people": the depth mask shader never compiled and had depth writes disabled (both fixed)
- 2026-11-25: v0.2.0. Strict certification, organic patches, contour rendering, soft knock-off holes, ML person cutout (MediaPipe in a worker, camera-access), debug overlays. Preview smoke test passes

- 2026-11-25: v0.3.0. More dramatic knock-off. Screen show: desktop page gets a neon frame, phone finds it (camera image + depth), then snow, logo E / O / 0 and buzzword pills come out of the screen, land and tip over, pills break into letters when walked through or tapped. Simple scrollable 3D page with throwable pills. Config field in the panel. Floor-first surface confirmation as a dev option (neon square, tap to confirm, long press to remove; confirmed floor is flat and endless). Show objects as thin 2D cut-outs. Preview smoke test covers the screen lock

- 2026-11-25: phone test of v0.3 (GitHub Pages): snow still shard-like, too much flying snow, person interaction weak (ML was off), screen finding failed, options not reachable (QR dropped ?dev). v0.3.1: flat plate look with minimum area (or detail look), calmer kick-up with a pushed-aside ring, thicker neon frame, more tolerant detection, 2-tap fallback, QR keeps ?dev

## To-dos
- [ ] Decide hosting: GitHub Pages (ppsk22) or a WordPress subfolder with HTTPS
- [x] First device run (USB)
- [ ] Press "Defaults" in the panel once (old saved values override new defaults)
- [ ] Check depth mask with Debug overlay "depth": does it line up with the room?
- [ ] Switch on ML person cutout: note the dev pill (mask state, model, ms), check overlay "mask", try deeplab vs selfie
- [ ] Report how long snow takes to appear with the strict check, and whether wrong spots are gone
- [ ] Screen show on the real monitor: does it lock (dev pill `screen ...`)? Size right? If not, try the 2-tap fallback
- [ ] Compare snow Look plates vs detail; turn on ML person cutout and walk through
- [ ] Tune the mix, sizes and speeds in the panel, send the config JSON
- [ ] Decide: keep the 3D page or drop it
- [ ] Test floor confirmation: how fast does the square appear, does the tap hit it, does long press remove it
- [ ] Decide: confirmation as the normal flow for visitors, or dev only (auto floor instead?)
- [ ] Decide: should the neon frame be on the live campaign page too (needed for the screen show from the real site)
- [ ] Check whether snow lines up with the real floor (depth assumption, see README caveats)
- [ ] Walk through snow with a second person, tune "Points needed" and "Min height above snow"
- [ ] Send the logo SVG (filled paths) and the exact neon green
- [ ] Try the QR flow from the Xiaomi scanner app (webview) and from Chrome's own scanner
- [ ] Decide: is the preview the iPhone fallback, or should iPhones get a simpler snow camera filter

## Nice-to-haves
- [x] Snow falling out of the desktop monitor (v0.3, neon frame detection)
- [ ] Snow caps on landed objects
- [ ] The desktop page reacts when a phone connects (needs a small server or a shared channel)
- [ ] Light estimation for the toon light direction
- [ ] Footprint shapes instead of round holes
- [ ] Snowball throw on tap
- [ ] Sound (soft crunch when snow gets knocked)
- [ ] Share a screenshot or short clip from the AR view
