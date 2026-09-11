/**
 * The CrossMatch mark: two flat phones leaning toward each other, an iOS one (blue, Dynamic Island
 * pill, home bar) and an Android one (green, punch-hole camera, three-button bar), with a small
 * violet dot between them. Flat and quiet so it sits with the report's serif headlines. Rendered as
 * SVG so the report and the README share one definition. No platform trademarks are used.
 */
import type { Brand } from "./types.js";

const IOS = "#2F7BE8";
const ANDROID = "#19B984";

function phone(x: number, y: number, w: number, h: number, kind: "ios" | "android", rot: number, fill: string): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const top =
    kind === "ios"
      ? `<rect x="${cx - w * 0.22}" y="${y + h * 0.09}" width="${w * 0.44}" height="${h * 0.075}" rx="${h * 0.04}" fill="#14121F"/>`
      : `<circle cx="${cx}" cy="${y + h * 0.115}" r="${w * 0.07}" fill="#14121F"/>`;
  const bottom =
    kind === "ios"
      ? `<rect x="${cx - w * 0.2}" y="${y + h * 0.9}" width="${w * 0.4}" height="${h * 0.025}" rx="2" fill="#fff" opacity="0.9"/>`
      : `<g fill="#fff" opacity="0.9"><rect x="${cx - w * 0.26}" y="${y + h * 0.895}" width="${w * 0.1}" height="${h * 0.03}" rx="1.5"/><rect x="${cx - w * 0.05}" y="${y + h * 0.895}" width="${w * 0.1}" height="${h * 0.03}" rx="1.5"/><rect x="${cx + w * 0.16}" y="${y + h * 0.895}" width="${w * 0.1}" height="${h * 0.03}" rx="1.5"/></g>`;
  return `<g transform="rotate(${rot} ${cx} ${cy})"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.22}" fill="${fill}"/>${top}${bottom}</g>`;
}

/** The badge only (square), `size` px. Designed on a 128-unit board; transparent background. */
export function logoBadgeSvg(brand: Brand, size = 64, _id = "cm"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  ${phone(24, 26, 38, 76, "ios", -8, IOS)}
  ${phone(66, 26, 38, 76, "android", 8, ANDROID)}
  <circle cx="64" cy="18" r="5" fill="${brand.accent}"/>
</svg>`;
}

/** Badge + "CrossMatch" wordmark, `height` px tall. */
export function logoSvg(brand: Brand, height = 64): string {
  const badge = logoBadgeSvg(brand, height);
  const fontSize = height * 0.56;
  const width = height + height * 0.22 + fontSize * 6.4;
  const textX = height + height * 0.22;
  const textY = height * 0.5 + fontSize * 0.36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="visible" role="img" aria-label="CrossMatch">
  <svg x="0" y="0" width="${height}" height="${height}" viewBox="0 0 128 128">${badge.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</svg>
  <text x="${textX}" y="${textY}" font-family="'Nunito','Arial Rounded MT Bold','Varela Round','Helvetica Neue',Arial,sans-serif" font-weight="800" font-size="${fontSize}" letter-spacing="${-fontSize * 0.02}">
    <tspan fill="${brand.ink}">Cross</tspan><tspan fill="${brand.accent}">Match</tspan>
  </text>
</svg>`;
}
