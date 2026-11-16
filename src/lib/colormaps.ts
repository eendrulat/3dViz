// Colour ramps as evenly spaced hex stops.
export const RAMPS: Record<string, string[]> = {
  terrain: ['#1f4e3d', '#3d7a4a', '#8fae5d', '#d9c98b', '#b08a5a', '#8a6a55', '#f4f1ec'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  grayscale: ['#202020', '#f0f0f0'],
  desert: ['#5b3a29', '#a0643c', '#d8a15f', '#f0d9a8', '#fffaf0'],
  glacier: ['#0b1f3a', '#1d4e89', '#4f8fc0', '#a9d3ea', '#ffffff'],
  sunset: ['#2d1b4e', '#7a2c6b', '#d1495b', '#f08a4b', '#f7d488'],
  mono: ['#ffffff', '#ffffff'],
};

const cache = new Map<string, Array<[number, number, number]>>();

function parseHex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Returns linear-ish sRGB triplet in [0,1] for t in [0,1]. */
export function rampColor(name: string, t: number, out: [number, number, number] = [0, 0, 0]) {
  let stops = cache.get(name);
  if (!stops) {
    stops = (RAMPS[name] ?? RAMPS.terrain).map(parseHex);
    cache.set(name, stops);
  }
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  out[0] = a[0] + (b[0] - a[0]) * f;
  out[1] = a[1] + (b[1] - a[1]) * f;
  out[2] = a[2] + (b[2] - a[2]) * f;
  return out;
}

export function hexToRgb01(h: string): [number, number, number] {
  return parseHex(h);
}

/** ASPRS LAS classification colours (common subset). */
export const CLASS_COLORS: Record<number, string> = {
  0: '#9e9e9e', // never classified
  1: '#bdbdbd', // unclassified
  2: '#a1784c', // ground
  3: '#7fbf5f', // low veg
  4: '#4f9a3f', // medium veg
  5: '#2e6b2a', // high veg
  6: '#d9534f', // building
  7: '#ff00ff', // low noise
  9: '#3a7bd5', // water
  10: '#e0c341', // rail
  11: '#5a5a5a', // road surface
  17: '#f39c12', // bridge deck
};
