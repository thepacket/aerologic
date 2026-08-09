import type { Sounding } from './types'

/** Wind profile on a height-AGL grid, m/s components. */
export interface WindProfile {
  /** height AGL, m, ascending */
  z: Float64Array
  u: Float64Array
  v: Float64Array
  /** pressure at each point (for display) */
  p: Float64Array
  elev: number
}

export function buildWindProfile(snd: Sounding): WindProfile | null {
  const ls = snd.levels.filter(
    (l) => Number.isFinite(l.u) && Number.isFinite(l.v) && Number.isFinite(l.z),
  )
  if (ls.length < 3) return null
  const elev = snd.levels[0].z
  // sort by height, dedupe
  const sorted = [...ls].sort((a, b) => a.z - b.z)
  const z: number[] = []
  const u: number[] = []
  const v: number[] = []
  const p: number[] = []
  for (const l of sorted) {
    const zag = l.z - elev
    if (z.length && zag <= z[z.length - 1]) continue
    z.push(zag)
    u.push(l.u)
    v.push(l.v)
    p.push(l.p)
  }
  return {
    z: Float64Array.from(z),
    u: Float64Array.from(u),
    v: Float64Array.from(v),
    p: Float64Array.from(p),
    elev,
  }
}

/** Interpolated wind at height AGL (linear). Clamps to profile ends. */
export function windAt(wp: WindProfile, zAGL: number): { u: number; v: number } {
  const zs = wp.z
  const n = zs.length
  if (zAGL <= zs[0]) return { u: wp.u[0], v: wp.v[0] }
  if (zAGL >= zs[n - 1]) return { u: wp.u[n - 1], v: wp.v[n - 1] }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (zs[mid] <= zAGL) lo = mid
    else hi = mid
  }
  const f = (zAGL - zs[lo]) / (zs[hi] - zs[lo])
  return { u: wp.u[lo] + f * (wp.u[hi] - wp.u[lo]), v: wp.v[lo] + f * (wp.v[hi] - wp.v[lo]) }
}

/** Mean wind over a layer AGL (simple average on ~100 m steps). */
export function meanWind(wp: WindProfile, z0: number, z1: number): { u: number; v: number } {
  const steps = Math.max(2, Math.round((z1 - z0) / 100))
  let su = 0
  let sv = 0
  for (let i = 0; i <= steps; i++) {
    const w = windAt(wp, z0 + ((z1 - z0) * i) / steps)
    su += w.u
    sv += w.v
  }
  return { u: su / (steps + 1), v: sv / (steps + 1) }
}

/** Bulk shear vector between two heights AGL, m/s. */
export function bulkShear(wp: WindProfile, z0: number, z1: number): { u: number; v: number; mag: number } {
  const a = windAt(wp, z0)
  const b = windAt(wp, z1)
  const u = b.u - a.u
  const v = b.v - a.v
  return { u, v, mag: Math.hypot(u, v) }
}

/** Bunkers (2000) internal-dynamics storm motion. Returns right/left movers, m/s. */
export function bunkersStormMotion(wp: WindProfile): {
  right: { u: number; v: number }
  left: { u: number; v: number }
  mean: { u: number; v: number }
} {
  const mean = meanWind(wp, 0, 6000)
  const head = meanWind(wp, 5500, 6000)
  const tail = meanWind(wp, 0, 500)
  const su = head.u - tail.u
  const sv = head.v - tail.v
  const mag = Math.hypot(su, sv) || 1e-9
  const D = 7.5 // m/s deviation
  // unit vector perpendicular to shear: right mover deviates to the right
  const px = sv / mag
  const py = -su / mag
  return {
    right: { u: mean.u + D * px, v: mean.v + D * py },
    left: { u: mean.u - D * px, v: mean.v - D * py },
    mean,
  }
}

/** Storm-relative helicity over a layer AGL for storm motion c, m²/s². */
export function srh(wp: WindProfile, z0: number, z1: number, c: { u: number; v: number }): number {
  const steps = Math.max(4, Math.round((z1 - z0) / 50))
  let total = 0
  let prev = windAt(wp, z0)
  for (let i = 1; i <= steps; i++) {
    const cur = windAt(wp, z0 + ((z1 - z0) * i) / steps)
    total += (cur.u - c.u) * (prev.v - c.v) - (prev.u - c.u) * (cur.v - c.v)
    prev = cur
  }
  return total
}

/** Critical angle (Esterheld & Giuliano 2008): angle between the storm-relative
 *  inflow vector at 10 m and the 0–500 m shear vector, degrees. ~90° favors
 *  streamwise vorticity. */
export function criticalAngle(wp: WindProfile, c: { u: number; v: number }): number {
  const sfc = windAt(wp, 10)
  const shr = bulkShear(wp, 10, 500)
  const iru = c.u - sfc.u
  const irv = c.v - sfc.v
  const dot = iru * shr.u + irv * shr.v
  const m = Math.hypot(iru, irv) * shr.mag
  if (m < 1e-9) return NaN
  return (Math.acos(Math.min(1, Math.max(-1, dot / m))) * 180) / Math.PI
}

export const MS2KT = 1.9438445
export const KT2MS = 1 / MS2KT

/** met dir/speed → u,v (m/s). Direction is FROM, degrees. */
export function uvFromDirSpeed(dirDeg: number, spd: number): { u: number; v: number } {
  const rad = (dirDeg * Math.PI) / 180
  return { u: -spd * Math.sin(rad), v: -spd * Math.cos(rad) }
}

/** u,v → met direction (FROM, deg 0–360) and speed. */
export function dirSpeedFromUV(u: number, v: number): { dir: number; spd: number } {
  const spd = Math.hypot(u, v)
  let dir = (Math.atan2(-u, -v) * 180) / Math.PI
  if (dir < 0) dir += 360
  return { dir, spd }
}
