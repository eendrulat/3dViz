// Web Mercator (EPSG:3857) helpers.
export const R = 6378137;
export const ORIGIN = Math.PI * R; // 20037508.34

export function lonLatToMerc(lon: number, lat: number): [number, number] {
  const x = (lon * Math.PI * R) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

export function mercToLonLat(x: number, y: number): [number, number] {
  const lon = (x / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

/** Mercator metres per tile pixel at zoom z (256px tiles). */
export function mercResolution(z: number): number {
  return (2 * ORIGIN) / (256 * 2 ** z);
}

/** Scale factor between mercator metres and ground metres at latitude. */
export function groundScale(latDeg: number): number {
  return Math.cos((latDeg * Math.PI) / 180);
}
