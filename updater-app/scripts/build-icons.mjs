// One-shot icon generator. Run with: node scripts/build-icons.mjs
// Produces assets/icon.png, assets/adaptive-icon.png, assets/monochrome-icon.png.
// `sharp` is only needed for this script — safe to uninstall afterwards.

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "assets");
const SIZE = 1024;

// SVG: download arrow into a tray — visually communicates "package delivered
// to device". Geometry is parameterised so the same artwork can be rendered
// at different scales (full icon vs. adaptive-icon safe zone).
function buildSvg({ fg, bg, scale = 1 }) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  // The artwork is laid out inside a virtual `box` of side (SIZE * scale)
  // centered on the canvas, so scaling shrinks proportionally for the
  // adaptive-icon mask.
  const box = SIZE * scale;
  const left = cx - box / 2;
  const top = cy - box / 2;

  // Arrow shaft — vertical rectangle, upper 55% of the artwork.
  const shaftW = box * 0.18;
  const shaftH = box * 0.42;
  const shaftX = cx - shaftW / 2;
  const shaftY = top + box * 0.08;

  // Arrowhead — symmetric triangle, sits just below the shaft, wider.
  const headW = box * 0.5;
  const headH = box * 0.22;
  const headTop = shaftY + shaftH - box * 0.005;
  const headBottom = headTop + headH;
  const headLeft = cx - headW / 2;
  const headRight = cx + headW / 2;

  // Tray / baseline — the "destination" the arrow points into.
  const trayW = box * 0.7;
  const trayH = box * 0.1;
  const trayX = cx - trayW / 2;
  const trayY = top + box - trayH - box * 0.08;

  const parts = [];
  if (bg) parts.push(`<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>`);

  // Shaft (rounded ends look better at small sizes, but square reads sharper
  // alongside the triangle — keep square caps).
  parts.push(
    `<rect x="${shaftX}" y="${shaftY}" width="${shaftW}" height="${shaftH}" fill="${fg}"/>`,
  );

  // Arrowhead.
  parts.push(
    `<polygon points="${headLeft},${headTop} ${headRight},${headTop} ${cx},${headBottom}" fill="${fg}"/>`,
  );

  // Tray.
  parts.push(
    `<rect x="${trayX}" y="${trayY}" width="${trayW}" height="${trayH}" fill="${fg}"/>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${parts.join("")}</svg>`;
}

async function render(svg, outName) {
  const outPath = join(OUT_DIR, outName);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`wrote ${outName}`);
}

await mkdir(OUT_DIR, { recursive: true });

// 1. Main icon — neon green on near-black, industrial palette aligned with
//    the app's UI theme. Slight inset so the glyph doesn't kiss the corners
//    on launchers that round the icon.
await render(
  buildSvg({ fg: "#39ff14", bg: "#0a0a0a", scale: 0.78 }),
  "icon.png",
);

// 2. Adaptive icon foreground — Android crops to a circle/squircle mask;
//    only the inner ~66% is guaranteed visible. The system composites this
//    over `adaptiveIcon.backgroundColor` so we render the glyph in the same
//    neon green and leave the canvas transparent.
await render(
  buildSvg({ fg: "#39ff14", bg: null, scale: 0.6 }),
  "adaptive-icon.png",
);

// 3. Monochrome icon for Android 13+ themed icons. Single color on transparent;
//    the system tints it to match wallpaper, so render in white as a base.
await render(
  buildSvg({ fg: "#ffffff", bg: null, scale: 0.6 }),
  "monochrome-icon.png",
);
