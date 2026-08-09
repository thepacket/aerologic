/** Winter precipitation diagnostics.
 *
 *  Precip type follows Bourgouin (2000, Wea. Forecasting): melting and
 *  refreezing "energy areas" between the temperature profile and the 0 °C
 *  isotherm (J/kg, computed as Rd·T̄·Δln p like a CAPE integral) classify
 *  SN / RA / FZRA / IP and the mixes. Snow-liquid ratio uses the Kuchera
 *  method (max column temperature). */
import type { EnvProfile } from './parcel'
import { interpProfile } from './parcel'
import { Rd } from './thermo'

export interface WinterDiag {
  /** classification, e.g. 'SN', 'RA', 'FZRA', 'IP', 'RA/SN', 'FZRA/IP' */
  ptype: string
  /** melting energy of the elevated warm layer, J/kg */
  paAloft: number
  /** refreezing energy of the sub-warm-layer cold layer, J/kg */
  naRefreeze: number
  /** energy of the surface-based warm layer, J/kg */
  paSfc: number
  /** warm nose (max T aloft above a freezing level), if any */
  warmNoseT: number
  warmNoseP: number
  /** Kuchera snow-liquid ratio (meaningful when snow is possible) */
  kuchera: number
}

const P_STEP = 5
const P_CEIL = 300 // precip processes of interest live below this

export function winterDiagnostics(prof: EnvProfile): WinterDiag {
  const pSfc = prof.p[0]
  const pTop = Math.max(prof.p[prof.p.length - 1], P_CEIL)

  // Walk upward, splitting the column into contiguous above/below-freezing
  // layers with their energies (J/kg, positive for warm).
  interface Layer { warm: boolean; energy: number; pBot: number; pTop: number; maxT: number }
  const layers: Layer[] = []
  let prevP = pSfc
  let prevT = prof.t[0]
  const push = (warm: boolean, e: number, pBot: number, pT: number, maxT: number) => {
    const last = layers[layers.length - 1]
    if (last && last.warm === warm) {
      last.energy += e
      last.pTop = pT
      last.maxT = Math.max(last.maxT, maxT)
    } else {
      layers.push({ warm, energy: e, pBot, pTop: pT, maxT })
    }
  }
  for (let p = pSfc - P_STEP; p >= pTop; p -= P_STEP) {
    const t = interpProfile(prof, 't', p)
    const tBar = (prevT + t) / 2
    const dlnp = Math.log(prevP / p)
    // split exactly at a 0 °C crossing for cleaner energies
    if ((prevT > 0 && t <= 0) || (prevT <= 0 && t > 0)) {
      const f = prevT / (prevT - t)
      const pX = Math.exp(Math.log(prevP) - f * Math.log(prevP / p))
      push(prevT > 0, Rd * (prevT / 2) * Math.log(prevP / pX), prevP, pX, Math.max(prevT, 0))
      push(t > 0, Rd * (t / 2) * Math.log(pX / p), pX, p, Math.max(t, 0))
    } else {
      push(tBar > 0, Rd * tBar * dlnp, prevP, p, Math.max(prevT, t))
    }
    prevP = p
    prevT = t
  }

  // Identify: surface-based warm layer, first elevated warm layer, and the
  // cold layer between the elevated warm layer and the ground.
  const sfcWarm = layers.length > 0 && layers[0].warm ? layers[0] : null
  let aloftWarm: Layer | null = null
  let refreeze: Layer | null = null
  for (let i = sfcWarm ? 1 : 0; i < layers.length; i++) {
    if (layers[i].warm) {
      aloftWarm = layers[i]
      // refreezing layer = the cold layer(s) beneath it down to sfc/warm sfc
      refreeze = layers[i - 1] ?? null
      break
    }
  }

  const paSfc = sfcWarm ? sfcWarm.energy : 0
  const paAloft = aloftWarm ? aloftWarm.energy : 0
  const naRefreeze = refreeze ? -refreeze.energy : 0

  // Bourgouin classification
  let ptype: string
  if (!sfcWarm && !aloftWarm) {
    ptype = 'SN'
  } else if (aloftWarm && !sfcWarm) {
    // melting aloft, refreezing below
    if (paAloft < 2) ptype = 'SN'
    else if (naRefreeze > 66 + 0.66 * paAloft) ptype = 'IP'
    else if (naRefreeze < 46 + 0.66 * paAloft) ptype = 'FZRA'
    else ptype = 'FZRA/IP'
  } else if (sfcWarm && !aloftWarm) {
    if (paSfc < 5.6) ptype = 'SN'
    else if (paSfc > 13.2) ptype = 'RA'
    else ptype = 'RA/SN'
  } else {
    // warm aloft AND warm surface with a cold layer between
    if (paSfc > 13.2) ptype = 'RA'
    else if (naRefreeze > 66 + 0.66 * paAloft) ptype = 'IP'
    else if (naRefreeze < 46 + 0.66 * paAloft) ptype = 'FZRA'
    else ptype = 'FZRA/IP'
  }

  // warm nose readout
  let warmNoseT = NaN
  let warmNoseP = NaN
  if (aloftWarm) {
    warmNoseT = aloftWarm.maxT
    // locate the pressure of that max within the layer
    let bestT = -Infinity
    for (let p = aloftWarm.pBot; p >= aloftWarm.pTop; p -= P_STEP) {
      const t = interpProfile(prof, 't', p)
      if (t > bestT) {
        bestT = t
        warmNoseP = p
      }
    }
  }

  // Kuchera SLR from the column-max temperature (K) below ~500 hPa
  let maxTK = -Infinity
  for (let p = pSfc; p >= Math.max(500, pTop); p -= P_STEP) {
    const t = interpProfile(prof, 't', p) + 273.15
    if (t > maxTK) maxTK = t
  }
  const kuchera = Math.max(
    0,
    maxTK > 271.16 ? 12 + 2 * (271.16 - maxTK) : 12 + (271.16 - maxTK),
  )

  return { ptype, paAloft, naRefreeze, paSfc, warmNoseT, warmNoseP, kuchera }
}
