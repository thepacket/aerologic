import type { Level, Sounding } from './types'
import {
  K2C, Rd,
  lclPressure, lclTemperatureK, mixingRatio, moistAdiabatTemp,
  satMixingRatio, theta, tempOnDryAdiabat, thetaE, virtualTempK,
  dewpointFromMixingRatio,
} from './thermo'

export type ParcelKind = 'sb' | 'ml' | 'mu'

export interface ParcelResult {
  kind: ParcelKind
  /** initial state */
  p0: number
  t0: number
  td0: number
  /** LCL */
  lclP: number
  lclZ: number
  lclT: number
  /** LFC / EL (NaN if none) */
  lfcP: number
  lfcZ: number
  elP: number
  elZ: number
  cape: number
  cin: number
  /** lifted index (500 hPa) */
  li: number
  /** parcel virtual temperature curve on the environment grid */
  curve: { p: number; t: number; tv: number }[]
  /** max parcel-minus-env virtual temp (buoyancy) */
  maxBuoyancy: number
  /** cap strength: max (env − parcel) below the LFC, °C */
  capStrength: number
}

/** Environment grid prepared for parcel math: subsampled, monotone in p,
 *  with interpolated virtual temperature. */
export interface EnvProfile {
  p: Float64Array
  z: Float64Array
  t: Float64Array
  td: Float64Array
  tv: Float64Array // virtual temp K
}

const MAX_GRID = 220

/** Build the computation grid from a (possibly 6000-level) sounding.
 *  Keeps every level for small soundings, subsamples evenly in log-p for
 *  high-resolution ones, always retaining the first and last levels. */
export function buildEnvProfile(snd: Sounding): EnvProfile | null {
  const ls = snd.levels.filter((l) => Number.isFinite(l.t) && Number.isFinite(l.p) && l.p > 0)
  if (ls.length < 5) return null
  let picked: Level[]
  if (ls.length <= MAX_GRID) picked = ls
  else {
    picked = []
    const lnTop = Math.log(ls[ls.length - 1].p)
    const lnBot = Math.log(ls[0].p)
    let nextLn = lnBot
    const step = (lnBot - lnTop) / (MAX_GRID - 1)
    for (let i = 0; i < ls.length; i++) {
      const ln = Math.log(ls[i].p)
      if (ln <= nextLn || i === ls.length - 1) {
        picked.push(ls[i])
        nextLn = ln - step
      }
    }
  }
  const n = picked.length
  const prof: EnvProfile = {
    p: new Float64Array(n),
    z: new Float64Array(n),
    t: new Float64Array(n),
    td: new Float64Array(n),
    tv: new Float64Array(n),
  }
  for (let i = 0; i < n; i++) {
    const l = picked[i]
    prof.p[i] = l.p
    prof.z[i] = l.z
    prof.t[i] = l.t
    const td = Number.isFinite(l.td) ? l.td : l.t - 30 // dry assumption when missing
    prof.td[i] = td
    prof.tv[i] = virtualTempK(l.t, mixingRatio(td, l.p))
  }
  return prof
}

/** Linear interpolation in log-p of an EnvProfile column. */
export function interpProfile(prof: EnvProfile, col: keyof EnvProfile, p: number): number {
  const ps = prof.p
  const v = prof[col] as Float64Array
  if (p >= ps[0]) return v[0]
  const n = ps.length
  if (p <= ps[n - 1]) return v[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ps[mid] > p) lo = mid
    else hi = mid
  }
  const f = (Math.log(ps[lo]) - Math.log(p)) / (Math.log(ps[lo]) - Math.log(ps[hi]))
  return v[lo] + f * (v[hi] - v[lo])
}

/** Compute the full parcel ascent + CAPE/CIN for an initial state. */
export function liftParcel(
  prof: EnvProfile,
  kind: ParcelKind,
  p0: number,
  t0: number,
  td0: number,
): ParcelResult {
  const w0 = mixingRatio(td0, p0)
  const th0 = theta(t0, p0)
  const plcl = Math.min(lclPressure(p0, t0, td0), p0)
  const tlclC = K2C(lclTemperatureK(t0, td0))

  // Parcel temperature at every env grid pressure ≤ p0
  const curve: { p: number; t: number; tv: number }[] = []
  const pTop = prof.p[prof.p.length - 1]

  // walk grid pressures plus the LCL itself for accuracy
  const gridPs: number[] = []
  for (let i = 0; i < prof.p.length; i++) if (prof.p[i] <= p0) gridPs.push(prof.p[i])
  if (!gridPs.includes(p0)) gridPs.unshift(p0)
  if (plcl > pTop && !gridPs.some((p) => Math.abs(p - plcl) < 0.01)) {
    gridPs.push(plcl)
    gridPs.sort((a, b) => b - a)
  }

  let lastMoistP = plcl
  let lastMoistT = tlclC
  for (const p of gridPs) {
    let t: number
    if (p >= plcl) {
      t = tempOnDryAdiabat(th0, p)
      curve.push({ p, t, tv: virtualTempK(t, w0) })
    } else {
      // continue pseudoadiabat from previous moist point (cheap incremental RK4)
      t = moistAdiabatTemp(lastMoistP, lastMoistT, p)
      lastMoistP = p
      lastMoistT = t
      const ws = satMixingRatio(t, p)
      curve.push({ p, t, tv: virtualTempK(t, Math.min(ws, w0)) })
    }
  }

  // Buoyancy B = Tv_parcel − Tv_env (K) at curve points, then integrate
  // Rd·B dlnp segment-wise, splitting segments at sign changes so positive
  // and negative area are separated exactly.
  const buoy = curve.map((c) => c.tv - interpProfile(prof, 'tv', c.p))
  const maxB = Math.max(...buoy)

  interface Seg { pTop: number; area: number }
  const posSegs: Seg[] = []
  const negSegs: Seg[] = []
  for (let i = 0; i < curve.length - 1; i++) {
    let b0 = buoy[i]
    let b1 = buoy[i + 1]
    let lp0 = Math.log(curve[i].p)
    let lp1 = Math.log(curve[i + 1].p)
    if ((b0 <= 0 && b1 > 0) || (b0 > 0 && b1 <= 0)) {
      const f = b0 / (b0 - b1)
      const lpX = lp0 + f * (lp1 - lp0)
      const a1 = Rd * 0.5 * b0 * (lp0 - lpX)
      const a2 = Rd * 0.5 * b1 * (lpX - lp1)
      ;(b0 > 0 ? posSegs : negSegs).push({ pTop: Math.exp(lpX), area: a1 })
      ;(b1 > 0 ? posSegs : negSegs).push({ pTop: Math.exp(lp1), area: a2 })
    } else {
      const a = Rd * 0.5 * (b0 + b1) * (lp0 - lp1)
      ;(b0 > 0 || b1 > 0 ? posSegs : negSegs).push({ pTop: Math.exp(lp1), area: a })
    }
  }

  // LFC = bottom of the first positive area of consequence (≥ ~1 J/kg),
  // EL = top of the last positive area. CAPE = all positive area between
  // them; CIN = all negative area below the LFC.
  let lfcP = NaN
  let elP = NaN
  let cape = 0
  let cin = 0
  let capStrength = 0
  const significant = posSegs.filter((s) => s.area > 0)
  if (significant.length > 0) {
    // group contiguity is unnecessary: total positive area is CAPE
    for (const s of significant) cape += s.area
    // first positive segment's bottom pressure: recover from ordering
    let firstTop = -Infinity
    let lastTop = Infinity
    for (const s of significant) {
      if (s.pTop > firstTop) firstTop = s.pTop
      if (s.pTop < lastTop) lastTop = s.pTop
    }
    elP = lastTop
    // LFC: highest pressure at which buoyancy turns positive
    if (buoy[0] > 0) lfcP = curve[0].p
    else {
      for (let i = 0; i < curve.length - 1; i++) {
        if (buoy[i] <= 0 && buoy[i + 1] > 0) {
          const f = buoy[i] / (buoy[i] - buoy[i + 1])
          lfcP = Math.exp(Math.log(curve[i].p) + f * (Math.log(curve[i + 1].p) - Math.log(curve[i].p)))
          break
        }
      }
    }
    for (const s of negSegs) if (s.pTop >= lfcP) cin += s.area
    for (let i = 0; i < curve.length && curve[i].p >= lfcP; i++) {
      if (-buoy[i] > capStrength) capStrength = -buoy[i]
    }
  } else {
    for (let i = 0; i < curve.length; i++) if (-buoy[i] > capStrength) capStrength = -buoy[i]
  }

  // Lifted index: env T at 500 minus parcel T at 500 (if parcel reaches)
  let li = NaN
  if (p0 > 500 && pTop < 500) {
    const t500p = plcl > 500 ? moistAdiabatTemp(plcl, tlclC, 500) : tempOnDryAdiabat(th0, 500)
    li = interpProfile(prof, 't', 500) - t500p
  }

  const zAt = (p: number) => (Number.isFinite(p) ? interpProfile(prof, 'z', p) : NaN)

  return {
    kind,
    p0, t0, td0,
    lclP: plcl,
    lclZ: zAt(plcl),
    lclT: tlclC,
    lfcP,
    lfcZ: zAt(lfcP),
    elP,
    elZ: zAt(elP),
    cape: Math.max(0, cape),
    cin: Math.min(0, cin),
    li,
    curve,
    maxBuoyancy: maxB,
    capStrength,
  }
}

/** Surface-based parcel. */
export function sbParcel(prof: EnvProfile): ParcelResult {
  return liftParcel(prof, 'sb', prof.p[0], prof.t[0], prof.td[0])
}

/** Mixed-layer parcel: mean θ and mean w over the lowest `depth` hPa. */
export function mlParcel(prof: EnvProfile, depth = 100): ParcelResult {
  const pSfc = prof.p[0]
  const pTopML = pSfc - depth
  let sumTh = 0
  let sumW = 0
  let n = 0
  for (let i = 0; i < prof.p.length && prof.p[i] >= pTopML; i++) {
    sumTh += theta(prof.t[i], prof.p[i])
    sumW += mixingRatio(prof.td[i], prof.p[i])
    n++
  }
  if (n === 0) return sbParcel(prof)
  const thBar = sumTh / n
  const wBar = sumW / n
  const t0 = tempOnDryAdiabat(thBar, pSfc)
  const td0 = dewpointFromMixingRatio(wBar, pSfc)
  return { ...liftParcel(prof, 'ml', pSfc, t0, Math.min(td0, t0)), kind: 'ml' }
}

/** Most-unstable parcel: max θe in the lowest `depth` hPa. */
export function muParcel(prof: EnvProfile, depth = 300): ParcelResult {
  const pSfc = prof.p[0]
  let best = 0
  let bestThE = -Infinity
  for (let i = 0; i < prof.p.length && prof.p[i] >= pSfc - depth; i++) {
    const te = thetaE(prof.t[i], prof.td[i], prof.p[i])
    if (te > bestThE) {
      bestThE = te
      best = i
    }
  }
  return { ...liftParcel(prof, 'mu', prof.p[best], prof.t[best], prof.td[best]), kind: 'mu' }
}

/** Downdraft CAPE: from the min-θe level in the lowest 400 hPa, descend
 *  pseudoadiabatically (saturated) to the surface. */
export function dcape(prof: EnvProfile): { dcape: number; srcP: number } {
  const pSfc = prof.p[0]
  let srcI = 0
  let minThE = Infinity
  for (let i = 0; i < prof.p.length && prof.p[i] >= pSfc - 400; i++) {
    const te = thetaE(prof.t[i], prof.td[i], prof.p[i])
    if (te < minThE) {
      minThE = te
      srcI = i
    }
  }
  const srcP = prof.p[srcI]
  // start saturated at the environment wet-bulb of that level
  const tw = (() => {
    const plcl = lclPressure(srcP, prof.t[srcI], prof.td[srcI])
    const tlcl = K2C(lclTemperatureK(prof.t[srcI], prof.td[srcI]))
    return moistAdiabatTemp(plcl, tlcl, srcP)
  })()
  let e = 0
  let lastT = tw
  let lastP = srcP
  const steps = 40
  for (let s = 1; s <= steps; s++) {
    const p = srcP + ((pSfc - srcP) * s) / steps
    const t = moistAdiabatTemp(lastP, lastT, p)
    const tvP = virtualTempK(t, satMixingRatio(t, p))
    const tvE0 = interpProfile(prof, 'tv', lastP)
    const tvE1 = interpProfile(prof, 'tv', p)
    const tvP0 = virtualTempK(lastT, satMixingRatio(lastT, lastP))
    e += Rd * 0.5 * (tvE0 - tvP0 + (tvE1 - tvP)) * Math.log(p / lastP)
    lastT = t
    lastP = p
  }
  return { dcape: Math.max(0, e), srcP }
}
