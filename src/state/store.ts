import { create } from 'zustand'
import type { Sounding } from '../met/types'
import type { Analysis } from '../met/indices'
import { analyzeSounding } from '../met/indices'
import type { ParcelKind } from '../met/parcel'
import type { StationListResult, WyoStation } from '../data/wyoming'
import { cycleString, fetchStationList, fetchWyomingSounding, latestCycle } from '../data/wyoming'
import type { ForecastData } from '../data/openmeteo'
import { fetchForecast, forecastSounding } from '../data/openmeteo'
import { mixingRatio, relHumidity } from '../met/thermo'

export type Mode = 'obs' | 'fcst'
export type WindUnit = 'kt' | 'ms' | 'kmh'
export type StageView = 'skewt' | 'th'
export type ThField = 'rh' | 'thetae' | 'temp' | 'wind'

/** One profile modification: a Gaussian temperature or dewpoint nudge
 *  centered at pressure p (σ = 45 hPa). */
export interface SoundingEdit {
  curve: 't' | 'td'
  p: number
  delta: number
}

const EDIT_SIGMA = 45

function applyEdits(base: Sounding, edits: SoundingEdit[]): Sounding {
  if (edits.length === 0) return base
  const levels = base.levels.map((l) => {
    let dT = 0
    let dTd = 0
    for (const e of edits) {
      const w = Math.exp(-(((l.p - e.p) / EDIT_SIGMA) ** 2))
      if (e.curve === 't') dT += e.delta * w
      else dTd += e.delta * w
    }
    if (dT === 0 && dTd === 0) return l
    const t = l.t + dT
    const td = Math.min(l.td + dTd, t)
    return {
      ...l,
      t,
      td,
      rh: Number.isFinite(td) ? relHumidity(t, td) : l.rh,
      mr: Number.isFinite(td) ? mixingRatio(td, l.p) * 1000 : l.mr,
    }
  })
  return { ...base, levels }
}

const FAV_KEY = 'skewt:favorites'
const RECENT_KEY = 'skewt:recents'
const ADJUST_KEY = 'skewt:th-adjust'

function loadAdjust(): { b: number; c: number } {
  try {
    const v = JSON.parse(localStorage.getItem(ADJUST_KEY) ?? '{}')
    const clamp = (x: unknown) =>
      typeof x === 'number' && Number.isFinite(x) ? Math.min(Math.max(x, 0.5), 2) : 1
    return { b: clamp(v.b), c: clamp(v.c) }
  } catch {
    return { b: 1, c: 1 }
  }
}
const loadIds = (k: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '[]')
  } catch {
    return []
  }
}

export interface Overlays {
  parcel: boolean
  capeShade: boolean
  wetBulb: boolean
  virtualTemp: boolean
  mixingLines: boolean
  dryAdiabats: boolean
  moistAdiabats: boolean
  windBarbs: boolean
  heightLabels: boolean
}

export interface HoverState {
  p: number
  z: number
}

interface AppState {
  mode: Mode
  cycle: Date
  stations: WyoStation[]
  stationsCycleLabel: string
  stationFilter: string
  selected: WyoStation | null
  sounding: Sounding | null
  analysis: Analysis | null
  loading: boolean
  error: string | null

  // forecast mode
  forecast: ForecastData | null
  forecastHour: number
  model: string
  fcstLoading: boolean
  /** additional models overlaid for comparison, id → data (null = loading) */
  compareModels: string[]
  compareData: Record<string, ForecastData | null>

  parcelKind: ParcelKind
  windUnit: WindUnit
  overlays: Overlays
  hover: HoverState | null
  /** pressure zoom domain [pBottom, pTop] hPa */
  pDomain: [number, number]
  leftOpen: boolean
  rightOpen: boolean

  // sounding modification
  baseSounding: Sounding | null
  edits: SoundingEdit[]
  editMode: boolean

  // pinned reference overlay
  reference: { sounding: Sounding; label: string } | null

  favorites: string[]
  recents: string[]

  // stage visualization (time-height is forecast-mode only)
  stageView: StageView
  thField: ThField
  /** heatmap display adjustments (1 = neutral) */
  thBrightness: number
  thContrast: number

  setMode: (m: Mode) => void
  setCycle: (d: Date) => Promise<void>
  loadStations: () => Promise<void>
  selectStation: (s: WyoStation) => Promise<void>
  setStationFilter: (f: string) => void
  setParcelKind: (k: ParcelKind) => void
  setWindUnit: (u: WindUnit) => void
  toggleOverlay: (k: keyof Overlays) => void
  setHover: (h: HoverState | null) => void
  setPDomain: (d: [number, number]) => void
  setForecastHour: (i: number) => void
  setModel: (m: string) => Promise<void>
  toggleLeft: () => void
  toggleRight: () => void
  refreshForecast: () => Promise<void>

  toggleEditMode: () => void
  beginEdit: (curve: 't' | 'td', p: number) => void
  updateEdit: (delta: number) => void
  endEdit: () => void
  resetEdits: () => void
  pinReference: () => void
  clearReference: () => void
  toggleFavorite: (id: string) => void
  setStageView: (v: StageView) => void
  setThField: (f: ThField) => void
  setThAdjust: (brightness: number, contrast: number) => void
  toggleCompareModel: (id: string) => Promise<void>
}

const DEFAULT_DOMAIN: [number, number] = [1050, 100]

function applySounding(set: (p: Partial<AppState>) => void, snd: Sounding | null, err?: string) {
  if (!snd) {
    set({ sounding: null, baseSounding: null, edits: [], analysis: null, error: err ?? 'no data', loading: false })
    return
  }
  const analysis = analyzeSounding(snd)
  set({ sounding: snd, baseSounding: snd, edits: [], analysis, error: null, loading: false, hover: null })
}

export const useStore = create<AppState>((set, get) => ({
  mode: 'obs',
  cycle: latestCycle(),
  stations: [],
  stationsCycleLabel: '',
  stationFilter: '',
  selected: null,
  sounding: null,
  analysis: null,
  loading: false,
  error: null,

  forecast: null,
  forecastHour: 0,
  model: 'best_match',
  fcstLoading: false,
  compareModels: [],
  compareData: {},

  parcelKind: 'mu',
  windUnit: 'kt',
  overlays: {
    parcel: true,
    capeShade: true,
    wetBulb: false,
    virtualTemp: false,
    mixingLines: true,
    dryAdiabats: true,
    moistAdiabats: true,
    windBarbs: true,
    heightLabels: true,
  },
  hover: null,
  pDomain: DEFAULT_DOMAIN,
  leftOpen: true,
  rightOpen: true,

  baseSounding: null,
  edits: [],
  editMode: false,
  reference: null,
  favorites: loadIds(FAV_KEY),
  recents: loadIds(RECENT_KEY),
  stageView: 'skewt',
  thField: 'rh',
  thBrightness: loadAdjust().b,
  thContrast: loadAdjust().c,

  setMode: (mode) => {
    set({ mode })
    const st = get()
    if (mode === 'fcst' && st.selected && !st.forecast) void st.refreshForecast()
    if (mode === 'obs' && st.selected) void st.selectStation(st.selected)
    if (mode === 'fcst' && st.forecast) {
      const snd = forecastSounding(st.forecast, st.forecastHour, st.selected?.name ?? 'Point')
      applySounding(set, snd)
    }
  },

  setCycle: async (d) => {
    set({ cycle: d })
    await get().loadStations()
    const sel = get().selected
    if (sel && get().mode === 'obs') await get().selectStation(sel)
  },

  loadStations: async () => {
    const cyc = cycleString(get().cycle)
    try {
      const res: StationListResult = await fetchStationList(cyc)
      set({ stations: res.stations, stationsCycleLabel: res.datetime })
    } catch (e) {
      set({ error: String(e instanceof Error ? e.message : e) })
    }
  },

  selectStation: async (s) => {
    // comparison overlays are per-location
    if (get().selected?.stationid !== s.stationid) {
      set({ compareData: {}, compareModels: [] })
    }
    set({ selected: s, loading: true, error: null })
    if (!s.stationid.startsWith('@')) {
      const recents = [s.stationid, ...get().recents.filter((r) => r !== s.stationid)].slice(0, 6)
      localStorage.setItem(RECENT_KEY, JSON.stringify(recents))
      set({ recents })
    }
    const st = get()
    if (st.mode === 'obs') {
      try {
        const snd = await fetchWyomingSounding(s, cycleString(st.cycle))
        if (get().selected?.stationid !== s.stationid) return // stale
        applySounding(set, snd)
      } catch (e) {
        if (get().selected?.stationid !== s.stationid) return
        applySounding(set, null, e instanceof Error ? e.message : String(e))
      }
    } else {
      await get().refreshForecast()
    }
  },

  refreshForecast: async () => {
    const { selected, model } = get()
    if (!selected) return
    set({ fcstLoading: true, loading: true, error: null })
    try {
      const fc = await fetchForecast(selected.lat, selected.lon, model)
      // default to the hour nearest now
      const now = Date.now()
      let idx = 0
      let best = Infinity
      fc.hours.forEach((h, i) => {
        const d = Math.abs(Date.parse(h + ':00Z') - now)
        if (d < best) {
          best = d
          idx = i
        }
      })
      set({ forecast: fc, forecastHour: idx, fcstLoading: false })
      const snd = forecastSounding(fc, idx, selected.name)
      applySounding(set, snd, 'forecast unavailable here')
    } catch (e) {
      set({ fcstLoading: false })
      applySounding(set, null, e instanceof Error ? e.message : String(e))
    }
  },

  setStationFilter: (stationFilter) => set({ stationFilter }),
  setParcelKind: (parcelKind) => set({ parcelKind }),
  setWindUnit: (windUnit) => set({ windUnit }),
  toggleOverlay: (k) => set((s) => ({ overlays: { ...s.overlays, [k]: !s.overlays[k] } })),
  setHover: (hover) => set({ hover }),
  setPDomain: (pDomain) => set({ pDomain }),
  setForecastHour: (i) => {
    const { forecast, selected } = get()
    set({ forecastHour: i })
    if (forecast) {
      const snd = forecastSounding(forecast, i, selected?.name ?? 'Point')
      applySounding(set, snd, 'no forecast data for this hour')
    }
  },
  setModel: async (m) => {
    set({ model: m, forecast: null })
    if (get().mode === 'fcst') await get().refreshForecast()
  },
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),

  toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),

  beginEdit: (curve, p) => {
    const { baseSounding, edits } = get()
    if (!baseSounding) return
    set({ edits: [...edits, { curve, p, delta: 0 }] })
  },

  updateEdit: (delta) => {
    const { baseSounding, edits } = get()
    if (!baseSounding || edits.length === 0) return
    const next = [...edits]
    next[next.length - 1] = { ...next[next.length - 1], delta }
    set({ edits: next, sounding: applyEdits(baseSounding, next) })
  },

  endEdit: () => {
    const { baseSounding, edits, sounding } = get()
    if (!baseSounding || !sounding) return
    // drop zero-delta edits
    const cleaned = edits.filter((e) => Math.abs(e.delta) > 0.05)
    const snd = applyEdits(baseSounding, cleaned)
    set({ edits: cleaned, sounding: snd, analysis: analyzeSounding(snd) })
  },

  resetEdits: () => {
    const { baseSounding } = get()
    if (!baseSounding) return
    set({ edits: [], sounding: baseSounding, analysis: analyzeSounding(baseSounding) })
  },

  pinReference: () => {
    const { sounding } = get()
    if (!sounding) return
    const src = sounding.source.kind === 'obs' ? 'OBS' : sounding.source.model
    const label = `${sounding.station.id} ${sounding.validTime.slice(5, 16).replace('T', ' ')}Z ${src}`
    set({ reference: { sounding, label } })
  },

  clearReference: () => set({ reference: null }),

  toggleCompareModel: async (id) => {
    const { compareModels, selected } = get()
    if (compareModels.includes(id)) {
      set({ compareModels: compareModels.filter((m) => m !== id) })
      return
    }
    set({ compareModels: [...compareModels, id] })
    if (!selected || get().compareData[id]) return
    set((s) => ({ compareData: { ...s.compareData, [id]: null } }))
    try {
      const fc = await fetchForecast(selected.lat, selected.lon, id)
      // station may have changed while fetching
      if (get().selected?.stationid !== selected.stationid) return
      set((s) => ({ compareData: { ...s.compareData, [id]: fc } }))
    } catch {
      set((s) => ({
        compareModels: s.compareModels.filter((m) => m !== id),
        compareData: { ...s.compareData, [id]: null },
      }))
    }
  },

  setStageView: (stageView) => set({ stageView }),
  setThField: (thField) => set({ thField }),
  setThAdjust: (thBrightness, thContrast) => {
    localStorage.setItem(ADJUST_KEY, JSON.stringify({ b: thBrightness, c: thContrast }))
    set({ thBrightness, thContrast })
  },

  toggleFavorite: (id) => {
    const favs = get().favorites.includes(id)
      ? get().favorites.filter((f) => f !== id)
      : [...get().favorites, id]
    localStorage.setItem(FAV_KEY, JSON.stringify(favs))
    set({ favorites: favs })
  },
}))
