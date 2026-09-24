/** Case-local metres. Origin = SAR bounds centre. Not fields.ts 12.5°N. */

export class CaseProjector {
  readonly lat0: number;
  readonly lon0: number;
  readonly kmLat = 111.32;
  readonly kmLon: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly latMin: number;
  readonly latMax: number;
  readonly lonMin: number;
  readonly lonMax: number;

  constructor(bounds: [[number, number], [number, number]]) {
    const south = bounds[0][0], west = bounds[0][1];
    const north = bounds[1][0], east = bounds[1][1];
    this.latMin = south;
    this.latMax = north;
    this.lonMin = west;
    this.lonMax = east;
    this.lat0 = (south + north) / 2;
    this.lon0 = (west + east) / 2;
    this.kmLon = 111.32 * Math.cos((this.lat0 * Math.PI) / 180);
    this.xMin = this.lonToX(west);
    this.xMax = this.lonToX(east);
    this.yMin = this.latToY(south);
    this.yMax = this.latToY(north);
  }

  lonToX(lon: number): number {
    return (lon - this.lon0) * this.kmLon * 1000;
  }
  latToY(lat: number): number {
    return (lat - this.lat0) * this.kmLat * 1000;
  }
  xToLon(x: number): number {
    return this.lon0 + x / (this.kmLon * 1000);
  }
  yToLat(y: number): number {
    return this.lat0 + y / (this.kmLat * 1000);
  }
}

let active: CaseProjector | null = new CaseProjector([[18.5, 71.7], [18.8, 72.2]]);

export function setProjector(p: CaseProjector): void {
  active = p;
}

export function getProjector(): CaseProjector | null {
  return active;
}

/** Metres of ocean around the SAR frame so leeway can leave the image. ~50 km. */
export const VIEW_PAD_M = 50_000;

export function getDomainM(): { xMin: number; xMax: number; yMin: number; yMax: number } {
  if (!active) {
    return { xMin: -40000, xMax: 40000, yMin: -30000, yMax: 30000 };
  }
  const pad = VIEW_PAD_M;
  return {
    xMin: active.xMin - pad,
    xMax: active.xMax + pad,
    yMin: active.yMin - pad,
    yMax: active.yMax + pad,
  };
}
