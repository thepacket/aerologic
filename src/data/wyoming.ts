import type { Level, Sounding, StationInfo } from '../met/types'
import { relHumidity, dewpointFromRH } from '../met/thermo'
import { uvFromDirSpeed } from '../met/kinematics'

export interface WyoStation {
  stationid: string
  name: string
  lat: number
  lon: number
  src: string
}

export interface StationListResult {
  datetime: string
  stations: WyoStation[]
}

/** Format a Date (UTC) as the archive's "YYYY-MM-DD HH:00:00". */
export function cycleString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:00:00`
}

/** Most recent cycle (00Z/12Z) that is likely to have data: balloons report
 *  ~1–2 h after launch, so back off until cycle time + 75 min has passed. */
export function latestCycle(now = new Date()): Date {
  const d = new Date(now)
  d.setUTCMinutes(0, 0, 0)
  const h = d.getUTCHours()
  d.setUTCHours(h >= 12 ? 12 : 0)
  if (now.getTime() - d.getTime() < 75 * 60 * 1000) {
    d.setUTCHours(d.getUTCHours() - 12)
  }
  return d
}

export async function fetchStationList(cycle: string): Promise<StationListResult> {
  const res = await fetch(`/api/wyo/stations?datetime=${encodeURIComponent(cycle)}`)
  if (!res.ok) throw new Error(`station list: HTTP ${res.status}`)
  const json = await res.json()
  return { datetime: json.datetime, stations: json.stations ?? [] }
}

/** Fetch and parse one sounding as CSV. Throws with a readable message when
 *  the archive has nothing for that station/time. */
export async function fetchWyomingSounding(
  station: WyoStation,
  cycle: string,
): Promise<Sounding> {
  const src = station.src || 'BUFR'
  const url = `/api/wyo/sounding?datetime=${encodeURIComponent(cycle)}&id=${encodeURIComponent(
    station.stationid,
  )}&type=TEXT:CSV&src=${encodeURIComponent(src)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`sounding: HTTP ${res.status}`)
  const text = await res.text()
  if (!text.startsWith('time,')) {
    throw new Error(`No data for ${station.stationid} at ${cycle} UTC`)
  }
  return parseWyomingCSV(text, station, cycle, src)
}

/** CSV columns:
 * time, longitude, latitude, pressure_hPa, geopotential height_m,
 * temperature_C, dew point temperature_C, ice point temperature_C,
 * relative humidity_%, humidity wrt ice_%, mixing ratio_g/kg,
 * wind direction_degree, wind speed_m/s
 */
export function parseWyomingCSV(
  text: string,
  station: WyoStation,
  cycle: string,
  src: string,
): Sounding {
  const lines = text.trim().split('\n')
  const levels: Level[] = []
  let launchEpoch = NaN
  let lastP = Infinity

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    if (c.length < 13) continue
    const num = (s: string) => {
      const v = parseFloat(s)
      return Number.isFinite(v) ? v : NaN
    }
    const p = num(c[3])
    if (!Number.isFinite(p) || p <= 0) continue
    // enforce monotone ascent (some TEMP files repeat or backtrack)
    if (p >= lastP) continue
    lastP = p

    const epoch = Date.parse(c[0].replace(' ', 'T') + 'Z')
    if (Number.isNaN(launchEpoch) && !Number.isNaN(epoch)) launchEpoch = epoch

    const t = num(c[5])
    let td = num(c[6])
    let rh = num(c[8])
    let mr = num(c[10])
    if (!Number.isFinite(td) && Number.isFinite(rh) && Number.isFinite(t)) {
      td = dewpointFromRH(t, rh)
    }
    if (!Number.isFinite(rh) && Number.isFinite(t) && Number.isFinite(td)) {
      rh = relHumidity(t, td)
    }
    const wdir = num(c[11])
    const wspd = num(c[12])
    const { u, v } =
      Number.isFinite(wdir) && Number.isFinite(wspd) ? uvFromDirSpeed(wdir, wspd) : { u: NaN, v: NaN }

    levels.push({
      p,
      z: num(c[4]),
      t,
      td,
      rh,
      mr,
      wdir,
      wspd,
      u,
      v,
      lat: num(c[2]),
      lon: num(c[1]),
      dt: Number.isNaN(epoch) || Number.isNaN(launchEpoch) ? undefined : (epoch - launchEpoch) / 1000,
      tice: num(c[7]),
      rhIce: num(c[9]),
    })
  }

  if (levels.length < 5) throw new Error(`Sounding for ${station.stationid} has too few levels`)

  return {
    station: {
      id: station.stationid,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      elev: levels[0].z,
      src,
    },
    validTime: cycle.replace(' ', 'T') + 'Z',
    launchTime: Number.isNaN(launchEpoch) ? undefined : new Date(launchEpoch).toISOString(),
    source: { kind: 'obs', archive: 'wyoming', src },
    levels,
  }
}

export type { StationInfo }
