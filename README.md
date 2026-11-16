# 3dViz

Browser app for 3D terrain and lidar visualizations. Runs fully client-side.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

## Data sources

| Source | Coverage | Resolution | Notes |
|---|---|---|---|
| AWS Terrain Tiles | Global | ~10–30 m (better in the US) | No key. Draw a box on the map. |
| USGS 3DEP ImageServer | US only | Down to 1 m (lidar-derived) | No key. This app caps requests at 4000×4000 px. |
| GeoTIFF file | Any | Native | Large files are downsampled to 4096 px on read. |
| LAS / LAZ file | Any | Native | LAS 1.0–1.4, point formats 0–10. Up to 6 M points are kept (evenly subsampled). |

LAS/LAZ files are turned into a grid for the terrain, ridge and contour styles:
- **Bare earth (DTM)**: mean of ground-class (2) points. If the file has no ground class, all points are used.
- **All features (DSM)**: max of all non-noise points.

## Styles

- **Shaded terrain**: lit mesh with color ramp and optional solid base.
- **Ridge lines**: stacked elevation profiles with hidden-line occlusion.
- **Contours**: on terrain, floating in 3D, or as a flat map.
- **Point cloud**: real LAS points (color by elevation, RGB, classification, intensity), or grid points for map/GeoTIFF data.

## Export

- **PNG**: 1×, 2× or 4× the viewport, optional transparent background.
- **Elevation GeoTIFF**: Float32, nodata = -9999, georeferenced with the source EPSG code. Opens directly in ArcGIS Pro.
- **Contours GeoJSON**: LineStrings with an `elevation` attribute. Import in ArcGIS Pro with *JSON To Features*.
  - Map data (EPSG:3857) is written as WGS84 lon/lat, which is what Pro expects.
  - File data in another CRS keeps its native coordinates. Run *Define Projection* in Pro after import.
  - Contours are traced on the display grid (the *Mesh resolution* and *Smoothing* settings), so they match what you see, not the full source resolution.

## Known limitations

- The whole LAS/LAZ file is read into memory. Files of a few hundred MB work; multi-GB files will not.
- Elevation units are taken as-is. If a file has horizontal units in feet and vertical units in metres (or the reverse), the 3D proportions will be off; adjust the vertical exaggeration.
- A CRS is only recognized when it has an EPSG code. Custom WKT without an EPSG code is exported as "unknown".
