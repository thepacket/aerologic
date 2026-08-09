/** Effective inflow layer (Thompson et al. 2007): the contiguous layer of
 *  parcels with CAPE ≥ 100 J/kg and CIN ≥ −250 J/kg, searched upward from the
 *  surface. Basis for the effective SRH / effective bulk wind difference used
 *  in the SPC composite parameters. */
import type { EnvProfile, ParcelResult } from './parcel'
import { interpProfile, liftParcel } from './parcel'
import type { WindProfile } from './kinematics'
import { bulkShear, srh } from './kinematics'

export interface EffectiveLayer {
  bottomP: number
  topP: number
  bottomZ: number
  topZ: number
}

const CAPE_MIN = 100
const CIN_MIN = -250

export function effectiveInflowLayer(prof: EnvProfile): EffectiveLayer | null {
  const pSfc = prof.p[0]
  const pFloor = Math.max(prof.p[prof.p.length - 1], pSfc - 400)
  const step = 20 // hPa search resolution

  const qualifies = (p: number): boolean => {
    const t = interpProfile(prof, 't', p)
    const td = interpProfile(prof, 'td', p)
    const r = liftParcel(prof, 'sb', p, t, td)
    return r.cape >= CAPE_MIN && r.cin >= CIN_MIN
  }

  // find the bottom
  let bottomP = NaN
  for (let p = pSfc; p >= pFloor; p -= step) {
    if (qualifies(p)) {
      bottomP = p
      break
    }
  }
  if (!Number.isFinite(bottomP)) return null

  // walk up until a parcel fails
  let topP = bottomP
  for (let p = bottomP - step; p >= pFloor; p -= step) {
    if (qualifies(p)) topP = p
    else break
  }

  return {
    bottomP,
    topP,
    bottomZ: interpProfile(prof, 'z', bottomP),
    topZ: interpProfile(prof, 'z', topP),
  }
}

export interface EffectiveKinematics {
  esrh: number
  /** effective bulk wind difference, m/s (EIL bottom → 50 % of MU EL height) */
  ebwd: number
  scpEff: number
  stpEff: number
}

export function effectiveKinematics(
  eil: EffectiveLayer | null,
  wind: WindProfile | null,
  mu: ParcelResult,
  ml: ParcelResult,
  elev: number,
  stormMotion: { u: number; v: number },
): EffectiveKinematics {
  let esrh = NaN
  let ebwd = NaN
  if (eil && wind) {
    esrh = srh(wind, eil.bottomZ - elev, eil.topZ - elev, stormMotion)
    if (Number.isFinite(mu.elZ)) {
      const halfEL = (mu.elZ - elev) / 2
      if (halfEL > eil.bottomZ - elev) {
        ebwd = bulkShear(wind, eil.bottomZ - elev, halfEL).mag
      }
    }
  }

  // SPC effective composites
  let scpEff = NaN
  if (Number.isFinite(esrh) && Number.isFinite(ebwd)) {
    const shearTerm = ebwd < 10 ? 0 : ebwd > 20 ? 1.5 : ebwd / 20
    scpEff = (mu.cape / 1000) * (Math.max(0, esrh) / 50) * shearTerm *
      (mu.cin > -40 ? 1 : -40 / mu.cin)
  }
  let stpEff = NaN
  if (Number.isFinite(esrh) && Number.isFinite(ebwd)) {
    const lclAGL = ml.lclZ - elev
    const lclTerm = lclAGL < 1000 ? 1 : lclAGL > 2000 ? 0 : (2000 - lclAGL) / 1000
    const cinTerm = ml.cin > -50 ? 1 : ml.cin < -200 ? 0 : (200 + ml.cin) / 150
    const shearTerm = ebwd < 12.5 ? 0 : ebwd > 30 ? 1.5 : ebwd / 20
    stpEff = (ml.cape / 1500) * lclTerm * (Math.max(0, esrh) / 150) * shearTerm * cinTerm
  }
  return { esrh, ebwd, scpEff, stpEff }
}
