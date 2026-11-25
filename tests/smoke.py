"""Headless smoke test on the 3D preview (simulated depth). Needs: pip install playwright, a Chrome.

Run from the project folder:
  python3 -m http.server 8777 &
  python3 tests/smoke.py [chrome path]

Checks: no page errors, surfaces get found and collect snow, zero knock-offs while the camera sweeps
an empty room (false alarms), knock-offs once the simulated people walk, and the work time per frame.
Screenshots go to tests/out/.
"""
import asyncio, json, math, os, sys
from playwright.async_api import async_playwright

URL = 'http://localhost:8777/?phone'
OUT = os.path.join(os.path.dirname(__file__), 'out')
CHROME = sys.argv[1] if len(sys.argv) > 1 else '/usr/bin/google-chrome'


async def main():
    os.makedirs(OUT, exist_ok=True)
    fails = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 390, 'height': 780}, device_scale_factor=2, is_mobile=True, has_touch=True)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{OUT}/1_landing.png')
        await pg.evaluate("document.getElementById('startAR').click()")
        await pg.evaluate("__bsar.sim.peopleOn=false; __bsar.placeLogoAt(-0.5,0,0.9)")
        for i in range(40):
            await pg.evaluate(f"__bsar.look.yaw={math.sin(i / 40 * 6.28) * 0.6}; __bsar.look.pitch=-0.5")
            await pg.wait_for_timeout(150)
        false_knocks = await pg.evaluate("__bsar.stats.knocks")
        await pg.evaluate("__bsar.sim.peopleOn=true; __bsar.look.yaw=0.25; __bsar.look.pitch=-0.45")
        await pg.wait_for_timeout(12000)
        await pg.screenshot(path=f'{OUT}/2_people.png')
        s = json.loads(await pg.evaluate("JSON.stringify({area:__bsar.liveArea(), vol:__bsar.snowVolume(), work:__bsar.stats.work, knocks:__bsar.stats.knocks, logo:__bsar.logoWorld.levels.length})"))
        await b.close()
    print('false knocks (empty room sweep):', false_knocks)
    print('stats:', s)
    if errors: fails.append('page errors: ' + '; '.join(errors[:3]))
    if false_knocks > 0: fails.append(f'{false_knocks} false knock-offs')
    if s['area'] < 5: fails.append('too little surface found')
    if s['vol'] <= 0: fails.append('no snow accumulated')
    if s['knocks'] < 20: fails.append('people did not knock snow off')
    if s['logo'] < 50: fails.append('logo has no snow levels')
    print('FAIL: ' + ' | '.join(fails) if fails else 'PASS')
    sys.exit(1 if fails else 0)

asyncio.run(main())
