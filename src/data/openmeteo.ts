import type { Level, Sounding } from '../met/types'
import { dewpointFromRH, relHumidity, mixingRatio } from '../met/thermo'
import { uvFromDirSpeed } from '../met/kinematics'

export const OM_LEVELS = [
  1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30,
] as const

export const OM_MODELS = [
  { id: 'best_match', label: 'Best match' },
  { id: 'gfs_seamless', label: 'NOAA GFS' },
  { id: 'gfs_hrrr', label: 'NOAA HRRR' },
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS 0.25°' },
  { id: 'icon_seamless', label: 'DWD ICON' },
  { id: 'gem_seamless', label: 'CMC GEM' },
  { id: 'meteofrance_seamless', label: 'Météo-France' },
  { id: 'ukmo_seamless', label: 'UK Met Office' },
] as const

export interface ForecastData {
  lat: number
  lon: number
  elevation: number
  model: string
  /** ISO hour strings (UTC) */
  hours: string[]
  /** model-reported CAPE/CIN/LI/freezing level per hour (for comparison) */
  modelCape: number[]
  modelCin: number[]
  modelLI: number[]
  modelFzl: number[]
  raw: Record<string, number[]>
  surface: {
    t: number[]
    rh: number[]
    p: number[] // surface pressure hPa
    wspd: number[]
    wdir: number[]
  }
}

export async function fetchForecast(
  lat: number,
  lon: number,
  model: string,
): Promise<ForecastData> {
  const vars: string[] = []
  for (const lv of OM_LEVELS) {
    vars.push(
      `temperature_${lv}hPa`,
      `relative_humidity_${lv}hPa`,
      `wind_speed_${lv}hPa`,
      `wind_direction_${lv}hPa`,
      `geopotential_height_${lv}hPa`,
    )
  }
  vars.push(
    'temperature_2m', 'relative_humidity_2m', 'surface_pressure',
    'wind_speed_10m', 'wind_direction_10m',
    'cape', 'convective_inhibition', 'lifted_index', 'freezing_level_height',
  )
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${vars.join(',')}` +
    `&models=${model}&forecast_days=7&past_days=1&wind_speed_unit=ms&timezone=UTC`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`)
  const json = await res.json()
  const h = json.hourly
  if (!h?.time) throw new Error('Open-Meteo: empty response')
  return {
    lat: json.latitude,
    lon: json.longitude,
    elevation: json.elevation ?? 0,
    model,
    hours: h.time,
    modelCape: h.cape ?? [],
    modelCin: h.convective_inhibition ?? [],
    modelLI: h.lifted_index ?? [],
    modelFzl: h.freezing_level_height ?? [],
    raw: h,
    surface: {
      t: h.temperature_2m ?? [],
      rh: h.relative_humidity_2m ?? [],
      p: h.surface_pressure ?? [],
      wspd: h.wind_speed_10m ?? [],
      wdir: h.wind_direction_10m ?? [],
    },
  }
}

/** Assemble a Sounding for one forecast hour. */
export function forecastSounding(
  fc: ForecastData,
  hourIdx: number,
  stationName: string,
): Sounding | null {
  const levels: Level[] = []
  const h = fc.raw

  // surface level first
  const pSfc = fc.surface.p[hourIdx]
  if (Number.isFinite(pSfc)) {
    const t = fc.surface.t[hourIdx]
    const rh = fc.surface.rh[hourIdx]
    const td = dewpointFromRH(t, rh)
    const wdir = fc.surface.wdir[hourIdx]
    const wspd = fc.surface.wspd[hourIdx]
    const { u, v } = uvFromDirSpeed(wdir, wspd)
    levels.push({
      p: pSfc, z: fc.elevation + 2, t, td, rh,
      mr: mixingRatio(td, pSfc) * 1000,
      wdir, wspd, u, v,
    })
  }

  for (const lv of OM_LEVELS) {
    if (levels.length && lv >= (levels[0]?.p ?? Infinity)) continue // below ground
    const t = h[`temperature_${lv}hPa`]?.[hourIdx]
    const rh = h[`relative_humidity_${lv}hPa`]?.[hourIdx]
    const z = h[`geopotential_height_${lv}hPa`]?.[hourIdx]
    const wspd = h[`wind_speed_${lv}hPa`]?.[hourIdx]
    const wdir = h[`wind_direction_${lv}hPa`]?.[hourIdx]
    if (!Number.isFinite(t) || !Number.isFinite(z)) continue
    const td = Number.isFinite(rh) ? dewpointFromRH(t, Math.max(rh!, 0.5)) : NaN
    const { u, v } =
      Number.isFinite(wdir) && Number.isFinite(wspd)
        ? uvFromDirSpeed(wdir!, wspd!)
        : { u: NaN, v: NaN }
    levels.push({
      p: lv,
      z: z!,
      t: t!,
      td,
      rh: Number.isFinite(rh) ? rh! : NaN,
      mr: Number.isFinite(td) ? mixingRatio(td, lv) * 1000 : NaN,
      wdir: wdir ?? NaN,
      wspd: wspd ?? NaN,
      u, v,
    })
  }

  if (levels.length < 5) return null
  return {
    station: {
      id: 'FCST',
      name: stationName,
      lat: fc.lat,
      lon: fc.lon,
      elev: fc.elevation,
    },
    validTime: fc.hours[hourIdx] + ':00Z',
    source: { kind: 'forecast', model: fc.model },
    levels,
  }
}

export { relHumidity }
