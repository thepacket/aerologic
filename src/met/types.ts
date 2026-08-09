/** One observed or forecast level. SI-ish units chosen for computation:
 *  pressure hPa, height m MSL, temperatures °C, mixing ratio g/kg,
 *  wind m/s with u/v in math convention (u east+, v north+). */
export interface Level {
  p: number
  /** geopotential height, m MSL */
  z: number
  /** temperature °C */
  t: number
  /** dewpoint °C (NaN if missing) */
  td: number
  /** relative humidity % (NaN if missing) */
  rh: number
  /** mixing ratio g/kg (NaN if missing) */
  mr: number
  /** wind direction, meteorological degrees FROM (NaN if missing) */
  wdir: number
  /** wind speed m/s (NaN if missing) */
  wspd: number
  /** u wind component m/s (NaN if missing) */
  u: number
  /** v wind component m/s (NaN if missing) */
  v: number
  /** balloon position if available (BUFR high-res) */
  lat?: number
  lon?: number
  /** seconds since launch if available */
  dt?: number
  /** frost point °C, if reported (BUFR) */
  tice?: number
  /** RH with respect to ice %, if reported (BUFR) */
  rhIce?: number
}

export interface StationInfo {
  id: string
  name: string
  lat: number
  lon: number
  /** station elevation m MSL (taken from first level) */
  elev: number
  src?: string
}

export type SoundingSource =
  | { kind: 'obs'; archive: 'wyoming'; src: string }
  | { kind: 'forecast'; model: string; runTime?: string }

export interface Sounding {
  station: StationInfo
  /** nominal cycle time, ISO UTC */
  validTime: string
  /** actual launch time if known (BUFR first sample), ISO UTC */
  launchTime?: string
  source: SoundingSource
  /** levels sorted by decreasing pressure (ground first) */
  levels: Level[]
}
