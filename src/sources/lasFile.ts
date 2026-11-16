import { parse } from '@loaders.gl/core';
import { LAZRsLoader } from '@loaders.gl/las';
import type { CRSInfo, DEM, PointCloud } from '../types';

/** Upper bound on points kept in memory for display/rasterising. */
const MAX_POINTS = 6_000_000;

const td = new TextDecoder();
const cstr = (b: Uint8Array) => td.decode(b).replace(/\0.*$/s, '');

/** Pull the CRS (EPSG) from LAS VLR / EVLR records: GeoKeyDirectory (34735) or OGC WKT (2112). */
export function readLasCRS(buf: ArrayBuffer): CRSInfo {
  const dv = new DataView(buf);
  const records: Array<{ user: string; id: number; data: Uint8Array }> = [];
  try {
    const headerSize = dv.getUint16(94, true);
    const nVlr = dv.getUint32(100, true);
    let off = headerSize;
    for (let i = 0; i < nVlr && off + 54 <= buf.byteLength; i++) {
      const user = cstr(new Uint8Array(buf, off + 2, 16));
      const id = dv.getUint16(off + 18, true);
      const len = dv.getUint16(off + 20, true);
      records.push({ user, id, data: new Uint8Array(buf, off + 54, len) });
      off += 54 + len;
    }
    const major = dv.getUint8(24);
    const minor = dv.getUint8(25);
    if (major === 1 && minor >= 4 && headerSize >= 375) {
      let eoff = Number(dv.getBigUint64(235, true));
      const nE = dv.getUint32(243, true);
      for (let i = 0; i < nE && eoff + 60 <= buf.byteLength; i++) {
        const user = cstr(new Uint8Array(buf, eoff + 2, 16));
        const id = dv.getUint16(eoff + 18, true);
        const len = Number(dv.getBigUint64(eoff + 20, true));
        records.push({ user, id, data: new Uint8Array(buf, eoff + 60, Math.min(len, buf.byteLength - eoff - 60)) });
        eoff += 60 + len;
      }
    }
  } catch {
    /* malformed header: fall through with what we have */
  }

  for (const r of records) {
    if (r.user !== 'LASF_Projection') continue;
    if (r.id === 2112) {
      const wkt = cstr(r.data);
      // The last EPSG authority in a WKT string belongs to the outermost (compound/projected) CRS.
      // For compound CRSs we want the horizontal part, so prefer the PROJCS/PROJCRS one.
      const projBlock = wkt.match(/PROJ(?:CS|CRS)\[[\s\S]*$/)?.[0] ?? wkt;
      const ids = [...projBlock.matchAll(/(?:AUTHORITY|ID)\["EPSG",\s*"?(\d+)"?\]/g)].map((m) => Number(m[1]));
      // Inside a PROJCS block the projected CRS's own id is the last one before the block closes;
      // when a vertical CRS follows, take the id that precedes VERT_CS/VERTCRS.
      const horiz = projBlock.split(/VERT_?CS|VERTCRS/)[0];
      const hIds = [...horiz.matchAll(/(?:AUTHORITY|ID)\["EPSG",\s*"?(\d+)"?\]/g)].map((m) => Number(m[1]));
      const epsg = hIds.at(-1) ?? ids.at(-1);
      const geographic = !/PROJ(?:CS|CRS)\[/.test(wkt);
      if (epsg) return { epsg, geographic, label: `EPSG:${epsg} (from WKT)` };
    }
    if (r.id === 34735 && r.data.byteLength >= 8) {
      const u16 = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      const n = u16.getUint16(6, true);
      let proj = 0;
      let geog = 0;
      for (let k = 0; k < n; k++) {
        const base = 8 + k * 8;
        if (base + 8 > r.data.byteLength) break;
        const key = u16.getUint16(base, true);
        const loc = u16.getUint16(base + 2, true);
        const val = u16.getUint16(base + 6, true);
        if (loc !== 0) continue;
        if (key === 3072) proj = val;
        if (key === 2048) geog = val;
      }
      if (proj && proj !== 32767) return { epsg: proj, geographic: false, label: `EPSG:${proj}` };
      if (geog && geog !== 32767) return { epsg: geog, geographic: true, label: `EPSG:${geog} (geographic)` };
    }
  }
  return { geographic: false, label: 'Unknown CRS (no projection VLR)' };
}

export async function readLAS(file: File, onStatus?: (s: string) => void): Promise<PointCloud> {
  onStatus?.(`Reading ${file.name}…`);
  const buf = await file.arrayBuffer();
  const crs = readLasCRS(buf);
  const dv = new DataView(buf);
  const legacyCount = dv.getUint32(107, true);
  const minor = dv.getUint8(25);
  const total = minor >= 4 && dv.getUint16(94, true) >= 375 ? Number(dv.getBigUint64(247, true)) : legacyCount;
  const skip = Math.max(1, Math.ceil(total / MAX_POINTS));
  onStatus?.(`Decoding ${total.toLocaleString()} points${skip > 1 ? ` (keeping every ${skip}th)` : ''}…`);

  const mesh = (await parse(buf, LAZRsLoader, { las: { fp64: true, skip, shape: 'mesh' }, worker: false })) as unknown as {
    attributes: Record<string, { value: ArrayLike<number> }>;
    header: { vertexCount: number };
  };
  const pos = mesh.attributes.POSITION.value as Float64Array;
  const count = Math.floor(pos.length / 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = pos[i * 3] - minX;
    positions[i * 3 + 1] = pos[i * 3 + 1] - minY;
    positions[i * 3 + 2] = pos[i * 3 + 2] - minZ;
  }
  const colorAttr = mesh.attributes.COLOR_0?.value as Uint8Array | undefined;
  return {
    count,
    positions,
    colors: colorAttr && hasRealColor(colorAttr) ? colorAttr : undefined,
    classification: (mesh.attributes.classification?.value as Uint8Array) ?? new Uint8Array(count),
    intensity: (mesh.attributes.intensity?.value as Uint16Array) ?? new Uint16Array(count),
    origin: [minX, minY, minZ],
    extent: { minX, minY, maxX, maxY },
    minZ,
    maxZ,
    crs,
    source: `${file.name} (${count.toLocaleString()} pts${skip > 1 ? `, 1/${skip} of ${total.toLocaleString()}` : ''})`,
  };
}

function hasRealColor(c: Uint8Array): boolean {
  for (let i = 0; i < c.length; i += 4 * 97) if (c[i] || c[i + 1] || c[i + 2]) return true;
  return false;
}

export type SurfaceMode = 'ground' | 'surface';

/**
 * Rasterise points to a DEM. 'ground' = mean of ASPRS class 2 points (bare earth, DTM);
 * 'surface' = max of all non-noise points (DSM, includes trees and buildings).
 * Falls back to all points when no ground class exists.
 */
export function rasterize(pc: PointCloud, mode: SurfaceMode, cellSize?: number): DEM {
  const ex = pc.extent;
  const spanX = ex.maxX - ex.minX;
  const spanY = ex.maxY - ex.minY;
  const area = Math.max(spanX * spanY, 1e-9);
  // ~4 points per cell on average, capped at 2048 cells on the long side.
  const auto = Math.max(Math.sqrt((area * 4) / Math.max(pc.count, 1)), Math.max(spanX, spanY) / 2048);
  const cell = cellSize && cellSize > 0 ? Math.max(cellSize, Math.max(spanX, spanY) / 4096) : auto;
  const w = Math.max(2, Math.ceil(spanX / cell));
  const h = Math.max(2, Math.ceil(spanY / cell));

  let hasGround = false;
  if (mode === 'ground') for (let i = 0; i < pc.count; i++) if (pc.classification[i] === 2) { hasGround = true; break; }
  const useGround = mode === 'ground' && hasGround;

  const sum = new Float64Array(w * h);
  const cnt = new Uint32Array(w * h);
  const mx = new Float32Array(w * h).fill(-Infinity);
  const p = pc.positions;
  for (let i = 0; i < pc.count; i++) {
    const cls = pc.classification[i];
    if (cls === 7 || cls === 18) continue; // noise
    if (useGround && cls !== 2) continue;
    const cx = Math.min(w - 1, Math.floor(p[i * 3] / cell));
    const cy = Math.min(h - 1, Math.floor(p[i * 3 + 1] / cell));
    const k = (h - 1 - cy) * w + cx; // row 0 = north
    const z = p[i * 3 + 2] + pc.minZ;
    sum[k] += z;
    cnt[k]++;
    if (z > mx[k]) mx[k] = z;
  }
  const data = new Float32Array(w * h);
  for (let k = 0; k < data.length; k++) {
    data[k] = cnt[k] ? (mode === 'surface' ? mx[k] : sum[k] / cnt[k]) : NaN;
  }
  const label = useGround ? 'ground (DTM)' : mode === 'ground' ? 'all points, no ground class found' : 'surface (DSM)';
  return {
    width: w,
    height: h,
    data,
    extent: { minX: ex.minX, minY: ex.maxY - h * cell, maxX: ex.minX + w * cell, maxY: ex.maxY },
    crs: pc.crs,
    cellSizeX: cell,
    cellSizeY: cell,
    source: `${pc.source} → ${w}×${h} grid @ ${cell.toFixed(2)} units, ${label}`,
  };
}
