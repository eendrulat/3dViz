import { fromBlob } from 'geotiff';
import type { DEM, CRSInfo } from '../types';

/** Larger rasters are downsampled on read to keep memory reasonable in the browser. */
const MAX_READ_PX = 4096;

export async function readGeoTIFF(file: File): Promise<DEM> {
  const tiff = await fromBlob(file);
  const img = await tiff.getImage();
  const fullW = img.getWidth();
  const fullH = img.getHeight();
  const scale = Math.min(1, MAX_READ_PX / Math.max(fullW, fullH));
  const width = Math.max(2, Math.round(fullW * scale));
  const height = Math.max(2, Math.round(fullH * scale));
  const raster = (await img.readRasters({ samples: [0], width, height, interleave: true, resampleMethod: 'bilinear' })) as unknown as ArrayLike<number>;

  const nodata = img.getGDALNoData();
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const v = raster[i];
    data[i] = !Number.isFinite(v) || (nodata !== null && v === nodata) || v < -1e10 ? NaN : v;
  }

  const [minX, minY, maxX, maxY] = img.getBoundingBox();
  const keys = (img.getGeoKeys() ?? {}) as Record<string, number | string | undefined>;
  const proj = Number(keys.ProjectedCSTypeGeoKey);
  const geog = Number(keys.GeographicTypeGeoKey);
  let crs: CRSInfo;
  if (proj && proj !== 32767) crs = { epsg: proj, geographic: false, label: `EPSG:${proj}` };
  else if (geog && geog !== 32767) crs = { epsg: geog, geographic: true, label: `EPSG:${geog} (geographic)` };
  else crs = { geographic: false, label: 'Unknown / custom CRS' };
  // Model type 2 = geographic even without an EPSG code.
  if (Number(keys.GTModelTypeGeoKey) === 2) crs.geographic = true;

  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  let cellSizeX = resX;
  let cellSizeY = resY;
  if (crs.geographic) {
    const lat = ((minY + maxY) / 2) * (Math.PI / 180);
    cellSizeX = resX * 111320 * Math.cos(lat);
    cellSizeY = resY * 110540;
  }

  return {
    width,
    height,
    data,
    extent: { minX, minY, maxX, maxY },
    crs,
    cellSizeX,
    cellSizeY,
    source: `${file.name} (${fullW}×${fullH}${scale < 1 ? `, read at ${width}×${height}` : ''})`,
  };
}
