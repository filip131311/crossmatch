/**
 * The CrossMatch mark: two glossy candy phones in the style of a casual match-3 game, an iOS one
 * (blue, Dynamic Island pill, home bar) and an Android one (green, punch-hole camera, three-button
 * bar) leaning toward each other under a match sparkle, plus a rounded wordmark. Rendered as SVG
 * so the HTML report and the video composer share one definition. No platform trademarks are used.
 */
import type { Brand } from "./types.js";

const IOS = ["#5AA9FF", "#2F7BE8"];
const ANDROID = ["#4DE1B0", "#19B984"];
const SPARK = "#FFD166";
const PINK = "#FF6FA5";

function phone(id: string, x: number, y: number, w: number, h: number, kind: "ios" | "android", rot: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const top =
    kind === "ios"
      ? `<rect x="${cx - w * 0.22}" y="${y + h * 0.09}" width="${w * 0.44}" height="${h * 0.075}" rx="${h * 0.04}" fill="#14121F"/>`
      : `<circle cx="${cx}" cy="${y + h * 0.115}" r="${w * 0.07}" fill="#14121F"/>`;
  const bottom =
    kind === "ios"
      ? `<rect x="${cx - w * 0.2}" y="${y + h * 0.9}" width="${w * 0.4}" height="${h * 0.025}" rx="2" fill="#fff" opacity="0.85"/>`
      : `<g fill="#fff" opacity="0.85"><rect x="${cx - w * 0.26}" y="${y + h * 0.895}" width="${w * 0.1}" height="${h * 0.03}" rx="1.5"/><rect x="${cx - w * 0.05}" y="${y + h * 0.895}" width="${w * 0.1}" height="${h * 0.03}" rx="1.5"/><rect x="${cx + w * 0.16}" y="${y + h * 0.895}" width="${w * 0.1}" height="${h * 0.03}" rx="1.5"/></g>`;
  return `<g transform="rotate(${rot} ${cx} ${cy})" filter="url(#${id}-shadow)">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.22}" fill="url(#${id}-${kind})"/>
    <rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h / 2}" rx="${w * 0.2}" fill="#fff" opacity="0.14"/>
    <ellipse cx="${x + w * 0.42}" cy="${y + h * 0.16}" rx="${w * 0.3}" ry="${h * 0.09}" fill="#fff" opacity="0.5"/>
    ${top}${bottom}
  </g>`;
}

function star(cx: number, cy: number, r: number, fill: string, id: string): string {
  let d = "";
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    d += `${i ? "L" : "M"}${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }
  return `<path d="${d}Z" fill="${fill}" filter="url(#${id}-shadow)"/>`;
}

/** The badge only (square), `size` px. Designed on a 128-unit board. */
export function logoBadgeSvg(brand: Brand, size = 64, id = "cm"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${brand.accent}"/><stop offset="1" stop-color="#9B7BFF"/></linearGradient>
    <linearGradient id="${id}-ios" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${IOS[0]}"/><stop offset="1" stop-color="${IOS[1]}"/></linearGradient>
    <linearGradient id="${id}-android" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ANDROID[0]}"/><stop offset="1" stop-color="${ANDROID[1]}"/></linearGradient>
    <filter id="${id}-shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity="0.3"/></filter>
  </defs>
  <rect x="2" y="2" width="124" height="124" rx="32" fill="url(#${id}-bg)"/>
  <rect x="2" y="2" width="124" height="62" rx="32" fill="#fff" opacity="0.10"/>
  ${phone(id, 22, 30, 38, 72, "ios", -10)}
  ${phone(id, 68, 30, 38, 72, "android", 10)}
  ${star(64, 24, 13, SPARK, id)}${star(64, 24, 6, "#fff", id)}
  <circle cx="27" cy="104" r="3" fill="${PINK}"/><circle cx="102" cy="100" r="2.5" fill="${PINK}"/><circle cx="16" cy="60" r="2" fill="#fff" opacity="0.7"/>
</svg>`;
}

/** Badge + "CrossMatch" wordmark, `height` px tall. */
export function logoSvg(brand: Brand, height = 64): string {
  const badge = logoBadgeSvg(brand, height, "cmw");
  const fontSize = height * 0.56;
  const width = height + height * 0.28 + fontSize * 6.4;
  const textX = height + height * 0.28;
  const textY = height * 0.5 + fontSize * 0.36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="visible" role="img" aria-label="CrossMatch">
  <defs><linearGradient id="cmw-word" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${brand.accent}"/><stop offset="1" stop-color="${PINK}"/></linearGradient></defs>
  <svg x="0" y="0" width="${height}" height="${height}" viewBox="0 0 128 128">${badge.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</svg>
  <text x="${textX}" y="${textY}" font-family="'Arial Rounded MT Bold','Nunito','Varela Round','Helvetica Neue',Arial,sans-serif" font-weight="800" font-size="${fontSize}" letter-spacing="${-fontSize * 0.02}">
    <tspan fill="${brand.ink}">Cross</tspan><tspan fill="url(#cmw-word)">Match</tspan>
  </text>
</svg>`;
}
