import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Fraction of pixels that differ noticeably between two same-size screenshots (status bar ignored). */
export async function screenChange(before: string, after: string): Promise<number | undefined> {
  try {
    const [a, b] = await Promise.all([loadImage(before), loadImage(after)]);
    if (a.width !== b.width || a.height !== b.height) return undefined;
    const w = Math.min(a.width, 360);
    const h = Math.round((a.height * w) / a.width);
    const da = pixels(a, w, h);
    const db = pixels(b, w, h);
    const top = Math.round(h * 0.06);
    let changed = 0;
    let total = 0;
    for (let y = top; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (d > 24) changed++;
        total++;
      }
    }
    return total ? changed / total : undefined;
  } catch {
    return undefined;
  }
}

function pixels(img: Awaited<ReturnType<typeof loadImage>>, w: number, h: number): Uint8ClampedArray {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/** (Re)compute `screenChange` for every step of a stored run from its screenshots. */
export async function refreshScreenChange(run: import("./types.js").RunRecord, runDir: string): Promise<void> {
  const path = await import("node:path");
  for (let i = 1; i < run.steps.length; i++) {
    for (const side of ["ios", "android"] as const) {
      const cur = run.steps[i][side].screenshot;
      const before = run.steps[i - 1][side].screenshot;
      if (cur && before) run.steps[i][side].screenChange = await screenChange(path.join(runDir, before), path.join(runDir, cur));
    }
  }
}
