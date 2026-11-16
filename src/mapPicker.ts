import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 resolves its worker relative to its own module URL, which breaks once bundled.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);
import type { BBox } from './sources/terrarium';

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

export class MapPicker {
  readonly map: maplibregl.Map;
  private selection: BBox | null = null;
  private drawing = false;
  private start: maplibregl.LngLat | null = null;
  onChange: (b: BBox | null) => void = () => {};

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      center: [-121.76, 46.85], // Mount Rainier
      zoom: 10,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© OpenStreetMap contributors',
          },
          dem: {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 15,
            encoding: 'terrarium',
            attribution: 'Terrain: AWS Terrain Tiles / Mapzen',
          },
          sel: { type: 'geojson', data: EMPTY },
        },
        layers: [
          { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.85 } },
          { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.4 } },
          { id: 'sel-fill', type: 'fill', source: 'sel', paint: { 'fill-color': '#ff7a1a', 'fill-opacity': 0.12 } },
          { id: 'sel-line', type: 'line', source: 'sel', paint: { 'line-color': '#ff7a1a', 'line-width': 2 } },
        ],
      },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    this.map.on('mousedown', (e) => {
      if (!this.drawing) return;
      e.preventDefault();
      this.start = e.lngLat;
    });
    this.map.on('mousemove', (e) => {
      if (!this.drawing || !this.start) return;
      this.setSelection(this.boxFrom(this.start, e.lngLat), false);
    });
    this.map.on('mouseup', (e) => {
      if (!this.drawing || !this.start) return;
      const b = this.boxFrom(this.start, e.lngLat);
      this.start = null;
      this.setDrawing(false);
      if (b.east - b.west > 1e-5 && b.north - b.south > 1e-5) this.setSelection(b, true);
    });
  }

  private boxFrom(a: maplibregl.LngLat, b: maplibregl.LngLat): BBox {
    return {
      west: Math.min(a.lng, b.lng),
      east: Math.max(a.lng, b.lng),
      south: Math.min(a.lat, b.lat),
      north: Math.max(a.lat, b.lat),
    };
  }

  setDrawing(on: boolean) {
    this.drawing = on;
    if (on) this.map.dragPan.disable();
    else this.map.dragPan.enable();
    this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
  }

  isDrawing() {
    return this.drawing;
  }

  setSelection(b: BBox | null, notify = true) {
    this.selection = b;
    const src = this.map.getSource('sel') as GeoJSONSource | undefined;
    const data = b
      ? {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]]],
          },
        }
      : EMPTY;
    if (src) src.setData(data);
    else this.map.once('load', () => (this.map.getSource('sel') as GeoJSONSource).setData(data));
    if (notify) this.onChange(b);
  }

  /** Current selection, or the visible map area when nothing is drawn. */
  getBBox(): BBox {
    if (this.selection) return this.selection;
    const b = this.map.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }

  hasSelection() {
    return this.selection !== null;
  }

  async search(q: string): Promise<boolean> {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
    const hits = (await res.json()) as Array<{ boundingbox: [string, string, string, string] }>;
    if (!hits.length) return false;
    const [s, n, w, e] = hits[0].boundingbox.map(Number);
    this.map.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 14, duration: 800 });
    return true;
  }

  resize() {
    this.map.resize();
  }
}

export function bboxSizeKm(b: BBox): { w: number; h: number } {
  const lat = ((b.north + b.south) / 2) * (Math.PI / 180);
  return { w: (b.east - b.west) * 111.32 * Math.cos(lat), h: (b.north - b.south) * 110.574 };
}
