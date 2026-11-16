// USGS 3DEP elevation ImageServer (US only, lidar-derived where available, best ~1 m).
// Docs: https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
import { fromArrayBuffer } from 'geotiff';
import type { DEM } from '../types';
import type { BBox } from './terrarium';
import { lonLatToMerc, groundScale } from '../lib/mercator';

const SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
export const MAX_3DEP_PX = 4000;

export function plan3DEP(b: BBox, groundRes: number) {
  const [x0, y0] = lonLatToMerc(b.west, b.south);
  const [x1, y1] = lonLatToMerc(b.east, b.north);
  const k = groundScale((b.north + b.south) / 2);
  let res = groundRes / k; // mercator metres per pixel
  let w = Math.round((x1 - x0) / res);
  let h = Math.round((y1 - y0) / res);
  const over = Math.max(w, h) / MAX_3DEP_PX;
  if (over > 1) {
    res *= over;
    w = Math.round((x1 - x0) / res);
    h = Math.round((y1 - y0) / res);
  }
  return { x0, y0, x1, y1, w: Math.max(2, w), h: Math.max(2, h), groundRes: res * k, clamped: over > 1 };
}

export async function fetch3DEP(b: BBox, groundRes: number, signal?: AbortSignal): Promise<DEM> {
  const p = plan3DEP(b, groundRes);
  const params = new URLSearchParams({
    bbox: `${p.x0},${p.y0},${p.x1},${p.y1}`,
    bboxSR: '3857',
    imageSR: '3857',
    size: `${p.w},${p.h}`,
    format: 'tiff',
    pixelType: 'F32',
    noData: '-999999',
    noDataInterpretation: 'esriNoDataMatchAny',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  const res = await fetch(`${SERVICE}?${params}`, { signal });
  if (!res.ok) throw new Error(`USGS 3DEP: HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json') || type.includes('html')) {
    throw new Error(`USGS 3DEP returned an error: ${(await res.text()).slice(0, 300)}`);
  }
  const tiff = await fromArrayBuffer(await res.arrayBuffer());
  const img = await tiff.getImage();
  const raster = (await img.readRasters({ interleave: true })) as unknown as ArrayLike<number>;
  const width = img.getWidth();
  const height = img.getHeight();
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const v = raster[i];
    data[i] = v <= -99999 || !Number.isFinite(v) ? NaN : v;
  }
  return {
    width,
    height,
    data,
    extent: { minX: p.x0, minY: p.y0, maxX: p.x1, maxY: p.y1 },
    crs: { epsg: 3857, geographic: false, label: 'EPSG:3857 Web Mercator' },
    cellSizeX: p.groundRes,
    cellSizeY: p.groundRes,
    source: `USGS 3DEP (~${p.groundRes.toFixed(1)} m/px)`,
  };
}
