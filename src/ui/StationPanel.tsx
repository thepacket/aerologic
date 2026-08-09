import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCw, Star } from 'lucide-react'
import { useStore, type Overlays } from '../state/store'
import { latestCycle } from '../data/wyoming'
import { OM_MODELS } from '../data/openmeteo'
import { StationMap } from './StationMap'
import { InventoryCalendar } from './InventoryCalendar'
import { Section } from './Section'

function CyclePicker() {
  const cycle = useStore((s) => s.cycle)
  const setCycle = useStore((s) => s.setCycle)

  const shift = (hours: number) => {
    const d = new Date(cycle)
    d.setUTCHours(d.getUTCHours() + hours)
    if (d.getTime() > latestCycle().getTime()) return
    void setCycle(d)
  }
  const dateStr = cycle.toISOString().slice(0, 10)
  const hour = cycle.getUTCHours()

  return (
    <div className="cycle">
      <button className="tool-btn" onClick={() => shift(-12)} title="previous cycle">
        <ChevronLeft size={12} />
      </button>
      <input
        type="date"
        className="cycle-date"
        value={dateStr}
        max={latestCycle().toISOString().slice(0, 10)}
        onChange={(e) => {
          if (!e.target.value) return
          const d = new Date(e.target.value + 'T00:00:00Z')
          d.setUTCHours(hour)
          void setCycle(d)
        }}
      />
      <div className="segmented">
        {[0, 12].map((h) => (
          <button
            key={h}
            className="seg-btn"
            data-active={hour === h}
            onClick={() => {
              const d = new Date(cycle)
              d.setUTCHours(h)
              if (d.getTime() <= latestCycle().getTime()) void setCycle(d)
            }}
          >
            {String(h).padStart(2, '0')}Z
          </button>
        ))}
      </div>
      <button className="tool-btn" onClick={() => shift(12)} title="next cycle">
        <ChevronRight size={12} />
      </button>
      <button
        className="tool-btn"
        title="jump to latest"
        onClick={() => void setCycle(latestCycle())}
      >
        <RotateCw size={11} />
      </button>
    </div>
  )
}

function ForecastControls() {
  const forecast = useStore((s) => s.forecast)
  const forecastHour = useStore((s) => s.forecastHour)
  const setForecastHour = useStore((s) => s.setForecastHour)
  const model = useStore((s) => s.model)
  const setModel = useStore((s) => s.setModel)
  const fcstLoading = useStore((s) => s.fcstLoading)
  const compareModels = useStore((s) => s.compareModels)
  const toggleCompareModel = useStore((s) => s.toggleCompareModel)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (playing && forecast) {
      timer.current = setInterval(() => {
        const { forecast: fc, forecastHour: h, setForecastHour: setH } = useStore.getState()
        if (!fc) return
        setH((h + 1) % fc.hours.length)
      }, 600)
    }
    return () => {
      if (timer.current) clearInterval(timer.current)
      timer.current = null
    }
  }, [playing, forecast])

  return (
    <div className="fcst-controls">
      <div className="field">
        <label className="field-label">Model</label>
        <select
          className="select"
          value={model}
          onChange={(e) => void setModel(e.target.value)}
        >
          {OM_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      {fcstLoading && <div className="idx-note">loading forecast…</div>}
      {forecast && (
        <div className="field">
          <label className="field-label">
            Valid
            <span className="field-value mono">
              {forecast.hours[forecastHour]?.replace('T', ' ')}Z
            </span>
          </label>
          <div className="fcst-transport">
            <button
              className="tool-btn"
              title={playing ? 'pause' : 'animate forecast hours'}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <Pause size={11} /> : <Play size={11} />}
            </button>
            <input
              type="range"
              className="range"
              min={0}
              max={forecast.hours.length - 1}
              value={forecastHour}
              onChange={(e) => setForecastHour(Number(e.target.value))}
            />
          </div>
          <div className="fcst-scale">
            <span>{forecast.hours[0]?.slice(5, 10)}</span>
            <span>{forecast.hours[forecast.hours.length - 1]?.slice(5, 10)}</span>
          </div>
        </div>
      )}
      <div className="field">
        <label className="field-label">Compare models</label>
        <div className="compare-list">
          {OM_MODELS.filter((m) => m.id !== model && m.id !== 'best_match').map((m) => (
            <label key={m.id} className="check-row compare-row">
              <input
                type="checkbox"
                checked={compareModels.includes(m.id)}
                onChange={() => void toggleCompareModel(m.id)}
              />
              <span className="model-swatch" style={{ background: m.color }} />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

function OverlayToggles() {
  const overlays = useStore((s) => s.overlays)
  const toggleOverlay = useStore((s) => s.toggleOverlay)
  const items: { k: keyof Overlays; label: string }[] = [
    { k: 'parcel', label: 'Parcel path' },
    { k: 'capeShade', label: 'CAPE/CIN shading' },
    { k: 'wetBulb', label: 'Wet-bulb Tw' },
    { k: 'virtualTemp', label: 'Virtual temp' },
    { k: 'dryAdiabats', label: 'Dry adiabats' },
    { k: 'moistAdiabats', label: 'Moist adiabats' },
    { k: 'mixingLines', label: 'Mixing ratio' },
    { k: 'windBarbs', label: 'Wind barbs' },
    { k: 'heightLabels', label: 'Height ticks' },
  ]
  return (
    <div className="overlays">
      {items.map((it) => (
        <label key={it.k} className="check-row">
          <input
            type="checkbox"
            checked={overlays[it.k]}
            onChange={() => toggleOverlay(it.k)}
          />
          <span>{it.label}</span>
        </label>
      ))}
    </div>
  )
}

export function StationPanel() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const stations = useStore((s) => s.stations)
  const filter = useStore((s) => s.stationFilter)
  const setFilter = useStore((s) => s.setStationFilter)
  const selected = useStore((s) => s.selected)
  const selectStation = useStore((s) => s.selectStation)
  const favorites = useStore((s) => s.favorites)
  const recents = useStore((s) => s.recents)
  const toggleFavorite = useStore((s) => s.toggleFavorite)

  const filtered = useMemo(() => {
    // a station can be listed under both BUFR and FM35 — keep the BUFR one
    const byId = new Map<string, (typeof stations)[number]>()
    for (const raw of stations) {
      const s = raw.name === raw.name.trim() ? raw : { ...raw, name: raw.name.trim() }
      const prev = byId.get(s.stationid)
      if (!prev || (prev.src !== 'BUFR' && s.src === 'BUFR')) byId.set(s.stationid, s)
    }
    const q = filter.trim().toLowerCase()
    let list = [...byId.values()]
    if (q) {
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.stationid.toLowerCase().includes(q),
      )
    }
    const favSet = new Set(favorites)
    const recentRank = new Map(recents.map((id, i) => [id, i]))
    return list
      .sort((a, b) => {
        const af = favSet.has(a.stationid)
        const bf = favSet.has(b.stationid)
        if (af !== bf) return af ? -1 : 1
        const ar = recentRank.get(a.stationid) ?? 99
        const br = recentRank.get(b.stationid) ?? 99
        if (ar !== br) return ar - br
        if (!a.name !== !b.name) return a.name ? -1 : 1 // unnamed last
        return a.name.localeCompare(b.name)
      })
      .slice(0, 400)
  }, [stations, filter, favorites, recents])

  return (
    <aside className="panel left">
      <div className="panel-head">
        <span className="panel-title">Sounding source</span>
      </div>
      <div className="panel-body">
        <div className="segmented mode-seg">
          <button className="seg-btn" data-active={mode === 'obs'} onClick={() => setMode('obs')}>
            OBSERVED
          </button>
          <button className="seg-btn" data-active={mode === 'fcst'} onClick={() => setMode('fcst')}>
            FORECAST
          </button>
        </div>

        {mode === 'obs' ? (
          <Section title="Launch cycle" id="cycle">
            <CyclePicker />
            <InventoryCalendar />
          </Section>
        ) : (
          <Section title="Forecast" id="fcst">
            <ForecastControls />
          </Section>
        )}

        <Section title="Stations" id="stations" right={<span className="mono">{stations.length}</span>}>
          <StationMap />
          <input
            className="text-input"
            placeholder="filter by name or ID…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            spellCheck={false}
          />
          <div className="station-list">
            {filtered.map((s) => (
              <div
                key={`${s.stationid}:${s.src}`}
                className="station-row"
                data-active={selected?.stationid === s.stationid}
                onClick={() => void selectStation(s)}
              >
                <span className="station-id mono">{s.stationid}</span>
                <span className="station-name">{s.name || '(unnamed)'}</span>
                <button
                  className="station-fav"
                  data-fav={favorites.includes(s.stationid)}
                  title="favorite"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(s.stationid)
                  }}
                >
                  <Star size={10} />
                </button>
                <span className="station-src mono" data-src={s.src}>
                  {s.src}
                </span>
              </div>
            ))}
            {filtered.length === 0 && <div className="panel-empty">no matches</div>}
          </div>
        </Section>

        <Section title="Overlays" id="overlays">
          <OverlayToggles />
        </Section>
      </div>
    </aside>
  )
}
