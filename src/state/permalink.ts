/** URL-hash permalinks: #m=obs&st=71722&c=2026-08-09T00  or
 *  #m=fcst&st=71722&model=gfs_seamless&h=2026-08-09T05:00
 *  Custom forecast points use st=@lat,lon&name=… */
import { useStore } from './store'
import type { WyoStation } from '../data/wyoming'

export interface HashState {
  mode: 'obs' | 'fcst'
  stationId: string | null
  point: { lat: number; lon: number } | null
  cycle: Date | null
  model: string | null
  hour: string | null
}

export function parseHash(): HashState | null {
  const h = window.location.hash.replace(/^#/, '')
  if (!h) return null
  const p = new URLSearchParams(h)
  const mode = p.get('m') === 'fcst' ? 'fcst' : 'obs'
  const st = p.get('st')
  let point: HashState['point'] = null
  let stationId: string | null = null
  if (st?.startsWith('@')) {
    const [lat, lon] = st.slice(1).split(',').map(Number)
    if (Number.isFinite(lat) && Number.isFinite(lon)) point = { lat, lon }
  } else if (st) {
    stationId = st
  }
  let cycle: Date | null = null
  const c = p.get('c')
  if (c) {
    const d = new Date(c + ':00:00Z')
    if (!Number.isNaN(d.getTime())) cycle = d
  }
  return { mode, stationId, point, cycle, model: p.get('model'), hour: p.get('h') }
}

function buildHash(): string {
  const s = useStore.getState()
  const p = new URLSearchParams()
  p.set('m', s.mode)
  if (s.selected) {
    if (s.selected.stationid.startsWith('@')) p.set('st', s.selected.stationid)
    else p.set('st', s.selected.stationid)
  }
  if (s.mode === 'obs') {
    p.set('c', s.cycle.toISOString().slice(0, 13))
  } else {
    p.set('model', s.model)
    if (s.forecast) {
      const h = s.forecast.hours[s.forecastHour]
      if (h) p.set('h', h)
    }
  }
  return p.toString()
}

/** Keep location.hash in sync with the store. Call once at boot. */
export function initPermalink() {
  useStore.subscribe((state, prev) => {
    if (
      state.mode === prev.mode &&
      state.selected === prev.selected &&
      state.cycle === prev.cycle &&
      state.model === prev.model &&
      state.forecastHour === prev.forecastHour &&
      state.forecast === prev.forecast
    ) {
      return
    }
    const next = buildHash()
    if (window.location.hash.replace(/^#/, '') !== next) {
      history.replaceState(null, '', '#' + next)
    }
  })
}

/** Fabricate a pseudo-station for a custom forecast point. */
export function customPoint(lat: number, lon: number): WyoStation {
  return {
    stationid: `@${lat.toFixed(3)},${lon.toFixed(3)}`,
    name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
    lat,
    lon,
    src: 'PT',
  }
}
