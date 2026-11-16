/** Coordinate reference system info carried with a dataset so exports stay georeferenced. */
export interface CRSInfo {
  /** EPSG code if known (e.g. 3857, 4326, 26910). */
  epsg?: number;
  /** True for lat/lon CRSs (cell sizes are in degrees). */
  geographic: boolean;
  /** Human-readable label for the UI. */
  label: string;
}

/** Axis-aligned extent in CRS units. */
export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Regular elevation grid. Row 0 is the NORTH edge (same as GeoTIFF / image order).
 * Values are in metres (or the file's native vertical unit). NaN = no data.
 */
export interface DEM {
  width: number;
  height: number;
  data: Float32Array;
  extent: Extent;
  crs: CRSInfo;
  /** Ground distance of one cell in metres-like units, used for 3D proportions. */
  cellSizeX: number;
  cellSizeY: number;
  source: string;
}

/** Point cloud in local coordinates (x east, y north, z up), relative to `origin`. */
export interface PointCloud {
  count: number;
  positions: Float32Array; // xyz, local
  colors?: Uint8Array; // rgba
  classification: Uint8Array;
  intensity: Uint16Array;
  origin: [number, number, number];
  extent: Extent; // CRS units
  minZ: number;
  maxZ: number;
  crs: CRSInfo;
  source: string;
}

export interface Dataset {
  dem: DEM;
  points?: PointCloud;
}
