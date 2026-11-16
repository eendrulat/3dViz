// Marching-squares contouring with segment joining into polylines.
// Grid coordinates: x in [0, w-1] (east), y in [0, h-1] (row 0 = north).

export interface ContourLine {
  level: number;
  points: Array<[number, number]>; // grid coords
}

export function niceInterval(range: number, targetLines = 25): number {
  if (range <= 0) return 1;
  const raw = range / targetLines;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return nice * p;
}

export function contourLevels(min: number, max: number, interval: number): number[] {
  const out: number[] = [];
  if (interval <= 0) return out;
  const start = Math.ceil(min / interval) * interval;
  for (let v = start; v <= max && out.length < 2000; v += interval) out.push(+v.toFixed(6));
  return out;
}

export function traceContours(data: Float32Array, w: number, h: number, levels: number[]): ContourLine[] {
  const result: ContourLine[] = [];
  for (const level of levels) {
    // Edge ids: horizontal edge from (x,y)→(x+1,y) = 2*(y*w+x); vertical (x,y)→(x,y+1) = 2*(y*w+x)+1
    const pointOf = new Map<number, [number, number]>();
    const adj = new Map<number, number[]>();
    const edgePoint = (id: number): [number, number] => {
      let p = pointOf.get(id);
      if (p) return p;
      const cell = id >> 1;
      const x = cell % w;
      const y = (cell - x) / w;
      const a = data[cell];
      if (id & 1) {
        const b = data[cell + w];
        const t = (level - a) / (b - a);
        p = [x, y + t];
      } else {
        const b = data[cell + 1];
        const t = (level - a) / (b - a);
        p = [x + t, y];
      }
      pointOf.set(id, p);
      return p;
    };
    const link = (e1: number, e2: number) => {
      edgePoint(e1);
      edgePoint(e2);
      (adj.get(e1) ?? adj.set(e1, []).get(e1)!).push(e2);
      (adj.get(e2) ?? adj.set(e2, []).get(e2)!).push(e1);
    };

    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        const tl = data[i], tr = data[i + 1], bl = data[i + w], br = data[i + w + 1];
        if (Number.isNaN(tl) || Number.isNaN(tr) || Number.isNaN(bl) || Number.isNaN(br)) continue;
        const code = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const top = 2 * i;
        const bottom = 2 * (i + w);
        const left = 2 * i + 1;
        const right = 2 * (i + 1) + 1;
        switch (code) {
          case 1: case 14: link(left, bottom); break;
          case 2: case 13: link(bottom, right); break;
          case 3: case 12: link(left, right); break;
          case 4: case 11: link(top, right); break;
          case 6: case 9: link(top, bottom); break;
          case 7: case 8: link(left, top); break;
          case 5: case 10: {
            const center = (tl + tr + bl + br) / 4;
            const centerHigh = center >= level;
            // code 5: tr & bl high; code 10: tl & br high
            if ((code === 5) === centerHigh) { link(left, top); link(bottom, right); }
            else { link(left, bottom); link(top, right); }
            break;
          }
        }
      }
    }

    // Walk chains. Each edge has degree 1 (open end) or 2.
    const visited = new Set<number>();
    const walk = (start: number) => {
      const pts: Array<[number, number]> = [pointOf.get(start)!];
      visited.add(start);
      let prev = -1;
      let cur = start;
      for (;;) {
        const next = (adj.get(cur) ?? []).find((n) => n !== prev && !visited.has(n));
        if (next === undefined) {
          // closed ring: reconnect to start
          if ((adj.get(cur) ?? []).includes(start) && pts.length > 2) pts.push(pointOf.get(start)!);
          break;
        }
        visited.add(next);
        pts.push(pointOf.get(next)!);
        prev = cur;
        cur = next;
      }
      if (pts.length >= 2) result.push({ level, points: pts });
    };
    for (const [id, n] of adj) if (n.length === 1 && !visited.has(id)) walk(id);
    for (const id of adj.keys()) if (!visited.has(id)) walk(id);
  }
  return result;
}
