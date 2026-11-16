import { writeArrayBuffer } from 'geotiff';
import type { DEM } from '../types';
import type { ContourLine } from '../lib/contours';
import { mercToLonLat } from '../lib/mercator';

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const NODATA = -9999;

/**
 * Float32 GeoTIFF of the elevation grid, georeferenced with the dataset's EPSG code.
 * ArcGIS Pro reads the GeoKeys directly. Unknown CRSs are written as "user-defined"
 * (32767), so Pro shows them as unknown and you can use Define Projection.
 */
export function demToGeoTIFF(dem: DEM): Blob {
  const values = new Float32Array(dem.data.length);
  for (let i = 0; i < values.length; i++) values[i] = Number.isNaN(dem.data[i]) ? NODATA : dem.data[i];
  const resX = (dem.extent.maxX - dem.extent.minX) / dem.width;
  const resY = (dem.extent.maxY - dem.extent.minY) / dem.height;
  const meta: Record<string, unknown> = {
    width: dem.width,
    height: dem.height,
    ModelPixelScale: [resX, resY, 0],
    ModelTiepoint: [0, 0, 0, dem.extent.minX, dem.extent.maxY, 0],
    GTRasterTypeGeoKey: 1, // PixelIsArea
    GDAL_NODATA: String(NODATA),
  };
  if (dem.crs.geographic) {
    meta.GTModelTypeGeoKey = 2;
    meta.GeographicTypeGeoKey = dem.crs.epsg ?? 32767;
  } else {
    meta.GTModelTypeGeoKey = 1;
    meta.ProjectedCSTypeGeoKey = dem.crs.epsg ?? 32767;
  }
  const buf = writeArrayBuffer(values, meta);
  return new Blob([buf], { type: 'image/tiff' });
}

/** Maps display-grid coordinates back to the source DEM's CRS coordinates. */
export function gridToCRS(dem: DEM, gw: number, gh: number) {
  const resX = (dem.extent.maxX - dem.extent.minX) / dem.width;
  const resY = (dem.extent.maxY - dem.extent.minY) / dem.height;
  return (gx: number, gy: number): [number, number] => {
    // displayGrid() resamples corner-to-corner, so grid 0 / gw-1 map to source pixel centres 0 / width-1.
    const fx = gw > 1 ? (gx * (dem.width - 1)) / (gw - 1) : 0;
    const fy = gh > 1 ? (gy * (dem.height - 1)) / (gh - 1) : 0;
    return [dem.extent.minX + (fx + 0.5) * resX, dem.extent.maxY - (fy + 0.5) * resY];
  };
}

/**
 * Contours as GeoJSON LineStrings with an `elevation` property.
 * Web Mercator data is converted to WGS84 lon/lat (what GeoJSON and Pro's
 * "JSON To Features" expect). Other CRSs are written in native coordinates with a
 * legacy `crs` member; in Pro, run Define Projection on the result if needed.
 */
export function contoursToGeoJSON(dem: DEM, lines: ContourLine[], gw: number, gh: number): { blob: Blob; wgs84: boolean } {
  const toCRS = gridToCRS(dem, gw, gh);
  const merc = dem.crs.epsg === 3857;
  const wgs84 = merc || dem.crs.epsg === 4326;
  const round = (v: number) => (wgs84 ? Math.round(v * 1e7) / 1e7 : Math.round(v * 100) / 100);
  const features = lines.map((l) => ({
    type: 'Feature',
    properties: { elevation: l.level },
    geometry: {
      type: 'LineString',
      coordinates: l.points.map(([x, y]) => {
        let [cx, cy] = toCRS(x, y);
        if (merc) [cx, cy] = mercToLonLat(cx, cy);
        return [round(cx), round(cy)];
      }),
    },
  }));
  const fc: Record<string, unknown> = { type: 'FeatureCollection', features };
  if (!wgs84 && dem.crs.epsg) fc.crs = { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${dem.crs.epsg}` } };
  return { blob: new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }), wgs84 };
}
