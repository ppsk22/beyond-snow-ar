// Builds a placeholder logo SVG (outlined text) from Reddit Sans Black.
// Replace assets/logo.svg with the real CI logo later; the app extrudes any filled SVG paths.
import opentype from 'opentype.js';
import fs from 'node:fs';

const fontPath = 'node_modules/@fontsource/reddit-sans/files/reddit-sans-latin-900-normal.woff';
const buf = fs.readFileSync(fontPath);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const lines = (process.argv[2] || 'BEYOND|THE BUZZ').split('|');
const size = 100;
const lineGap = 1.18;
const paths = [];
let maxW = 0;
lines.forEach((text, i) => {
  const w = font.getAdvanceWidth(text, size);
  maxW = Math.max(maxW, w);
  paths.push({ text, w, y: (i + 1) * size * lineGap * 0.86 });
});
let out = '';
for (const p of paths) {
  const x = (maxW - p.w) / 2;
  const path = font.getPath(p.text, x, p.y, size);
  out += `  <path d="${path.toPathData(2)}"/>\n`;
}
const h = Math.ceil(lines.length * size * lineGap * 0.86 + size * 0.1);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(maxW)} ${h}" fill="#000">\n${out}</svg>\n`;
fs.writeFileSync(process.argv[3] || 'logo.svg', svg);
console.log('written', Math.ceil(maxW), h);
