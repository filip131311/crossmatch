/**
 * The CrossMatch mark: a soft, glossy 3×3 tile board in the style of a casual match-3 game, with the
 * two diagonals lit up as matched gems (a cross), plus a rounded wordmark. Rendered as SVG so the
 * HTML report and the video composer share one definition.
 */
import type { Brand } from "./types.js";

const GEMS = ["#FF6FA5", "#FFD166", "#4DE1B0", "#5AA9FF", "#FF8F5C"];

/** The board only (square), `size` px. */
export function logoBadgeSvg(brand: Brand, size = 64, id = "cm"): string {
  const s = size / 64; // design units are a 64 px board
  const tile = 14 * s;
  const gap = 3 * s;
  const margin = (64 * s - 3 * tile - 2 * gap) / 2;
  const lit: Record<string, string> = { "0,0": GEMS[0], "2,2": GEMS[1], "0,2": GEMS[2], "2,0": GEMS[3], "1,1": GEMS[4] };
  let tiles = "";
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = margin + c * (tile + gap);
      const y = margin + r * (tile + gap);
      const gem = lit[`${r},${c}`];
      if (gem) {
        tiles += `<rect x="${x}" y="${y}" width="${tile}" height="${tile}" rx="${4 * s}" fill="${gem}" filter="url(#${id}-gemShadow)"/>`;
        tiles += `<ellipse cx="${x + tile * 0.4}" cy="${y + tile * 0.32}" rx="${tile * 0.3}" ry="${tile * 0.18}" fill="#fff" opacity="0.55"/>`;
      } else {
        tiles += `<rect x="${x}" y="${y}" width="${tile}" height="${tile}" rx="${4 * s}" fill="#fff" opacity="0.18"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${brand.accent}"/><stop offset="1" stop-color="#9B7BFF"/></linearGradient>
    <filter id="${id}-gemShadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="${1.5 * s}" stdDeviation="${1.2 * s}" flood-color="#000" flood-opacity="0.28"/></filter>
    <filter id="${id}-boardShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="${3 * s}" stdDeviation="${3 * s}" flood-color="${brand.accent}" flood-opacity="0.35"/></filter>
  </defs>
  <rect x="${1 * s}" y="${1 * s}" width="${62 * s}" height="${62 * s}" rx="${16 * s}" fill="url(#${id}-bg)" filter="url(#${id}-boardShadow)"/>
  <rect x="${1 * s}" y="${1 * s}" width="${62 * s}" height="${31 * s}" rx="${16 * s}" fill="#fff" opacity="0.10"/>
  ${tiles}
</svg>`;
}

/** Board + "CrossMatch" wordmark, `height` px tall. */
export function logoSvg(brand: Brand, height = 64): string {
  const badge = logoBadgeSvg(brand, height, "cmw");
  const fontSize = height * 0.56;
  const width = height + height * 0.28 + fontSize * 6.4;
  const inner = badge.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const textX = height + height * 0.28;
  const textY = height * 0.5 + fontSize * 0.36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="visible" role="img" aria-label="CrossMatch">
  <defs><linearGradient id="cmw-word" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${brand.accent}"/><stop offset="1" stop-color="#FF6FA5"/></linearGradient></defs>
  ${inner}
  <text x="${textX}" y="${textY}" font-family="'Arial Rounded MT Bold','Nunito','Varela Round','Helvetica Neue',Arial,sans-serif" font-weight="800" font-size="${fontSize}" letter-spacing="${-fontSize * 0.02}">
    <tspan fill="${brand.ink}">Cross</tspan><tspan fill="url(#cmw-word)">Match</tspan>
  </text>
</svg>`;
}
