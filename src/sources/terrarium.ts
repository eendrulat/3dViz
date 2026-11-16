// AWS Terrain Tiles (Terrarium encoding): free, global, no API key.
// https://registry.opendata.aws/terrain-tiles/  elevation = (R*256 + G + B/256) - 32768
import type { DEM } from '../types';
import { lonLatToMerc, mercResolution, ORIGIN, groundScale } from '../lib/mercator';

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const MAX_ZOOM = 15;
const MAX_TILES = 144;

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Pick the highest zoom whose output fits in maxPx on the long side and within the tile budget. */
export function chooseZoom(b: BBox, maxPx: number): number {
  const [x0, y0] = lonLatToMerc(b.west, b.south);
  const [x1, y1] = lonLatToMerc(b.east, b.north);
  for (let z = MAX_ZOOM; z >= 0; z--) {
    const res = mercResolution(z);
    const w = (x1 - x0) / res;
    const h = (y1 - y0) / res;
    const tiles = (Math.ceil(w / 256) + 1) * (Math.ceil(h / 256) + 1);
    if (Math.max(w, h) <= maxPx && tiles <= MAX_TILES) return z;
  }
  return 0;
}

async function loadTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ImageData | null> {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  const xx = ((x % n) + n) % n;
  const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(xx)).replace('{y}', String(y));
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Tile ${z}/${xx}/${y}: HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(256, 256);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, 256, 256);
}

export async function fetchTerrarium(
  b: BBox,
  maxPx: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DEM> {
  const z = chooseZoom(b, maxPx);
  const res = mercResolution(z);
  const [mx0, my0] = lonLatToMerc(b.west, b.south);
  const [mx1, my1] = lonLatToMerc(b.east, b.north);
  // Global pixel coords (origin top-left of the world).
  const px0 = (mx0 + ORIGIN) / res;
  const px1 = (mx1 + ORIGIN) / res;
  const py0 = (ORIGIN - my1) / res; // north
  const py1 = (ORIGIN - my0) / res; // south
  const tx0 = Math.floor(px0 / 256);
  const tx1 = Math.floor((px1 - 1e-9) / 256);
  const ty0 = Math.floor(py0 / 256);
  const ty1 = Math.floor((py1 - 1e-9) / 256);

  const width = Math.max(2, Math.round(px1 - px0));
  const height = Math.max(2, Math.round(py1 - py0));
  const data = new Float32Array(width * height).fill(NaN);

  const jobs: Array<[number, number]> = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let done = 0;
  onProgress?.(0, jobs.length);

  const ox = Math.round(px0);
  const oy = Math.round(py0);
  const work = async ([tx, ty]: [number, number]) => {
    const img = await loadTile(z, tx, ty, signal);
    done++;
    onProgress?.(done, jobs.length);
    if (!img) return;
    const d = img.data;
    for (let j = 0; j < 256; j++) {
      const gy = ty * 256 + j - oy;
      if (gy < 0 || gy >= height) continue;
      for (let i = 0; i < 256; i++) {
        const gx = tx * 256 + i - ox;
        if (gx < 0 || gx >= width) continue;
        const k = (j * 256 + i) * 4;
        data[gy * width + gx] = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768;
      }
    }
  };
  // Limited concurrency.
  const queue = jobs.slice();
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (queue.length) await work(queue.shift()!);
    }),
  );

  const extent = {
    minX: ox * res - ORIGIN,
    maxX: (ox + width) * res - ORIGIN,
    maxY: ORIGIN - oy * res,
    minY: ORIGIN - (oy + height) * res,
  };
  const k = groundScale((b.north + b.south) / 2);
  return {
    width,
    height,
    data,
    extent,
    crs: { epsg: 3857, geographic: false, label: 'EPSG:3857 Web Mercator' },
    cellSizeX: res * k,
    cellSizeY: res * k,
    source: `AWS Terrain Tiles z${z} (~${(res * k).toFixed(1)} m/px)`,
  };
}
