import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { rampColor, hexToRgb01, CLASS_COLORS } from '../lib/colormaps';
import { traceContours, contourLevels, type ContourLine } from '../lib/contours';
import type { PointCloud } from '../types';

/** World model is scaled so its long horizontal side is this many units. */
export const MODEL_SIZE = 100;

export interface Grid {
  data: Float32Array;
  w: number;
  h: number;
  sizeX: number; // ground units
  sizeY: number;
  min: number;
  max: number;
}

export interface Params {
  style: 'terrain' | 'ridges' | 'contours' | 'points';
  exaggeration: number;
  ramp: string;
  invertRamp: boolean;
  background: string;
  // terrain
  flatShading: boolean;
  base: boolean;
  baseColor: string;
  // ridges
  ridgeCount: number;
  ridgeWidth: number;
  ridgeColor: string;
  ridgeColorByElevation: boolean;
  ridgeFill: boolean;
  ridgeFillColor: string;
  ridgeDirection: 'east-west' | 'north-south';
  // contours
  contourInterval: number;
  contourMajorEvery: number;
  contourWidth: number;
  contourColor: string;
  contourColorByElevation: boolean;
  contourMode: 'on terrain' | 'floating 3D' | 'flat map';
  // points
  pointSize: number;
  pointColorBy: 'elevation' | 'rgb' | 'classification' | 'intensity';
}

class Mapper {
  readonly s: number;
  constructor(readonly g: Grid, readonly exag: number) {
    this.s = MODEL_SIZE / Math.max(g.sizeX, g.sizeY);
  }
  x(gx: number) {
    return (gx / (this.g.w - 1) - 0.5) * this.g.sizeX * this.s;
  }
  z(gy: number) {
    return (gy / (this.g.h - 1) - 0.5) * this.g.sizeY * this.s;
  }
  y(v: number) {
    return (v - this.g.min) * this.exag * this.s;
  }
  t(v: number) {
    return this.g.max > this.g.min ? (v - this.g.min) / (this.g.max - this.g.min) : 0;
  }
}

const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Ramp colour converted to linear space (three.js treats vertex colours as linear). */
function color(p: Params, t: number, out: [number, number, number]) {
  rampColor(p.ramp, p.invertRamp ? 1 - t : t, out);
  out[0] = toLin(out[0]);
  out[1] = toLin(out[1]);
  out[2] = toLin(out[2]);
  return out;
}

function linHex(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb01(hex);
  return [toLin(r), toLin(g), toLin(b)];
}

// ───────────────────────────── Shaded terrain ─────────────────────────────

export function buildTerrain(g: Grid, p: Params, opts: { colored?: boolean } = {}): THREE.Object3D {
  const m = new Mapper(g, p.exaggeration);
  const { w, h, data } = g;
  const pos = new Float32Array(w * h * 3);
  const col = new Float32Array(w * h * 3);
  const c: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = data[i];
      pos[i * 3] = m.x(x);
      pos[i * 3 + 1] = m.y(v);
      pos[i * 3 + 2] = m.z(y);
      if (opts.colored === false) c[0] = c[1] = c[2] = 0.7;
      else color(p, m.t(v), c);
      col.set(c, i * 3);
    }
  }
  const idx = new Uint32Array((w - 1) * (h - 1) * 6);
  let k = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x;
      const b = a + 1;
      const d = a + w;
      const e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
      idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: p.flatShading,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  if (p.base) group.add(buildBase(g, m, p.baseColor));
  return group;
}

/** Side walls + bottom so the terrain reads as a solid block. */
function buildBase(g: Grid, m: Mapper, colorHex: string): THREE.Mesh {
  const { w, h, data } = g;
  const bottom = -Math.max(2, (g.max - g.min) * m.exag * m.s * 0.15);
  const verts: number[] = [];
  const edge = (pts: Array<[number, number]>) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const ax = m.x(x0), az = m.z(y0), ay = m.y(data[y0 * w + x0]);
      const bx = m.x(x1), bz = m.z(y1), by = m.y(data[y1 * w + x1]);
      verts.push(ax, ay, az, ax, bottom, az, bx, by, bz);
      verts.push(bx, by, bz, ax, bottom, az, bx, bottom, bz);
    }
  };
  const north: Array<[number, number]> = [];
  const south: Array<[number, number]> = [];
  const west: Array<[number, number]> = [];
  const east: Array<[number, number]> = [];
  for (let x = 0; x < w; x++) { north.push([x, 0]); south.push([x, h - 1]); }
  for (let y = 0; y < h; y++) { west.push([0, y]); east.push([w - 1, y]); }
  edge(north); edge(south); edge(west); edge(east);
  // bottom plate
  const x0 = m.x(0), x1 = m.x(w - 1), z0 = m.z(0), z1 = m.z(h - 1);
  verts.push(x0, bottom, z0, x1, bottom, z0, x0, bottom, z1, x1, bottom, z0, x1, bottom, z1, x0, bottom, z1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colorHex, roughness: 1, side: THREE.DoubleSide }));
}

// ───────────────────────────── Ridge lines ─────────────────────────────

export function buildRidges(g: Grid, p: Params): THREE.Object3D {
  const m = new Mapper(g, p.exaggeration);
  const group = new THREE.Group();
  const n = Math.max(2, Math.round(p.ridgeCount));
  const ns = p.ridgeDirection === 'north-south';
  const lines = ns ? g.w : g.h; // number of available grid lines across
  const along = ns ? g.h : g.w; // samples per line
  const baseY = -0.01;
  const fillColor = new THREE.Color(p.ridgeFill ? p.ridgeFillColor : p.background);
  const solid = linHex(p.ridgeColor);
  const c: [number, number, number] = [0, 0, 0];

  for (let r = 0; r < n; r++) {
    const gl = (r / (n - 1)) * (lines - 1); // fractional grid line
    const l0 = Math.floor(gl);
    const l1 = Math.min(lines - 1, l0 + 1);
    const f = gl - l0;
    const positions: number[] = [];
    const colors: number[] = [];
    const fill: number[] = [];
    for (let s = 0; s < along; s++) {
      const i0 = ns ? s * g.w + l0 : l0 * g.w + s;
      const i1 = ns ? s * g.w + l1 : l1 * g.w + s;
      const v = g.data[i0] * (1 - f) + g.data[i1] * f;
      const x = ns ? m.x(gl) : m.x(s);
      const z = ns ? m.z(s) : m.z(gl);
      const y = m.y(v);
      positions.push(x, y, z);
      if (p.ridgeColorByElevation) color(p, m.t(v), c);
      else c.splice(0, 3, ...solid);
      colors.push(c[0], c[1], c[2]);
      fill.push(x, y, z, x, baseY, z);
    }
    const geo = new LineGeometry();
    geo.setPositions(positions);
    geo.setColors(colors);
    const mat = new LineMaterial({ linewidth: p.ridgeWidth, vertexColors: true, worldUnits: false });
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    group.add(line);

    // Occluding curtain under the line so nearer ridges hide farther ones.
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fill, 3));
    const idx: number[] = [];
    for (let s = 0; s < along - 1; s++) {
      const a = s * 2, b = a + 1, cc = a + 2, d = a + 3;
      idx.push(a, b, cc, cc, b, d);
    }
    fg.setIndex(idx);
    const fm = new THREE.MeshBasicMaterial({
      color: fillColor,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });
    group.add(new THREE.Mesh(fg, fm));
  }
  return group;
}

// ───────────────────────────── Contours ─────────────────────────────

export function computeContours(g: Grid, p: Params): ContourLine[] {
  const levels = contourLevels(g.min, g.max, p.contourInterval);
  return traceContours(g.data, g.w, g.h, levels);
}

export function buildContours(g: Grid, p: Params, lines: ContourLine[]): THREE.Object3D {
  const m = new Mapper(g, p.exaggeration);
  const group = new THREE.Group();
  const flat = p.contourMode === 'flat map';
  if (p.contourMode === 'on terrain') group.add(buildTerrain(g, { ...p, base: p.base }, { colored: !p.contourColorByElevation }));

  const solid = linHex(p.contourColor);
  const c: [number, number, number] = [0, 0, 0];
  const major: { pos: number[]; col: number[] } = { pos: [], col: [] };
  const minor: { pos: number[]; col: number[] } = { pos: [], col: [] };
  const majorStep = p.contourInterval * Math.max(1, Math.round(p.contourMajorEvery));
  const lift = flat ? 0 : 0.02;

  for (const line of lines) {
    const isMajor = p.contourMajorEvery > 0 && Math.abs(line.level / majorStep - Math.round(line.level / majorStep)) < 1e-6;
    const tgt = isMajor ? major : minor;
    const y = flat ? 0 : m.y(line.level) + lift;
    if (p.contourColorByElevation) color(p, m.t(line.level), c);
    else c.splice(0, 3, ...solid);
    for (let i = 0; i < line.points.length - 1; i++) {
      const [x0, y0] = line.points[i];
      const [x1, y1] = line.points[i + 1];
      tgt.pos.push(m.x(x0), y, m.z(y0), m.x(x1), y, m.z(y1));
      tgt.col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
    }
  }
  const add = (d: { pos: number[]; col: number[] }, width: number) => {
    if (!d.pos.length) return;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(d.pos);
    geo.setColors(d.col);
    const mat = new LineMaterial({ linewidth: width, vertexColors: true });
    group.add(new LineSegments2(geo, mat));
  };
  add(minor, p.contourWidth);
  add(major, p.contourWidth * 2);
  return group;
}

// ───────────────────────────── Points ─────────────────────────────

/** Point cloud from LAS data. */
export function buildPointCloud(pc: PointCloud, p: Params): THREE.Object3D {
  const spanX = pc.extent.maxX - pc.extent.minX;
  const spanY = pc.extent.maxY - pc.extent.minY;
  const s = MODEL_SIZE / Math.max(spanX, spanY, 1e-9);
  const n = pc.count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const zr = Math.max(pc.maxZ - pc.minZ, 1e-9);
  let imax = 1;
  if (p.pointColorBy === 'intensity') {
    // 99th-percentile-ish normalisation via sampled max of a subset
    const sample: number[] = [];
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 5000))) sample.push(pc.intensity[i]);
    sample.sort((a, b) => a - b);
    imax = sample[Math.floor(sample.length * 0.99)] || 1;
  }
  const classRgb = new Map<number, [number, number, number]>();
  for (const [k, v] of Object.entries(CLASS_COLORS)) classRgb.set(Number(k), linHex(v));
  const c: [number, number, number] = [0, 0, 0];
  const mode = p.pointColorBy === 'rgb' && !pc.colors ? 'elevation' : p.pointColorBy;
  for (let i = 0; i < n; i++) {
    const x = pc.positions[i * 3], y = pc.positions[i * 3 + 1], z = pc.positions[i * 3 + 2];
    pos[i * 3] = (x - spanX / 2) * s;
    pos[i * 3 + 1] = z * p.exaggeration * s;
    pos[i * 3 + 2] = -(y - spanY / 2) * s;
    if (mode === 'rgb') {
      c[0] = toLin(pc.colors![i * 4] / 255);
      c[1] = toLin(pc.colors![i * 4 + 1] / 255);
      c[2] = toLin(pc.colors![i * 4 + 2] / 255);
    } else if (mode === 'classification') {
      const cc = classRgb.get(pc.classification[i]) ?? classRgb.get(1)!;
      c[0] = cc[0]; c[1] = cc[1]; c[2] = cc[2];
    } else if (mode === 'intensity') {
      const t = Math.min(1, pc.intensity[i] / imax);
      color(p, t, c);
    } else color(p, z / zr, c);
    col.set(c, i * 3);
  }
  return makePoints(pos, col, p.pointSize * s * 0.5 * Math.sqrt((spanX * spanY) / Math.max(n, 1)));
}

/** Point view of a DEM (for map-sourced data that has no real point cloud). */
export function buildGridPoints(g: Grid, p: Params): THREE.Object3D {
  const m = new Mapper(g, p.exaggeration);
  const n = g.w * g.h;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      const v = g.data[i];
      pos[i * 3] = m.x(x);
      pos[i * 3 + 1] = m.y(v);
      pos[i * 3 + 2] = m.z(y);
      color(p, m.t(v), c);
      col.set(c, i * 3);
    }
  }
  const spacing = (g.sizeX / (g.w - 1)) * m.s;
  return makePoints(pos, col, p.pointSize * spacing * 0.5);
}

function makePoints(pos: Float32Array, col: Float32Array, size: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size, vertexColors: true, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}
