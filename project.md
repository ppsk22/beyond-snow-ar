---
project: BEYOND THE BUZZ AR snow
status: prototype v0.1.0
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
2. [ ] First device test on the Xiaomi 15 (Chrome, HTTPS hosting)
3. [ ] Tune thresholds on real depth, set defaults from the panel JSON
4. [ ] Real CI logo and neon hex
5. [ ] Hook into the demo page (QR placement, wording)
6. [ ] Final test on 2 or 3 other Android phones plus iPhone preview

## Progress
- 2026-11-24: v0.1.0 built. Preview smoke test passes: 0 false knock-offs while sweeping an empty room, people knock snow off, snow accumulates, logo has snow caps. Work time about 12 ms per frame in software rendering

## To-dos
- [ ] Decide hosting: GitHub Pages (ppsk22) or a WordPress subfolder with HTTPS
- [ ] First device run: check the dev pill (depth path fast/slow, work ms, quality step)
- [ ] Check whether snow lines up with the real floor (depth assumption, see README caveats)
- [ ] Walk through snow with a second person, tune "Points needed" and "Min height above snow"
- [ ] Send the logo SVG (filled paths) and the exact neon green
- [ ] Try the QR flow from the Xiaomi scanner app (webview) and from Chrome's own scanner
- [ ] Decide: is the preview the iPhone fallback, or should iPhones get a simpler snow camera filter

## Nice-to-haves
- [ ] Snow falling out of the desktop monitor (needs the monitor located, image tracking of the desktop page)
- [ ] Light estimation for the toon light direction
- [ ] Footprint shapes instead of round holes
- [ ] Snowball throw on tap
- [ ] Sound (soft crunch when snow gets knocked)
- [ ] Share a screenshot or short clip from the AR view
