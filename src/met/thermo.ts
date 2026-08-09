/** Core moist thermodynamics. Formulas follow Bolton (1980, MWR 108) unless
 *  noted; temperatures in °C at the API surface, Kelvin internally. */

export const Rd = 287.04 // J kg⁻¹ K⁻¹ dry air gas constant
export const Rv = 461.5
export const Cpd = 1005.7 // J kg⁻¹ K⁻¹ dry air specific heat (const p)
export const EPS = Rd / Rv // 0.622
export const KAPPA = 0.2854 // Rd/Cpd with moisture correction per Bolton
export const G = 9.80665
export const P0 = 1000 // hPa reference

export const C2K = (c: number) => c + 273.15
export const K2C = (k: number) => k - 273.15

/** Saturation vapor pressure over liquid water, hPa (Bolton eq. 10). t in °C. */
export function satVaporPressure(t: number): number {
  return 6.112 * Math.exp((17.67 * t) / (t + 243.5))
}

/** Vapor pressure from dewpoint, hPa. */
export const vaporPressure = (td: number) => satVaporPressure(td)

/** Mixing ratio (kg/kg) from vapor pressure e and total pressure p (both hPa). */
export function mixingRatioFromE(e: number, p: number): number {
  return (EPS * e) / (p - e)
}

/** Saturation mixing ratio kg/kg. */
export const satMixingRatio = (t: number, p: number) => mixingRatioFromE(satVaporPressure(t), p)

/** Mixing ratio kg/kg from dewpoint. */
export const mixingRatio = (td: number, p: number) => mixingRatioFromE(vaporPressure(td), p)

/** Dewpoint °C from mixing ratio w (kg/kg) and pressure hPa — inverse of Bolton eq. 10. */
export function dewpointFromMixingRatio(w: number, p: number): number {
  const e = (w * p) / (EPS + w)
  const ln = Math.log(e / 6.112)
  return (243.5 * ln) / (17.67 - ln)
}

/** Potential temperature, K. t °C, p hPa. */
export function theta(t: number, p: number): number {
  return C2K(t) * Math.pow(P0 / p, KAPPA)
}

/** Temperature °C on the dry adiabat of potential temperature th (K) at p hPa. */
export function tempOnDryAdiabat(th: number, p: number): number {
  return K2C(th * Math.pow(p / P0, KAPPA))
}

/** Virtual temperature, K, from t (°C) and mixing ratio w (kg/kg). */
export function virtualTempK(t: number, w: number): number {
  return C2K(t) * (1 + w / EPS) / (1 + w)
}

/** LCL temperature (K) from t, td in °C — Bolton eq. 15. */
export function lclTemperatureK(t: number, td: number): number {
  const tk = C2K(t)
  const tdk = C2K(td)
  return 1 / (1 / (tdk - 56) + Math.log(tk / tdk) / 800) + 56
}

/** LCL pressure (hPa) lifting from (p, t, td). Conserves theta. */
export function lclPressure(p: number, t: number, td: number): number {
  const tlcl = lclTemperatureK(t, td)
  return p * Math.pow(tlcl / C2K(t), 1 / KAPPA)
}

/** Equivalent potential temperature θe, K — Bolton eq. 43 (pseudoadiabatic). */
export function thetaE(t: number, td: number, p: number): number {
  const tk = C2K(t)
  const e = vaporPressure(td)
  const w = mixingRatioFromE(e, p) // kg/kg
  const tlcl = lclTemperatureK(t, td)
  const thDL = tk * Math.pow(P0 / (p - e), KAPPA) * Math.pow(tk / tlcl, 0.28 * w)
  return thDL * Math.exp((3036 / tlcl - 1.78) * w * (1 + 0.448 * w))
}

/** dT/dp (°C per hPa) along a pseudoadiabat at (t °C, p hPa).
 *  Standard saturated adiabatic lapse rate expression. */
export function moistLapseDTdp(t: number, p: number): number {
  const tk = C2K(t)
  const ws = satMixingRatio(t, p)
  const L = 2.501e6 - 2370 * t // latent heat J/kg with weak T dependence
  const num = (Rd * tk + L * ws) / p // note p in hPa cancels: dT/dp in K/hPa
  const den = Cpd + (L * L * ws * EPS) / (Rd * tk * tk)
  return num / den
}

/** Integrate a pseudoadiabat from (p0, t0) to pressure p1 (hPa) with RK4 in p.
 *  Handles ascent (p1<p0) and descent (p1>p0). Step ≤ 2 hPa. */
export function moistAdiabatTemp(p0: number, t0: number, p1: number): number {
  if (p0 === p1) return t0
  const n = Math.max(2, Math.ceil(Math.abs(p1 - p0) / 2))
  const h = (p1 - p0) / n
  let t = t0
  let p = p0
  for (let i = 0; i < n; i++) {
    const k1 = moistLapseDTdp(t, p)
    const k2 = moistLapseDTdp(t + (h / 2) * k1, p + h / 2)
    const k3 = moistLapseDTdp(t + (h / 2) * k2, p + h / 2)
    const k4 = moistLapseDTdp(t + h * k3, p + h)
    t += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
    p += h
  }
  return t
}

/** Wet-bulb temperature °C via Normand's rule: lift to LCL dry-adiabatically,
 *  then bring back down the pseudoadiabat to the original pressure. */
export function wetBulb(t: number, td: number, p: number): number {
  if (!(td <= t)) return t
  const plcl = lclPressure(p, t, td)
  const tlcl = K2C(lclTemperatureK(t, td))
  return moistAdiabatTemp(plcl, tlcl, p)
}

/** Relative humidity % from t, td. */
export function relHumidity(t: number, td: number): number {
  return 100 * (vaporPressure(td) / satVaporPressure(t))
}

/** Dewpoint from t °C and RH %. */
export function dewpointFromRH(t: number, rh: number): number {
  const e = (satVaporPressure(t) * rh) / 100
  const ln = Math.log(e / 6.112)
  return (243.5 * ln) / (17.67 - ln)
}
