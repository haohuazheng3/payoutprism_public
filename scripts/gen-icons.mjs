// Generates every raster icon from the logo mark (one source of truth: src/components/Logo.tsx).
// Usage: node scripts/gen-icons.mjs   (npm run icons)
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = (p) => path.join(root, "public", p);

const INK = "#0F1412";
const PAPER = "#F2F3F0";
const KEEP = "#0D8A5D";
const PAY = "#E8A13A";
const FEE = "#EC5A3C";

// Same geometry as <Mark/> on the 32 grid. The tile version is the prism alone (bold, legible at 16 px);
// the spectrum rays appear on the large tiles only.
const PRISM = "M12.5 6.2 22.4 24 2.6 24Z";
const mark = ({ fill = PAPER, beam = INK, rays = true } = {}) => `
  <path d="${PRISM}" fill="${fill}" stroke="${fill}" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M5.9 18 17.2 14.5" stroke="${beam}" stroke-width="1.7" stroke-linecap="round"/>
  ${rays ? `<path d="M17.2 14.5 29.6 10.4" stroke="${KEEP}" stroke-width="1.7" stroke-linecap="round"/>
  <path d="M17.2 14.5 29.6 15" stroke="${PAY}" stroke-width="1.7" stroke-linecap="round"/>
  <path d="M17.2 14.5 29.6 19.6" stroke="${FEE}" stroke-width="1.7" stroke-linecap="round"/>` : ""}`;

function tile({ size = 512, radius = 0.24, pad = 0.15, rays = false } = {}) {
  const r = size * radius;
  const inner = size * (1 - pad * 2);
  const scale = inner / 32;
  const off = (size - inner) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${INK}"/>
  <g transform="translate(${off - inner * 0.01} ${off - inner * 0.01}) scale(${scale})">${mark({ rays })}</g>
</svg>`;
}

const png = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

fs.mkdirSync(pub("brand"), { recursive: true });
fs.writeFileSync(pub("icon.svg"), tile({ size: 64, pad: 0.12 }));
fs.writeFileSync(pub("brand/logo-mark.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark({ fill: INK, beam: PAPER })}</svg>`);
fs.writeFileSync(pub("brand/logo-mark-mono.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark({ fill: INK, beam: "#FFFFFF", rays: false })}</svg>`);
fs.writeFileSync(pub("brand/logo-tile.svg"), tile({ size: 512, rays: true }));
const sizes = {
  "apple-icon.png": [180, { radius: 0, pad: 0.17 }],
  "icon-192.png": [192, {}],
  "icon-512.png": [512, { rays: true }],
  "brand/logo-512.png": [512, { rays: true }],
  "brand/logo-1024.png": [1024, { rays: true }],
};
for (const [file, [size, opts]] of Object.entries(sizes)) fs.writeFileSync(pub(file), png(tile({ size, ...opts }), size));
fs.writeFileSync(pub("icon-maskable-512.png"), png(tile({ size: 512, radius: 0, pad: 0.24 }), 512));

const icoSizes = [16, 32, 48];
const images = icoSizes.map((s) => png(tile({ size: 64, pad: s <= 16 ? 0.05 : 0.1 }), s));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const dir = images.map((buf, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(icoSizes[i], 0);
  e.writeUInt8(icoSizes[i], 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += buf.length;
  return e;
});
fs.writeFileSync(pub("favicon.ico"), Buffer.concat([header, ...dir, ...images]));
console.log("icons written to public/");
