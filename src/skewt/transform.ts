/** Skew-T log-P coordinate system.
 *
 *  y is log-pressure: linear in ln(p) between the domain ends.
 *  x is skewed temperature: an isotherm is a straight line tilted so that
 *  rising `h` pixels shifts it right by `skew * h` pixels (45° when skew=1).
 */
export interface SkewTDims {
  x0: number
  y0: number
  w: number
  h: number
  pBot: number
  pTop: number
  /** temperature range along the BOTTOM edge, °C */
  tMin: number
  tMax: number
  /** px right-shift per px of height */
  skew: number
}

export function makeDims(
  width: number,
  height: number,
  pDomain: [number, number],
  margin = { l: 44, r: 74, t: 10, b: 26 },
): SkewTDims {
  const w = width - margin.l - margin.r
  const h = height - margin.t - margin.b
  // temperature window scales with zoom: default full-depth chart shows
  // -40..45 at the bottom edge; zooming (smaller ln range) narrows it.
  const lnRange = Math.log(pDomain[0] / pDomain[1])
  const full = Math.log(1050 / 100)
  const f = lnRange / full
  const tMid = 2.5
  const tHalf = 42.5 * Math.max(f, 0.35)
  return {
    x0: margin.l,
    y0: margin.t,
    w,
    h,
    pBot: pDomain[0],
    pTop: pDomain[1],
    tMin: tMid - tHalf,
    tMax: tMid + tHalf,
    skew: (0.85 * w) / h,
  }
}

export function yFromP(d: SkewTDims, p: number): number {
  return d.y0 + (d.h * Math.log(p / d.pTop)) / Math.log(d.pBot / d.pTop)
}

export function pFromY(d: SkewTDims, y: number): number {
  return d.pTop * Math.exp(((y - d.y0) / d.h) * Math.log(d.pBot / d.pTop))
}

/** x for temperature t (°C) at vertical position y. */
export function xFromTY(d: SkewTDims, t: number, y: number): number {
  const xBase = d.x0 + ((t - d.tMin) / (d.tMax - d.tMin)) * d.w
  return xBase + (d.y0 + d.h - y) * d.skew
}

/** temperature at a pixel position. */
export function tFromXY(d: SkewTDims, x: number, y: number): number {
  const xBase = x - (d.y0 + d.h - y) * d.skew
  return d.tMin + ((xBase - d.x0) / d.w) * (d.tMax - d.tMin)
}

export const inPlot = (d: SkewTDims, x: number, y: number) =>
  x >= d.x0 && x <= d.x0 + d.w && y >= d.y0 && y <= d.y0 + d.h
