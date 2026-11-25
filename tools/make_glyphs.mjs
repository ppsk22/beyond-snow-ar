// Builds assets/glyphs.json: outline path data per character (Reddit Sans Black, font size 100,
// baseline at y = 0, SVG y down) plus advance widths. Used for 3D letters and pill labels.
import opentype from 'opentype.js';
import fs from 'node:fs';
const buf = fs.readFileSync('node_modules/@fontsource/reddit-sans/files/reddit-sans-latin-900-normal.woff');
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'!?&.,:";
const out = { size: 100, ascent: 0, glyphs: {} };
for (const ch of chars) {
  const g = font.charToGlyph(ch);
  const p = g.getPath(0, 0, 100);
  out.glyphs[ch] = { d: p.toPathData(1), adv: +(g.advanceWidth * 100 / font.unitsPerEm).toFixed(1) };
}
out.glyphs[' '] = { d: '', adv: +(font.charToGlyph(' ').advanceWidth * 100 / font.unitsPerEm).toFixed(1) };
const capH = font.charToGlyph('H').getBoundingBox();
out.capHeight = +(capH.y2 * 100 / font.unitsPerEm).toFixed(1);
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log('glyphs', Object.keys(out.glyphs).length, 'capHeight', out.capHeight);
