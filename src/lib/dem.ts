import type { DEM } from '../types';

export function demStats(dem: DEM): { min: number; max: number; valid: number } {
  let min = Infinity;
  let max = -Infinity;
  let valid = 0;
  for (const v of dem.data) {
    if (Number.isNaN(v)) continue;
    valid++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!valid) return { min: 0, max: 0, valid };
  return { min, max, valid };
}

/** Fill NaN cells by repeatedly averaging valid neighbours. Mutates and returns data. */
export function fillNoData(data: Float32Array, w: number, h: number, maxPasses = 200): Float32Array {
  let holes = 0;
  for (const v of data) if (Number.isNaN(v)) holes++;
  if (holes === 0 || holes === data.length) return data;
  let src = data;
  for (let pass = 0; pass < maxPasses && holes > 0; pass++) {
    const dst = src.slice();
    holes = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!Number.isNaN(src[i])) continue;
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const v = src[yy * w + xx];
            if (!Number.isNaN(v)) {
              sum += v;
              n++;
            }
          }
        }
        if (n) dst[i] = sum / n;
        else holes++;
      }
    }
    src = dst;
  }
  data.set(src);
  return data;
}

/** Bilinear resample of a grid to a new size. NaN-aware (falls back to nearest valid). */
export function resample(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  if (sw === dw && sh === dh) return src.slice();
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = dh === 1 ? 0 : (y * (sh - 1)) / (dh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, sh - 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = dw === 1 ? 0 : (x * (sw - 1)) / (dw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, sw - 1);
      const tx = fx - x0;
      const a = src[y0 * sw + x0];
      const b = src[y0 * sw + x1];
      const c = src[y1 * sw + x0];
      const d = src[y1 * sw + x1];
      let v = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
      if (Number.isNaN(v)) v = [a, b, c, d].find((q) => !Number.isNaN(q)) ?? NaN;
      out[y * dw + x] = v;
    }
  }
  return out;
}

/** Separable box blur, `radius` cells, `passes` iterations (3 passes ≈ gaussian). */
export function smooth(src: Float32Array, w: number, h: number, radius: number, passes = 2): Float32Array {
  if (radius <= 0) return src;
  const a = src.slice();
  const b = new Float32Array(a.length);
  const r = Math.round(radius);
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          s += a[y * w + xx];
          n++;
        }
        b[y * w + x] = s / n;
      }
    }
    // vertical
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          s += b[yy * w + x];
          n++;
        }
        a[y * w + x] = s / n;
      }
    }
  }
  return a;
}

/**
 * Prepare a display grid: fill holes, downsample so the long side is <= maxSize,
 * and optionally smooth. Returns a new grid plus its dimensions.
 */
export function displayGrid(dem: DEM, maxSize: number, smoothRadius: number) {
  const scale = Math.min(1, maxSize / Math.max(dem.width, dem.height));
  const w = Math.max(2, Math.round(dem.width * scale));
  const h = Math.max(2, Math.round(dem.height * scale));
  const filled = fillNoData(dem.data.slice(), dem.width, dem.height);
  let data = resample(filled, dem.width, dem.height, w, h);
  data = smooth(data, w, h, smoothRadius);
  // Ground size of the full extent (unchanged by resampling).
  const sizeX = dem.cellSizeX * dem.width;
  const sizeY = dem.cellSizeY * dem.height;
  return { data, w, h, sizeX, sizeY };
}
