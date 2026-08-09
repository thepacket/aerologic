/** Derived products beyond the classic index set: convective condensation
 *  level, thermal/soaring diagnostics, fire weather, dendritic growth zone,
 *  and cloud / icing layer detection. */
import type { EnvProfile } from './parcel'
import { interpProfile } from './parcel'
import {
  dewpointFromMixingRatio, mixingRatio, satMixingRatio, tempOnDryAdiabat, theta,
} from './thermo'
import type { WindProfile } from './kinematics'
import { meanWind } from './kinematics'

/** CCL: where the mean low-level mixing-ratio line crosses the temperature
 *  profile. Convective temperature: dry adiabat from the CCL back to the
 *  surface — the classic soaring "trigger temperature". */
export function cclAndTconv(prof: EnvProfile): { cclP: number; cclZ: number; tconv: number } {
  const pSfc = prof.p[0]
  let sumW = 0
  let n = 0
  for (let i = 0; i < prof.p.length && prof.p[i] >= pSfc - 100; i++) {
    sumW += mixingRatio(prof.td[i], prof.p[i])
    n++
  }
  const wBar = sumW / Math.max(n, 1)
  // In a saturated boundary layer (fog) the mixing-ratio line starts on the T
  // curve, so first walk up until clear of saturation, then find the crossing.
  let clear = false
  for (let p = pSfc; p >= 300; p -= 4) {
    const tdSat = dewpointFromMixingRatio(wBar, p)
    const tEnv = interpProfile(prof, 't', p)
    if (!clear) {
      if (tdSat < tEnv - 0.1) clear = true
      continue
    }
    if (tdSat >= tEnv) {
      const th = theta(tEnv, p)
      return { cclP: p, cclZ: interpProfile(prof, 'z', p), tconv: tempOnDryAdiabat(th, pSfc) }
    }
  }
  return { cclP: NaN, cclZ: NaN, tconv: NaN }
}

/** Height (m MSL) a dry thermal from the surface at temperature tSfc reaches:
 *  where its dry adiabat becomes colder than the environment. */
export function thermalTop(prof: EnvProfile, tSfc: number): number {
  const pSfc = prof.p[0]
  const th = theta(tSfc, pSfc)
  let last = prof.z[0]
  for (let p = pSfc - 4; p >= 200; p -= 4) {
    const tp = tempOnDryAdiabat(th, p)
    if (tp < interpProfile(prof, 't', p)) return last
    last = interpProfile(prof, 'z', p)
  }
  return last
}

export interface FireWeather {
  haines: number
  hainesVariant: 'low' | 'mid' | 'high'
  /** mixing height m AGL from current surface temperature */
  mixingHeight: number
  /** mean wind through the mixed layer, m/s components */
  transportWind: { u: number; v: number }
}

export function fireWeather(prof: EnvProfile, wind: WindProfile | null): FireWeather {
  const elev = prof.z[0]
  const tAt = (p: number) => interpProfile(prof, 't', p)
  const tdAt = (p: number) => interpProfile(prof, 'td', p)

  let variant: FireWeather['hainesVariant']
  let a: number
  let b: number
  if (elev < 305) {
    variant = 'low'
    a = tAt(950) - tAt(850)
    b = tAt(850) - tdAt(850)
  } else if (elev < 915) {
    variant = 'mid'
    a = tAt(850) - tAt(700)
    b = tAt(850) - tdAt(850)
  } else {
    variant = 'high'
    a = tAt(700) - tAt(500)
    b = tAt(700) - tdAt(700)
  }
  const score = (v: number, lo: number, hi: number) => (v < lo ? 1 : v <= hi ? 2 : 3)
  let haines: number
  if (variant === 'low') haines = score(a, 4, 7) + score(b, 6, 9)
  else if (variant === 'mid') haines = score(a, 6, 10) + score(b, 6, 12)
  else haines = score(a, 18, 21) + score(b, 15, 20)

  const mixTop = thermalTop(prof, prof.t[0])
  const mixingHeight = Math.max(0, mixTop - elev)
  const transportWind = wind ? meanWind(wind, 0, Math.max(mixingHeight, 100)) : { u: NaN, v: NaN }
  return { haines, hainesVariant: variant, mixingHeight, transportWind }
}

export interface DGZ {
  topP: number
  bottomP: number
  depth: number
  meanRH: number
}

/** Dendritic growth zone: the −12 °C to −18 °C layer. */
export function dendriticGrowthZone(prof: EnvProfile): DGZ | null {
  let bottomP = NaN
  let topP = NaN
  for (let p = prof.p[0]; p >= prof.p[prof.p.length - 1]; p -= 5) {
    const t = interpProfile(prof, 't', p)
    if (!Number.isFinite(bottomP) && t <= -12) bottomP = p
    if (!Number.isFinite(topP) && t <= -18) {
      topP = p
      break
    }
  }
  if (!Number.isFinite(bottomP) || !Number.isFinite(topP)) return null
  let sumRH = 0
  let n = 0
  for (let p = bottomP; p >= topP; p -= 5) {
    const t = interpProfile(prof, 't', p)
    const td = interpProfile(prof, 'td', p)
    sumRH += 100 * (satMixingRatio(td, p) / satMixingRatio(t, p))
    n++
  }
  return {
    topP,
    bottomP,
    depth: interpProfile(prof, 'z', topP) - interpProfile(prof, 'z', bottomP),
    meanRH: sumRH / Math.max(n, 1),
  }
}

export interface AtmosLayer {
  kind: 'cloud' | 'icing'
  topP: number
  bottomP: number
  topZ: number
  bottomZ: number
}

/** Saturated (RH ≥ 87 %) layers → cloud; the sub-freezing 0…−20 °C portion of
 *  a cloud layer → airframe icing risk. Merges gaps < 300 m, drops slivers. */
export function detectLayers(prof: EnvProfile): AtmosLayer[] {
  interface Raw { bottomP: number; topP: number }
  const clouds: Raw[] = []
  let cur: Raw | null = null
  const step = 5
  for (let p = prof.p[0]; p >= prof.p[prof.p.length - 1]; p -= step) {
    const t = interpProfile(prof, 't', p)
    const td = interpProfile(prof, 'td', p)
    const rh = 100 * (satMixingRatio(td, p) / satMixingRatio(t, p))
    if (rh >= 87) {
      if (!cur) cur = { bottomP: p, topP: p }
      else cur.topP = p
    } else if (cur) {
      clouds.push(cur)
      cur = null
    }
  }
  if (cur) clouds.push(cur)

  const zAt = (p: number) => interpProfile(prof, 'z', p)
  // merge close layers
  const merged: Raw[] = []
  for (const c of clouds) {
    const prev = merged[merged.length - 1]
    if (prev && zAt(c.bottomP) - zAt(prev.topP) < 300) prev.topP = c.topP
    else merged.push({ ...c })
  }

  const out: AtmosLayer[] = []
  for (const c of merged) {
    const bz = zAt(c.bottomP)
    const tz = zAt(c.topP)
    if (tz - bz < 150) continue
    out.push({ kind: 'cloud', bottomP: c.bottomP, topP: c.topP, bottomZ: bz, topZ: tz })
    // icing sub-layer
    let iceBot = NaN
    let iceTop = NaN
    for (let p = c.bottomP; p >= c.topP; p -= step) {
      const t = interpProfile(prof, 't', p)
      if (t <= 0 && t >= -20) {
        if (!Number.isFinite(iceBot)) iceBot = p
        iceTop = p
      }
    }
    if (Number.isFinite(iceBot) && Number.isFinite(iceTop) && iceBot !== iceTop) {
      out.push({
        kind: 'icing', bottomP: iceBot, topP: iceTop,
        bottomZ: zAt(iceBot), topZ: zAt(iceTop),
      })
    }
  }
  return out.slice(0, 12)
}
