// Dev panel (open with ?dev or a long press on the status pill). Edits P live, copies it as JSON.

import { P, SCHEMA, DEFAULTS, save } from './config.js';

export function createTuner(root, onChange) {
  root.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'tuner-head';
  head.innerHTML = '<b>Tuning</b>';
  const btns = document.createElement('div');
  for (const [label, fn] of [
    ['Copy JSON', () => copy(JSON.stringify(P, null, 2))],
    ['Save', () => save()],
    ['Defaults', () => { Object.assign(P, JSON.parse(JSON.stringify(DEFAULTS))); save(); build(); onChange('*'); }],
    ['Close', () => { root.hidden = true; }],
  ]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    b.addEventListener('beforexrselect', (e) => e.preventDefault());
    btns.appendChild(b);
  }
  head.appendChild(btns);
  root.appendChild(head);
  const body = document.createElement('div');
  body.className = 'tuner-body';
  root.appendChild(body);
  root.addEventListener('beforexrselect', (e) => e.preventDefault());

  function build() {
    body.innerHTML = '';
    for (const [title, items] of SCHEMA) {
      const sec = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = title;
      sec.appendChild(sum);
      for (const it of items) {
        const [key, label, min, max, step] = it;
        const row = document.createElement('label');
        row.className = 'tuner-row';
        const name = document.createElement('span');
        name.textContent = label;
        row.appendChild(name);
        const val = document.createElement('output');
        let input;
        if (typeof P[key] === 'boolean') {
          input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = P[key];
          input.addEventListener('change', () => { P[key] = input.checked; onChange(key); });
        } else if (typeof P[key] === 'string') {
          input = document.createElement('input');
          input.type = 'color';
          input.value = P[key];
          input.addEventListener('input', () => { P[key] = input.value; onChange(key); });
        } else {
          input = document.createElement('input');
          input.type = 'range';
          input.min = min; input.max = max; input.step = step;
          input.value = P[key];
          val.textContent = fmt(P[key]);
          input.addEventListener('input', () => { P[key] = parseFloat(input.value); val.textContent = fmt(P[key]); onChange(key); });
        }
        row.appendChild(input);
        row.appendChild(val);
        sec.appendChild(row);
      }
      body.appendChild(sec);
    }
  }
  build();
  return { rebuild: build };
}

function fmt(v) {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}

function copy(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => fallback(text));
  else fallback(text);
}

function fallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* ignore */ }
  ta.remove();
}
