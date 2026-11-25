// 2D snow on the start screen, styled like the site snow: flakes fall, settle on elements marked with
// data-snowcap, and can be knocked off by touch. On "Start AR" the flake positions are handed to 3D.

export function createSnow2D(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const col = { snow: '#ffffff', shade: '#cfd8e6', line: '#0b0b0b', ...opts.colors };
  let W = 0, H = 0, dpr = 1;
  const flakes = [];
  const bits = [];
  let caps = [];
  let running = true;
  let last = performance.now();

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const want = Math.round(Math.min(220, (W * H) / 4200));
    while (flakes.length < want) flakes.push(newFlake(true));
    flakes.length = want;
    scanCaps();
  }

  function newFlake(anywhere) {
    const r = 1.6 + Math.random() * 3.2;
    return { x: Math.random() * W, y: anywhere ? Math.random() * H : -10, r, v: 22 + r * 9 + Math.random() * 14, ph: Math.random() * 10 };
  }

  function scanCaps() {
    const old = new Map(caps.map((c) => [c.el, c]));
    caps = [];
    for (const el of document.querySelectorAll('[data-snowcap]')) {
      if (!el.offsetParent) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 4) continue;
      const n = Math.max(2, Math.round(b.width / 3));
      const prev = old.get(el);
      const h = prev && prev.h.length === n ? prev.h : new Float32Array(n).fill(parseFloat(el.dataset.snowcap) || 6);
      caps.push({ el, x: b.left, y: b.top, w: b.width, h, max: (parseFloat(el.dataset.snowcap) || 6) * 1.6, radius: Math.min(b.height / 2, 999) });
    }
  }

  function capAt(x, y) {
    for (const c of caps) {
      if (x < c.x || x > c.x + c.w) continue;
      const i = Math.min(c.h.length - 1, Math.floor(((x - c.x) / c.w) * c.h.length));
      const top = c.y - c.h[i];
      if (y >= top - 1 && y <= c.y + 4) return { c, i };
    }
    return null;
  }

  function knock(x, y, rad) {
    for (const c of caps) {
      if (x < c.x - rad || x > c.x + c.w + rad || y < c.y - 40 || y > c.y + 30) continue;
      for (let i = 0; i < c.h.length; i++) {
        const cx = c.x + ((i + 0.5) / c.h.length) * c.w;
        if (Math.abs(cx - x) > rad || c.h[i] < 0.5) continue;
        const n = Math.ceil(c.h[i] / 3);
        for (let k = 0; k < n && bits.length < 600; k++) {
          bits.push({ x: cx, y: c.y - Math.random() * c.h[i], vx: (cx - x) * 3 + (Math.random() - 0.5) * 80, vy: -60 - Math.random() * 120, r: 1.4 + Math.random() * 2, life: 3 });
        }
        c.h[i] = 0;
      }
    }
  }

  function step(dt, t) {
    for (const f of flakes) {
      const yPrev = f.y;
      f.y += f.v * dt;
      f.x += Math.sin(t * 0.9 + f.ph) * 14 * dt;
      const hit = capAt(f.x, f.y);
      if (hit && yPrev < f.y) {
        const { c, i } = hit;
        for (let k = -2; k <= 2; k++) {
          const j = i + k;
          if (j >= 0 && j < c.h.length && c.h[j] < c.max) c.h[j] += f.r * (k === 0 ? 0.45 : 0.15);
        }
        Object.assign(f, newFlake(false));
        continue;
      }
      if (f.y > H + 10) Object.assign(f, newFlake(false));
      if (f.x < -10) f.x += W + 20; else if (f.x > W + 10) f.x -= W + 20;
    }
    for (let k = bits.length - 1; k >= 0; k--) {
      const b = bits[k];
      b.vy += 900 * dt; b.vx *= Math.exp(-1.5 * dt);
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life < 0 || b.y > H + 10) bits.splice(k, 1);
    }
    // Keep caps smooth.
    for (const c of caps) {
      const h = c.h;
      for (let i = 1; i < h.length - 1; i++) h[i] += ((h[i - 1] + h[i + 1]) * 0.5 - h[i]) * 0.05;
    }
  }

  function drawFlake(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = col.snow;
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, r * 0.35);
    ctx.strokeStyle = col.line;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const c of caps) {
      const n = c.h.length, dx = c.w / n;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y + 1);
      for (let i = 0; i < n; i++) {
        const edge = Math.min(1, Math.min(i, n - 1 - i) / 3);
        ctx.lineTo(c.x + (i + 0.5) * dx, c.y - c.h[i] * (0.4 + 0.6 * edge));
      }
      ctx.lineTo(c.x + c.w, c.y + 1);
      ctx.closePath();
      ctx.fillStyle = col.snow;
      ctx.fill();
      // Illustrated outline on the top only.
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const edge = Math.min(1, Math.min(i, n - 1 - i) / 3);
        const px = c.x + (i + 0.5) * dx, py = c.y - c.h[i] * (0.4 + 0.6 * edge);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = col.line;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    for (const f of flakes) drawFlake(f.x, f.y, f.r);
    for (const b of bits) drawFlake(b.x, b.y, b.r);
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    step(dt, t / 1000);
    draw();
    requestAnimationFrame(loop);
  }

  let pointerDown = false;
  window.addEventListener('pointerdown', (e) => { pointerDown = true; knock(e.clientX, e.clientY, 26); });
  window.addEventListener('pointermove', (e) => { if (pointerDown) knock(e.clientX, e.clientY, 18); });
  window.addEventListener('pointerup', () => { pointerDown = false; });
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', scanCaps, { passive: true });

  resize();
  // Layout moves (fonts load, text changes, sections toggle): keep cap positions in sync.
  setInterval(() => { if (running) scanCaps(); }, 400);
  // Pre-warm so the screen is already snowing (and caps exist) on first paint.
  for (let i = 0; i < 120; i++) step(1 / 30, i / 30);
  requestAnimationFrame((t) => { last = t; loop(t); });

  return {
    getFlakes() { return flakes.map((f) => ({ x: f.x, y: f.y, r: f.r })).concat(bits.map((b) => ({ x: b.x, y: b.y, r: b.r }))); },
    stop() { running = false; ctx.clearRect(0, 0, W, H); canvas.style.display = 'none'; },
    start() { if (running) return; running = true; canvas.style.display = ''; resize(); last = performance.now(); requestAnimationFrame(loop); },
    rescan: scanCaps,
  };
}
