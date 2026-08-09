import type { Sounding } from './types'
import type { EnvProfile, ParcelResult } from './parcel'
import { buildEnvProfile, dcape, interpProfile, liftParcel, mlParcel, muParcel, sbParcel } from './parcel'
import { G, mixingRatio, thetaE, wetBulb } from './thermo'
import type { WindProfile } from './kinematics'
import {
  buildWindProfile, bulkShear, bunkersStormMotion, criticalAngle, srh,
} from './kinematics'
import type { EffectiveLayer, EffectiveKinematics } from './effective'
import { effectiveInflowLayer, effectiveKinematics } from './effective'
import type { AtmosLayer, DGZ, FireWeather } from './derived'
import { cclAndTconv, dendriticGrowthZone, detectLayers, fireWeather, thermalTop } from './derived'
import type { WinterDiag } from './winter'
import { winterDiagnostics } from './winter'

export interface Analysis {
  prof: EnvProfile
  wind: WindProfile | null
  sb: ParcelResult
  ml: ParcelResult
  mu: ParcelResult
  dcape: number
  dcapeSrcP: number
  pw: number
  freezingLevelZ: number
  freezingLevelP: number
  wbzZ: number // wet-bulb zero height AGL
  lapse03: number // °C/km
  lapse36: number
  lapse700500: number
  k: number
  totalTotals: number
  sweat: number
  showalter: number
  thetaEMin: { value: number; p: number }
  // kinematics (NaN when no wind data)
  shear1: number
  shear3: number
  shear6: number
  shear8: number
  shear9: number
  meanWind06: { u: number; v: number }
  bunkersRight: { u: number; v: number }
  bunkersLeft: { u: number; v: number }
  srh1: number
  srh3: number
  srh1Left: number
  srh3Left: number
  criticalAngle: number
  scp: number
  stp: number
  ship: number
  // effective inflow layer
  eil: EffectiveLayer | null
  eff: EffectiveKinematics
  // derived products
  cclP: number
  cclZ: number
  tconv: number
  thermalTopNow: number // m AGL at current surface temp
  thermalTopTrigger: number // m AGL at convective temperature
  fire: FireWeather
  dgz: DGZ | null
  layers: AtmosLayer[]
  winter: WinterDiag
}

function lapseRate(prof: EnvProfile, z0AGL: number, z1AGL: number): number {
  const elev = prof.z[0]
  // find temps at heights by scanning (z monotone increasing)
  const tAt = (zTarget: number): number => {
    const n = prof.z.length
    if (zTarget <= prof.z[0]) return prof.t[0]
    if (zTarget >= prof.z[n - 1]) return prof.t[n - 1]
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (prof.z[mid] <= zTarget) lo = mid
      else hi = mid
    }
    const f = (zTarget - prof.z[lo]) / (prof.z[hi] - prof.z[lo])
    return prof.t[lo] + f * (prof.t[hi] - prof.t[lo])
  }
  const t0 = tAt(elev + z0AGL)
  const t1 = tAt(elev + z1AGL)
  return (-(t1 - t0) / (z1AGL - z0AGL)) * 1000
}

/** Height (m MSL) where interpolated column value crosses `target` going up.
 *  col is 't' for temperature or a precomputed array. */
function crossingHeight(zs: ArrayLike<number>, vals: ArrayLike<number>, target: number): number {
  for (let i = 0; i < zs.length - 1; i++) {
    const a = vals[i]
    const b = vals[i + 1]
    if ((a >= target && b < target) || (a <= target && b > target)) {
      const f = (a - target) / (a - b)
      return zs[i] + f * (zs[i + 1] - zs[i])
    }
  }
  return NaN
}

/** Precipitable water, mm, integrated over the full sounding. */
function precipitableWater(prof: EnvProfile): number {
  let pw = 0
  for (let i = 0; i < prof.p.length - 1; i++) {
    const w0 = mixingRatio(prof.td[i], prof.p[i])
    const w1 = mixingRatio(prof.td[i + 1], prof.p[i + 1])
    const dp = (prof.p[i] - prof.p[i + 1]) * 100 // Pa
    pw += (0.5 * (w0 + w1) * dp) / G // kg/m² == mm
  }
  return pw
}

export function analyzeSounding(snd: Sounding): Analysis | null {
  const prof = buildEnvProfile(snd)
  if (!prof) return null
  const wind = buildWindProfile(snd)

  const sb = sbParcel(prof)
  const ml = mlParcel(prof)
  const mu = muParcel(prof)
  const dc = dcape(prof)

  const tAtP = (p: number) => interpProfile(prof, 't', p)
  const tdAtP = (p: number) => interpProfile(prof, 'td', p)
  const zAtP = (p: number) => interpProfile(prof, 'z', p)

  const elev = prof.z[0]
  const pSfc = prof.p[0]

  // freezing level (first 0°C crossing above ground)
  const fzZ = crossingHeight(prof.z, prof.t, 0)
  // wet-bulb zero
  const wbVals = new Float64Array(prof.p.length)
  for (let i = 0; i < prof.p.length; i++) wbVals[i] = wetBulb(prof.t[i], prof.td[i], prof.p[i])
  const wbzZ = crossingHeight(prof.z, wbVals, 0)

  // classic indices need 850/700/500 data
  const t850 = pSfc > 850 ? tAtP(850) : NaN
  const td850 = pSfc > 850 ? tdAtP(850) : NaN
  const t700 = tAtP(700)
  const td700 = tdAtP(700)
  const t500 = tAtP(500)

  const k = Number.isFinite(t850) ? t850 - t500 + td850 - (t700 - td700) : NaN
  const totalTotals = Number.isFinite(t850) ? t850 + td850 - 2 * t500 : NaN

  // Showalter: lift 850 parcel to 500
  let showalter = NaN
  if (Number.isFinite(t850)) {
    const res = liftParcel(prof, 'sb', 850, t850, td850)
    const at500 = res.curve.find((c) => Math.abs(c.p - 500) < 1.5)
    if (at500) showalter = t500 - at500.t
    else {
      // interpolate curve
      for (let i = 0; i < res.curve.length - 1; i++) {
        if (res.curve[i].p >= 500 && res.curve[i + 1].p <= 500) {
          const f = (res.curve[i].p - 500) / (res.curve[i].p - res.curve[i + 1].p)
          showalter = t500 - (res.curve[i].t + f * (res.curve[i + 1].t - res.curve[i].t))
          break
        }
      }
    }
  }

  // θe minimum in the column (mid-level dry air marker)
  let thetaEMin = { value: Infinity, p: NaN }
  for (let i = 0; i < prof.p.length; i++) {
    if (prof.p[i] < 400) break
    const te = thetaE(prof.t[i], prof.td[i], prof.p[i])
    if (te < thetaEMin.value) thetaEMin = { value: te, p: prof.p[i] }
  }

  // kinematics
  let shear1 = NaN, shear3 = NaN, shear6 = NaN, shear8 = NaN, shear9 = NaN
  let mw06 = { u: NaN, v: NaN }
  let bR = { u: NaN, v: NaN }
  let bL = { u: NaN, v: NaN }
  let srh1v = NaN, srh3v = NaN, srh1L = NaN, srh3L = NaN
  let critAngle = NaN
  let sweat = NaN
  if (wind) {
    shear1 = bulkShear(wind, 0, 1000).mag
    shear3 = bulkShear(wind, 0, 3000).mag
    shear6 = bulkShear(wind, 0, 6000).mag
    shear8 = bulkShear(wind, 0, 8000).mag
    shear9 = bulkShear(wind, 0, 9000).mag
    const bk = bunkersStormMotion(wind)
    mw06 = bk.mean
    bR = bk.right
    bL = bk.left
    srh1v = srh(wind, 0, 1000, bR)
    srh3v = srh(wind, 0, 3000, bR)
    srh1L = srh(wind, 0, 1000, bL)
    srh3L = srh(wind, 0, 3000, bL)
    critAngle = criticalAngle(wind, bR)

    // SWEAT (uses knots)
    if (Number.isFinite(t850)) {
      const kt = 1.9438445
      const w850 = interpWindAtP(wind, 850)
      const w500 = interpWindAtP(wind, 500)
      if (w850 && w500) {
        const s850 = Math.hypot(w850.u, w850.v) * kt
        const s500 = Math.hypot(w500.u, w500.v) * kt
        const d850 = (Math.atan2(-w850.u, -w850.v) * 180) / Math.PI
        const d500 = (Math.atan2(-w500.u, -w500.v) * 180) / Math.PI
        const dd850 = ((d850 % 360) + 360) % 360
        const dd500 = ((d500 % 360) + 360) % 360
        let shearTerm = 125 * (Math.sin(((dd500 - dd850) * Math.PI) / 180) + 0.2)
        const dirOk =
          dd850 >= 130 && dd850 <= 250 && dd500 >= 210 && dd500 <= 310 && dd500 - dd850 > 0 &&
          s850 >= 15 && s500 >= 15
        if (!dirOk) shearTerm = 0
        const tt = totalTotals
        sweat =
          12 * td850 + 20 * Math.max(0, tt - 49) + 2 * s850 + s500 + Math.max(0, shearTerm)
      }
    }
  }

  // composites (fixed-layer versions)
  const scp =
    Number.isFinite(srh3v) && Number.isFinite(shear6)
      ? (mu.cape / 1000) * (Math.max(0, srh3v) / 50) * Math.min(Math.max(shear6 / 20, 0), 1.5) *
        (mu.cin > -40 ? 1 : -40 / mu.cin)
      : NaN
  const stp =
    Number.isFinite(srh1v) && Number.isFinite(shear6)
      ? (sb.cape / 1500) *
        ((2000 - sb.lclZ + elev) / 1000 > 1 ? 1 : Math.max(0, (2000 - (sb.lclZ - elev)) / 1000)) *
        (Math.max(0, srh1v) / 150) *
        Math.min(Math.max(shear6 / 20, 0.0), 1.5) *
        (sb.cin > -50 ? 1 : Math.max(0, (200 + sb.cin) / 150))
      : NaN
  // SHIP (simplified SPC formula)
  let ship = NaN
  if (Number.isFinite(shear6) && Number.isFinite(t500)) {
    const muMr = mixingRatio(mu.td0, mu.p0) * 1000
    const lr75 = lapseRate(prof, zAtP(700) - elev, zAtP(500) - elev)
    let s = (mu.cape * Math.min(Math.max(muMr, 11), 13.6) * lr75 * -t500 *
      Math.min(Math.max(shear6, 7), 27)) / 42000000
    if (mu.cape < 1300) s *= mu.cape / 1300
    if (lr75 < 5.8) s *= lr75 / 5.8
    ship = s
  }

  // effective inflow layer + effective composites (storm motion: right mover)
  const eil = effectiveInflowLayer(prof)
  const eff = effectiveKinematics(
    eil, wind, mu, ml, elev,
    Number.isFinite(bR.u) ? bR : { u: 0, v: 0 },
  )

  // derived products
  const ccl = cclAndTconv(prof)
  const tTopNow = thermalTop(prof, prof.t[0]) - elev
  const tTopTrig = Number.isFinite(ccl.tconv) ? thermalTop(prof, ccl.tconv) - elev : NaN
  const fire = fireWeather(prof, wind)
  const dgz = dendriticGrowthZone(prof)
  const layers = detectLayers(prof)
  const winter = winterDiagnostics(prof)

  return {
    prof,
    wind,
    sb, ml, mu,
    dcape: dc.dcape,
    dcapeSrcP: dc.srcP,
    pw: precipitableWater(prof),
    freezingLevelZ: fzZ - elev,
    freezingLevelP: Number.isFinite(fzZ) ? pAtZ(prof, fzZ) : NaN,
    wbzZ: wbzZ - elev,
    lapse03: lapseRate(prof, 0, 3000),
    lapse36: lapseRate(prof, 3000, 6000),
    lapse700500: (() => {
      const z7 = zAtP(700)
      const z5 = zAtP(500)
      return lapseRate(prof, z7 - elev, z5 - elev)
    })(),
    k,
    totalTotals,
    sweat,
    showalter,
    thetaEMin: { value: thetaEMin.value, p: thetaEMin.p },
    shear1, shear3, shear6, shear8, shear9,
    meanWind06: mw06,
    bunkersRight: bR,
    bunkersLeft: bL,
    srh1: srh1v,
    srh3: srh3v,
    srh1Left: srh1L,
    srh3Left: srh3L,
    criticalAngle: critAngle,
    scp, stp, ship,
    eil,
    eff,
    cclP: ccl.cclP,
    cclZ: ccl.cclZ,
    tconv: ccl.tconv,
    thermalTopNow: tTopNow,
    thermalTopTrigger: tTopTrig,
    fire,
    dgz,
    layers,
    winter,
  }
}

function pAtZ(prof: EnvProfile, z: number): number {
  const n = prof.z.length
  for (let i = 0; i < n - 1; i++) {
    if (prof.z[i] <= z && prof.z[i + 1] > z) {
      const f = (z - prof.z[i]) / (prof.z[i + 1] - prof.z[i])
      return Math.exp(Math.log(prof.p[i]) + f * (Math.log(prof.p[i + 1]) - Math.log(prof.p[i])))
    }
  }
  return NaN
}

function interpWindAtP(wind: WindProfile, p: number): { u: number; v: number } | null {
  const ps = wind.p
  const n = ps.length
  if (p > ps[0] || p < ps[n - 1]) return null
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ps[mid] >= p) lo = mid
    else hi = mid
  }
  const f = (Math.log(ps[lo]) - Math.log(p)) / (Math.log(ps[lo]) - Math.log(ps[hi]))
  return { u: wind.u[lo] + f * (wind.u[hi] - wind.u[lo]), v: wind.v[lo] + f * (wind.v[hi] - wind.v[lo]) }
}
