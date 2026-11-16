import GUI, { type Controller } from 'lil-gui';
import type * as THREE from 'three';
import { Viewer } from './render/viewer';
import {
  buildTerrain, buildRidges, buildContours, buildPointCloud, buildGridPoints, computeContours,
  type Grid, type Params,
} from './render/styles';
import { MapPicker, bboxSizeKm } from './mapPicker';
import { fetchTerrarium, chooseZoom, type BBox } from './sources/terrarium';
import { fetch3DEP, plan3DEP } from './sources/usgs3dep';
import { readGeoTIFF } from './sources/geotiffFile';
import { readLAS, rasterize, type SurfaceMode } from './sources/lasFile';
import { displayGrid, demStats } from './lib/dem';
import { niceInterval, type ContourLine } from './lib/contours';
import { RAMPS } from './lib/colormaps';
import { mercResolution, groundScale } from './lib/mercator';
import { download, demToGeoTIFF, contoursToGeoJSON } from './export/exporters';
import type { Dataset, PointCloud } from './types';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// ─── State ───────────────────────────────────────────────────────────────
const params: Params & { resolution: number; smoothing: number; fog: number; sunAzimuth: number; sunElevation: number } = {
  style: 'terrain',
  exaggeration: 1.5,
  ramp: 'terrain',
  invertRamp: false,
  background: '#0e1014',
  resolution: 768,
  smoothing: 0,
  fog: 0,
  sunAzimuth: 315,
  sunElevation: 35,
  flatShading: false,
  base: true,
  baseColor: '#3a3026',
  ridgeCount: 90,
  ridgeWidth: 1.4,
  ridgeColor: '#f2efe8',
  ridgeColorByElevation: false,
  ridgeFill: false,
  ridgeFillColor: '#0e1014',
  ridgeDirection: 'east-west',
  contourInterval: 50,
  contourMajorEvery: 5,
  contourWidth: 1,
  contourColor: '#ffffff',
  contourColorByElevation: true,
  contourMode: 'on terrain',
  pointSize: 1.5,
  pointColorBy: 'elevation',
};

let dataset: Dataset | null = null;
let grid: (Grid & { key: string }) | null = null;
let contours: { key: string; lines: ContourLine[] } | null = null;

const viewer = new Viewer($('#view3d'));
const picker = new MapPicker($('#map'));

// ─── Status helpers ──────────────────────────────────────────────────────
function status(msg: string, error = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', error);
}
function busy(msg: string | null) {
  $('#busy').hidden = msg === null;
  $('#busy-text').textContent = msg ?? '';
}

// ─── View tabs ───────────────────────────────────────────────────────────
let mapFramed = false;
function showView(v: 'map' | '3d') {
  document.querySelectorAll<HTMLButtonElement>('.vtab').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#map').hidden = v !== 'map';
  $('#view3d').hidden = v !== '3d';
  ($('.cam') as HTMLElement).style.visibility = v === '3d' ? 'visible' : 'hidden';
  if (v === 'map') {
    picker.resize();
    // The map starts hidden (zero size), so frame the selection the first time it is shown.
    if (!mapFramed) {
      mapFramed = true;
      const b = picker.getBBox();
      picker.map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40, duration: 0 });
    }
  } else viewer.resize();
}
document.querySelectorAll<HTMLButtonElement>('.vtab').forEach((b) => (b.onclick = () => showView(b.dataset.view as 'map' | '3d')));
document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(
  (b) => (b.onclick = () => viewer.resetCamera(b.dataset.cam as 'oblique' | 'top' | 'front' | 'low')),
);

// ─── Source tabs ─────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
    document.querySelectorAll<HTMLElement>('.src-pane').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.src));
    if (b.dataset.src === 'map') showView('map');
  };
});

// ─── Map source ──────────────────────────────────────────────────────────
const provider = $<HTMLSelectElement>('#provider');
const awsDetail = $<HTMLSelectElement>('#aws-detail');
const depDetail = $<HTMLSelectElement>('#dep-detail');

function updatePlan() {
  const b = picker.getBBox();
  const km = bboxSizeKm(b);
  $('#sel-info').textContent = picker.hasSelection()
    ? `Box: ${km.w.toFixed(2)} × ${km.h.toFixed(2)} km`
    : `No box drawn: using visible map (${km.w.toFixed(1)} × ${km.h.toFixed(1)} km).`;
  const is3dep = provider.value === '3dep';
  $('#aws-detail-label').hidden = is3dep;
  $('#dep-detail-label').hidden = !is3dep;
  if (is3dep) {
    const p = plan3DEP(b, Number(depDetail.value));
    $('#plan-info').textContent =
      `${p.w} × ${p.h} px at ~${p.groundRes.toFixed(1)} m.` + (p.clamped ? ' Area too large for the requested resolution; coarsened.' : '');
  } else {
    const z = chooseZoom(b, Number(awsDetail.value));
    const res = mercResolution(z) * groundScale((b.north + b.south) / 2);
    $('#plan-info').textContent = `Zoom ${z}, ~${res.toFixed(1)} m per pixel.`;
  }
}
picker.onChange = updatePlan;
picker.map.on('moveend', updatePlan);
provider.onchange = awsDetail.onchange = depDetail.onchange = updatePlan;

$('#draw-btn').onclick = () => {
  showView('map');
  picker.setDrawing(!picker.isDrawing());
  $('#draw-btn').classList.toggle('active', picker.isDrawing());
  status(picker.isDrawing() ? 'Drag on the map to draw a box.' : '');
};
picker.map.on('mouseup', () => $('#draw-btn').classList.toggle('active', picker.isDrawing()));
$('#clear-btn').onclick = () => picker.setSelection(null);

$<HTMLFormElement>('#search-form').onsubmit = async (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>('#search').value.trim();
  if (!q) return;
  showView('map');
  try {
    if (!(await picker.search(q))) status(`No results for “${q}”.`, true);
  } catch (err) {
    status(String(err), true);
  }
};

async function loadFromMap(b: BBox) {
  busy('Fetching elevation…');
  try {
    const dem =
      provider.value === '3dep'
        ? await fetch3DEP(b, Number(depDetail.value))
        : await fetchTerrarium(b, Number(awsDetail.value), (d, t) => busy(`Fetching tiles ${d}/${t}…`));
    setDataset({ dem });
  } catch (err) {
    console.error(err);
    const hint = provider.value === '3dep' ? '\nUSGS 3DEP only covers the US; also check your network/ad-blocker.' : '';
    status(`Failed to load elevation: ${(err as Error).message}${hint}`, true);
  } finally {
    busy(null);
  }
}
$('#load-map').onclick = () => loadFromMap(picker.getBBox());

// ─── File source ─────────────────────────────────────────────────────────
let lastCloud: PointCloud | null = null;
const fileInput = $<HTMLInputElement>('#file');
const drop = $('#drop');

async function loadFile(file: File) {
  const ext = file.name.toLowerCase().split('.').pop();
  busy(`Reading ${file.name}…`);
  try {
    if (ext === 'las' || ext === 'laz') {
      lastCloud = await readLAS(file, (s) => busy(s));
      busy('Building surface…');
      await new Promise((r) => setTimeout(r, 0));
      applyLasSurface();
    } else if (ext === 'tif' || ext === 'tiff') {
      lastCloud = null;
      setDataset({ dem: await readGeoTIFF(file) });
    } else {
      throw new Error('Unsupported file type. Use .tif/.tiff, .las or .laz.');
    }
  } catch (err) {
    console.error(err);
    status(`Could not read ${file.name}: ${(err as Error).message}`, true);
  } finally {
    busy(null);
  }
}
function applyLasSurface() {
  if (!lastCloud) return;
  const mode = $<HTMLSelectElement>('#las-mode').value as SurfaceMode;
  const cell = Number($<HTMLInputElement>('#las-cell').value) || undefined;
  setDataset({ dem: rasterize(lastCloud, mode, cell), points: lastCloud }, true);
}
$('#las-mode').onchange = $('#las-cell').onchange = () => applyLasSurface();

fileInput.onchange = () => fileInput.files?.[0] && loadFile(fileInput.files[0]);
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add('over');
};
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) loadFile(f);
};
// Allow dropping anywhere on the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f) loadFile(f);
});

// ─── Dataset → scene ─────────────────────────────────────────────────────
function setDataset(ds: Dataset, keepView = false) {
  dataset = ds;
  grid = null;
  contours = null;
  const st = demStats(ds.dem);
  if (!st.valid) {
    status('The loaded area contains no valid elevation data.', true);
    return;
  }
  params.contourInterval = niceInterval(st.max - st.min, 25);
  if (ds.points && params.style !== 'points' && !keepView) params.style = 'points';
  if (!ds.points && params.style === 'points' && params.pointColorBy !== 'elevation') params.pointColorBy = 'elevation';
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  updateFolders();
  const range = `${st.min.toFixed(0)} to ${st.max.toFixed(0)}`;
  status(`${ds.dem.source}\n${ds.dem.width}×${ds.dem.height} cells · elevation ${range} · ${ds.dem.crs.label}`);
  $('#crs-info').textContent = exportHint();
  showView('3d');
  rebuild();
}

function getGrid(): Grid {
  const dem = dataset!.dem;
  const key = `${params.resolution}|${params.smoothing}`;
  if (grid?.key === key) return grid;
  const g = displayGrid(dem, params.resolution, params.smoothing);
  let min = Infinity, max = -Infinity;
  for (const v of g.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  grid = { data: g.data, w: g.w, h: g.h, sizeX: g.sizeX, sizeY: g.sizeY, min, max, key };
  return grid;
}

function getContours(g: Grid): ContourLine[] {
  const key = `${(g as Grid & { key: string }).key}|${params.contourInterval}`;
  if (contours?.key === key) return contours.lines;
  contours = { key, lines: computeContours(g, params) };
  return contours.lines;
}

let rebuildTimer = 0;
function rebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => {
    if (!dataset) return;
    const t0 = performance.now();
    let obj: THREE.Object3D;
    const g = getGrid();
    switch (params.style) {
      case 'ridges': obj = buildRidges(g, params); break;
      case 'contours': {
        if ((g.max - g.min) / params.contourInterval > 1500) {
          status('Contour interval too small for this elevation range (over 1500 levels).', true);
          return;
        }
        obj = buildContours(g, params, getContours(g));
        break;
      }
      case 'points':
        obj = dataset.points ? buildPointCloud(dataset.points, params) : buildGridPoints(g, params);
        break;
      default: obj = buildTerrain(g, params);
    }
    viewer.setContent(obj);
    viewer.setBackground(params.background, params.fog);
    viewer.setSun(params.sunAzimuth, params.sunElevation);
    console.debug(`rebuild ${params.style} in ${(performance.now() - t0).toFixed(0)} ms`);
  }, 50);
}

// ─── GUI ─────────────────────────────────────────────────────────────────
const gui = new GUI({ container: $('#gui'), title: 'Style' });
gui.add(params, 'style', { 'Shaded terrain': 'terrain', 'Ridge lines': 'ridges', Contours: 'contours', 'Point cloud': 'points' })
  .name('Style')
  .onChange(() => { updateFolders(); rebuild(); });
gui.add(params, 'exaggeration', 0.1, 10, 0.1).name('Vertical exaggeration').onChange(rebuild);
gui.add(params, 'ramp', Object.keys(RAMPS)).name('Colour ramp').onChange(rebuild);
gui.add(params, 'invertRamp').name('Invert ramp').onChange(rebuild);
gui.addColor(params, 'background').name('Background').onChange(rebuild);
gui.add(params, 'fog', 0, 1, 0.05).name('Depth fade').onChange(rebuild);

const fGrid = gui.addFolder('Detail');
fGrid.add(params, 'resolution', 128, 2048, 32).name('Mesh resolution').onFinishChange(rebuild);
fGrid.add(params, 'smoothing', 0, 6, 1).name('Smoothing').onFinishChange(rebuild);

const fLight = gui.addFolder('Lighting');
fLight.add(params, 'sunAzimuth', 0, 360, 1).name('Sun azimuth').onChange(() => viewer.setSun(params.sunAzimuth, params.sunElevation));
fLight.add(params, 'sunElevation', 2, 90, 1).name('Sun elevation').onChange(() => viewer.setSun(params.sunAzimuth, params.sunElevation));

const fTerrain = gui.addFolder('Terrain');
fTerrain.add(params, 'flatShading').name('Faceted').onChange(rebuild);
fTerrain.add(params, 'base').name('Solid base').onChange(rebuild);
fTerrain.addColor(params, 'baseColor').name('Base colour').onChange(rebuild);

const fRidges = gui.addFolder('Ridge lines');
fRidges.add(params, 'ridgeCount', 10, 400, 1).name('Line count').onChange(rebuild);
fRidges.add(params, 'ridgeWidth', 0.5, 6, 0.1).name('Line width').onChange(rebuild);
fRidges.add(params, 'ridgeDirection', ['east-west', 'north-south']).name('Direction').onChange(rebuild);
fRidges.addColor(params, 'ridgeColor').name('Line colour').onChange(rebuild);
fRidges.add(params, 'ridgeColorByElevation').name('Colour by elevation').onChange(rebuild);
fRidges.add(params, 'ridgeFill').name('Custom fill').onChange(rebuild);
fRidges.addColor(params, 'ridgeFillColor').name('Fill colour').onChange(rebuild);

const fContours = gui.addFolder('Contours');
const intervalCtl: Controller = fContours.add(params, 'contourInterval', 0.5, 1000, 0.5).name('Interval (elev. units)').onFinishChange(rebuild);
fContours.add(params, 'contourMajorEvery', 0, 10, 1).name('Major every n').onChange(rebuild);
fContours.add(params, 'contourWidth', 0.5, 5, 0.1).name('Line width').onChange(rebuild);
fContours.add(params, 'contourMode', ['on terrain', 'floating 3D', 'flat map']).name('Mode').onChange(() => { updateFolders(); rebuild(); });
fContours.addColor(params, 'contourColor').name('Line colour').onChange(rebuild);
fContours.add(params, 'contourColorByElevation').name('Colour by elevation').onChange(rebuild);

const fPoints = gui.addFolder('Points');
fPoints.add(params, 'pointSize', 0.2, 8, 0.1).name('Point size').onChange(rebuild);
const colorByCtl = fPoints
  .add(params, 'pointColorBy', ['elevation', 'rgb', 'classification', 'intensity'])
  .name('Colour by')
  .onChange(rebuild);

function updateFolders() {
  const s = params.style;
  fTerrain.show(s === 'terrain' || (s === 'contours' && params.contourMode === 'on terrain'));
  fRidges.show(s === 'ridges');
  fContours.show(s === 'contours');
  fPoints.show(s === 'points');
  fLight.show(s === 'terrain' || s === 'contours');
  colorByCtl.enable(!!dataset?.points);
  intervalCtl.updateDisplay();
}
updateFolders();

// ─── Export ──────────────────────────────────────────────────────────────
function baseName() {
  return (dataset?.dem.source.split(/[ (]/)[0] || 'terrain').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_');
}
function exportHint(): string {
  if (!dataset) return '';
  const c = dataset.dem.crs;
  if (!c.epsg) return 'CRS unknown: in ArcGIS Pro, run Define Projection on the exported files.';
  if (c.epsg === 3857) return 'GeoTIFF in EPSG:3857; contours exported as WGS84 lon/lat.';
  return `GeoTIFF in EPSG:${c.epsg}. Contours keep EPSG:${c.epsg} coordinates; in Pro use JSON To Features, then Define Projection.`;
}

$('#export-png').onclick = async () => {
  if (!dataset) return;
  showView('3d'); // the canvas has zero size while the map tab is shown
  await new Promise((r) => requestAnimationFrame(r));
  const scale = Number($<HTMLSelectElement>('#png-scale').value);
  const blob = await viewer.snapshot(scale, $<HTMLInputElement>('#png-transparent').checked);
  download(blob, `${baseName()}_${params.style}.png`);
};
$('#export-tif').onclick = () => {
  if (!dataset) return;
  download(demToGeoTIFF(dataset.dem), `${baseName()}_dem.tif`);
};
$('#export-contours').onclick = () => {
  if (!dataset) return;
  const g = getGrid();
  const lines = getContours(g);
  const { blob } = contoursToGeoJSON(dataset.dem, lines, g.w, g.h);
  download(blob, `${baseName()}_contours_${params.contourInterval}m.geojson`);
};

// ─── Startup: demo area (Mount Rainier) ──────────────────────────────────
const demo: BBox = { west: -121.9, south: 46.76, east: -121.6, north: 46.95 };
picker.setSelection(demo);
showView('3d');
loadFromMap(demo);

// Exposed for debugging in the console.
Object.assign(window, { viewer, params, rebuild });
