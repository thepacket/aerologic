import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type ThField } from '../state/store'
import type { ForecastData } from '../data/openmeteo'
import { OM_LEVELS } from '../data/openmeteo'
import { dewpointFromRH, thetaE } from '../met/thermo'
import { MS2KT } from '../met/kinematics'

/** BUFKIT-style time × log-p section of the loaded forecast run.
 *  Heatmap field selectable (RH / θe / T / wind speed), isotherm overlay,
 *  wind barbs, and a surface strip chart (model CAPE bars + 2 m T/Td).
 *  Clicking a column jumps the forecast hour. */

const P_TOP = 100
const P_BOT = 1050
const MARGIN = { l: 44, r: 10, t: 8 }
const AXIS_H = 18
const STRIP_H = 58
const P_LABELS = [1000, 850, 700, 500, 400, 300, 200, 150, 100]

interface Cell {
  t: number
  td: number
  rh: number
  wspd: number
  wdir: number
  z: number
}

interface Grid {
  hours: string[]
  /** per level (ascending index = decreasing p), per hour */
  levels: number[]
  cells: Cell[][] // [levelIdx][hourIdx]
  thetae: number[][]
  sfcP: number[]
  sfcT: number[]
  sfcTd: number[]
  cape: number[]
  cin: number[]
}

function buildGrid(fc: ForecastData): Grid {
  const h = fc.raw
  const n = fc.hours.length
  const levels = [...OM_LEVELS]
  const cells: Cell[][] = []
  const thetae: number[][] = []
  for (let li = 0; li < levels.length; li++) {
    const lv = levels[li]
    const row: Cell[] = []
    const teRow: number[] = []
    const tArr = h[`temperature_${lv}hPa`]
    const rhArr = h[`relative_humidity_${lv}hPa`]
    const sArr = h[`wind_speed_${lv}hPa`]
    const dArr = h[`wind_direction_${lv}hPa`]
    const zArr = h[`geopotential_height_${lv}hPa`]
    for (let i = 0; i < n; i++) {
      const t = tArr?.[i] ?? NaN
      const rh = rhArr?.[i] ?? NaN
      const td = Number.isFinite(t) && Number.isFinite(rh) ? dewpointFromRH(t, Math.max(rh, 0.5)) : NaN
      row.push({
        t,
        td,
        rh,
        wspd: sArr?.[i] ?? NaN,
        wdir: dArr?.[i] ?? NaN,
        z: zArr?.[i] ?? NaN,
      })
      teRow.push(Number.isFinite(td) ? thetaE(t, td, lv) : NaN)
    }
    cells.push(row)
    thetae.push(teRow)
  }
  const sfcTd = fc.surface.t.map((t, i) =>
    Number.isFinite(t) && Number.isFinite(fc.surface.rh[i])
      ? dewpointFromRH(t, Math.max(fc.surface.rh[i], 0.5))
      : NaN,
  )
  return {
    hours: fc.hours,
    levels,
    cells,
    thetae,
    sfcP: fc.surface.p,
    sfcT: fc.surface.t,
    sfcTd,
    cape: fc.modelCape,
    cin: fc.modelCin,
  }
}

/** Interpolate a per-cell value at pressure p for hour i (linear in ln p).
 *  Includes the surface as the bottom sample. Returns NaN below ground. */
function interpAt(
  g: Grid,
  i: number,
  p: number,
  get: (li: number, i: number) => number,
  sfcVal: number,
): number {
  const sfcP = g.sfcP[i]
  if (!Number.isFinite(sfcP) || p > sfcP) return NaN
  // find first level above ground
  let prevP = sfcP
  let prevV = sfcVal
  for (let li = 0; li < g.levels.length; li++) {
    const lp = g.levels[li]
    if (lp >= sfcP) continue
    const v = get(li, i)
    if (!Number.isFinite(v)) continue
    if (lp <= p) {
      if (!Number.isFinite(prevV)) return v
      const f = (Math.log(prevP) - Math.log(p)) / (Math.log(prevP) - Math.log(lp))
      return prevV + f * (v - prevV)
    }
    prevP = lp
    prevV = v
  }
  return NaN
}

/** color ramps */
function rampRH(v: number): string {
  const a = Math.min(Math.max((v - 35) / 65, 0), 1) * 0.8
  // dark → teal-green, pre-blended against the stage background so adjacent
  // columns can overdraw without alpha seams
  const bg = [10, 13, 18]
  const fg = [60, 220, 165]
  const c = bg.map((b, i) => Math.round(b + a * (fg[i] - b)))
  return `rgb(${c.join(',')})`
}

function lerpStops(v: number, stops: [number, [number, number, number]][]): string {
  if (v <= stops[0][0]) return `rgb(${stops[0][1].join(',')})`
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i]
    const [v1, c1] = stops[i + 1]
    if (v <= v1) {
      const f = (v - v0) / (v1 - v0)
      const c = c0.map((a, k) => Math.round(a + f * (c1[k] - a)))
      return `rgb(${c.join(',')})`
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(',')})`
}

const TE_STOPS: [number, [number, number, number]][] = [
  [280, [16, 24, 48]],
  [305, [30, 80, 120]],
  [325, [70, 160, 120]],
  [345, [235, 170, 60]],
  [365, [255, 90, 70]],
]
const T_STOPS: [number, [number, number, number]][] = [
  [-60, [40, 40, 120]],
  [-20, [50, 110, 190]],
  [0, [120, 170, 200]],
  [1, [180, 120, 90]],
  [20, [230, 120, 70]],
  [35, [255, 70, 60]],
]
const W_STOPS: [number, [number, number, number]][] = [
  [0, [12, 16, 26]],
  [15, [25, 90, 130]],
  [30, [55, 165, 200]],
  [50, [130, 215, 245]],
]

function fieldColor(field: ThField, c: { t: number; rh: number; te: number; wspd: number }): string {
  switch (field) {
    case 'rh':
      return Number.isFinite(c.rh) ? rampRH(c.rh) : 'transparent'
    case 'thetae':
      return Number.isFinite(c.te) ? lerpStops(c.te, TE_STOPS) : 'transparent'
    case 'temp':
      return Number.isFinite(c.t) ? lerpStops(c.t, T_STOPS) : 'transparent'
    case 'wind':
      return Number.isFinite(c.wspd) ? lerpStops(c.wspd * MS2KT, W_STOPS) : 'transparent'
  }
}

const FIELD_LABELS: Record<ThField, string> = {
  rh: 'RH %',
  thetae: 'θe K',
  temp: 'T °C',
  wind: 'wind kt',
}

export function TimeHeight() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const heatRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hoverTH, setHoverTH] = useState<{ x: number; y: number } | null>(null)

  const forecast = useStore((s) => s.forecast)
  const forecastHour = useStore((s) => s.forecastHour)
  const setForecastHour = useStore((s) => s.setForecastHour)
  const thField = useStore((s) => s.thField)
  const setThField = useStore((s) => s.setThField)
  const thBrightness = useStore((s) => s.thBrightness)
  const thContrast = useStore((s) => s.thContrast)
  const setThAdjust = useStore((s) => s.setThAdjust)
  const windUnit = useStore((s) => s.windUnit)

  const grid = useMemo(() => (forecast ? buildGrid(forecast) : null), [forecast])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dims = useMemo(() => {
    if (size.w === 0 || !grid) return null
    const w = size.w - MARGIN.l - MARGIN.r
    const h = size.h - MARGIN.t - AXIS_H - STRIP_H - 8
    if (w < 100 || h < 100) return null
    const n = grid.hours.length
    const x = (i: number) => MARGIN.l + (i / (n - 1)) * w
    const iFromX = (px: number) => Math.round(((px - MARGIN.l) / w) * (n - 1))
    const y = (p: number) => MARGIN.t + (h * Math.log(p / P_TOP)) / Math.log(P_BOT / P_TOP)
    const pFromY = (py: number) => P_TOP * Math.exp(((py - MARGIN.t) / h) * Math.log(P_BOT / P_TOP))
    return { w, h, n, x, iFromX, y, pFromY, stripY: MARGIN.t + h + AXIS_H }
  }, [size, grid])

  // heatmap layer: its own canvas so brightness/contrast can be applied as a
  // GPU CSS filter without touching the line overlays
  useEffect(() => {
    const canvas = heatRef.current
    if (!canvas || !dims || !grid) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    const { n, x, pFromY, h } = dims
    const dx = dims.w / (n - 1)
    // opaque plot-area base so the filter operates on predictable pixels
    ctx.fillStyle = '#07090c'
    ctx.fillRect(MARGIN.l, MARGIN.t, dims.w, h)

    const step = 3
    for (let i = 0; i < n; i++) {
      const cx = x(i)
      for (let py = MARGIN.t; py < MARGIN.t + h; py += step) {
        const p = pFromY(py + step / 2)
        // θe becomes enormous in the stratosphere and drowns the signal
        if (thField === 'thetae' && p < 300) continue
        const t = interpAt(grid, i, p, (li, ii) => grid.cells[li][ii].t, grid.sfcT[i])
        if (!Number.isFinite(t)) continue // below ground
        const rh = interpAt(grid, i, p, (li, ii) => grid.cells[li][ii].rh, NaN)
        const te = interpAt(grid, i, p, (li, ii) => grid.thetae[li][ii], NaN)
        const ws = interpAt(grid, i, p, (li, ii) => grid.cells[li][ii].wspd, NaN)
        const col = fieldColor(thField, { t, rh, te, wspd: ws })
        if (col === 'transparent') continue
        ctx.fillStyle = col
        ctx.fillRect(cx - dx / 2 - 0.5, py, dx + 1, step)
      }
    }
  }, [dims, grid, size, thField])

  // line work: isotherms, barbs, axes, strip chart, legend
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !dims || !grid) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    const { n, x, y, h } = dims
    const dx = dims.w / (n - 1)

    // ── isotherm overlay: crossings per column, connected between columns.
    // A dark halo keeps the lines legible over bright heatmap regions.
    ctx.save()
    ctx.shadowColor = 'rgba(7, 9, 12, 0.9)'
    ctx.shadowBlur = 3
    const isotherms = [-40, -30, -20, -10, 0, 10, 20]
    for (const iso of isotherms) {
      ctx.strokeStyle = iso === 0 ? 'rgba(127, 192, 232, 0.95)' : 'rgba(238, 243, 250, 0.35)'
      ctx.lineWidth = iso === 0 ? 1.6 : 1
      let prev: number[] = []
      for (let i = 0; i < n; i++) {
        // find crossings scanning levels bottom-up
        const cross: number[] = []
        let pPrev = grid.sfcP[i]
        let tPrev = grid.sfcT[i]
        for (let li = 0; li < grid.levels.length; li++) {
          const lp = grid.levels[li]
          if (!Number.isFinite(pPrev) || lp >= pPrev) continue
          const t = grid.cells[li][i].t
          if (Number.isFinite(tPrev) && Number.isFinite(t) &&
              ((tPrev >= iso && t < iso) || (tPrev <= iso && t > iso))) {
            const f = (tPrev - iso) / (tPrev - t)
            const p = Math.exp(Math.log(pPrev) + f * (Math.log(lp) - Math.log(pPrev)))
            cross.push(y(p))
          }
          pPrev = lp
          tPrev = t
        }
        if (i > 0) {
          for (const cy of cross) {
            // connect to nearest crossing in previous column
            let best = Infinity
            let bestY = NaN
            for (const py of prev) {
              const d = Math.abs(py - cy)
              if (d < best) {
                best = d
                bestY = py
              }
            }
            if (best < 26) {
              ctx.beginPath()
              ctx.moveTo(x(i - 1), bestY)
              ctx.lineTo(x(i), cy)
              ctx.stroke()
            }
          }
        }
        prev = cross
      }
    }

    ctx.restore()

    // ── wind barbs (subsampled grid), same dark halo for contrast
    ctx.save()
    ctx.shadowColor = 'rgba(7, 9, 12, 0.9)'
    ctx.shadowBlur = 2.5
    const hourStride = Math.max(1, Math.ceil(30 / dx))
    ctx.strokeStyle = 'rgba(190, 205, 228, 0.95)'
    ctx.fillStyle = 'rgba(190, 205, 228, 0.95)'
    ctx.lineWidth = 1
    const barbLevels = [925, 850, 700, 600, 500, 400, 300, 250, 200, 150]
    for (let i = 0; i < n; i += hourStride) {
      for (const lp of barbLevels) {
        if (lp >= grid.sfcP[i]) continue
        const li = grid.levels.indexOf(lp as (typeof grid.levels)[number])
        if (li < 0) continue
        const c = grid.cells[li][i]
        if (!Number.isFinite(c.wspd) || !Number.isFinite(c.wdir)) continue
        drawSmallBarb(ctx, x(i), y(lp), c.wdir, c.wspd * MS2KT)
      }
    }
    ctx.restore()

    // ── day boundaries + time axis
    ctx.font = '9px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    for (let i = 0; i < n; i++) {
      const hh = grid.hours[i].slice(11, 13)
      if (hh === '00') {
        const cx = x(i)
        ctx.strokeStyle = 'rgba(43, 52, 68, 0.9)'
        ctx.beginPath()
        ctx.moveTo(cx, MARGIN.t)
        ctx.lineTo(cx, dims.stripY + STRIP_H)
        ctx.stroke()
        ctx.fillStyle = '#8fa0b8'
        ctx.fillText(grid.hours[i].slice(5, 10), cx + 3, MARGIN.t + h + 4)
      } else if (hh === '12' && dx * 12 > 34) {
        ctx.fillStyle = '#5d6b80'
        ctx.fillText('12Z', x(i) + 2, MARGIN.t + h + 4)
      }
    }

    // ── pressure labels + frame
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (const p of P_LABELS) {
      const py = y(p)
      ctx.fillStyle = '#8fa0b8'
      ctx.fillText(String(p), MARGIN.l - 5, py)
      ctx.strokeStyle = 'rgba(30, 37, 50, 0.6)'
      ctx.beginPath()
      ctx.moveTo(MARGIN.l, py)
      ctx.lineTo(MARGIN.l + dims.w, py)
      ctx.stroke()
    }
    ctx.strokeStyle = '#2b3444'
    ctx.strokeRect(MARGIN.l + 0.5, MARGIN.t + 0.5, dims.w, h)

    // ── strip chart: model CAPE bars + 2 m T / Td
    const sy = dims.stripY
    ctx.fillStyle = '#0a0d12'
    ctx.fillRect(MARGIN.l, sy, dims.w, STRIP_H)
    let capeMax = 100
    for (const c of grid.cape) if (Number.isFinite(c) && c > capeMax) capeMax = c
    ctx.fillStyle = 'rgba(255, 180, 84, 0.55)'
    for (let i = 0; i < n; i++) {
      const c = grid.cape[i]
      if (!Number.isFinite(c) || c <= 0) continue
      const bh = (c / capeMax) * (STRIP_H - 4)
      ctx.fillRect(x(i) - dx / 2, sy + STRIP_H - bh, dx + 0.5, bh)
    }
    // T / Td lines
    let tMin = Infinity
    let tMax = -Infinity
    for (let i = 0; i < n; i++) {
      if (grid.sfcT[i] < tMin) tMin = grid.sfcT[i]
      if (grid.sfcT[i] > tMax) tMax = grid.sfcT[i]
      if (grid.sfcTd[i] < tMin) tMin = grid.sfcTd[i]
    }
    const tSpan = Math.max(tMax - tMin, 5)
    const tY = (t: number) => sy + 3 + (1 - (t - tMin) / tSpan) * (STRIP_H - 8)
    const line = (vals: number[], color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.4
      ctx.beginPath()
      let started = false
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(vals[i])) continue
        const px = x(i)
        const py = tY(vals[i])
        if (!started) {
          ctx.moveTo(px, py)
          started = true
        } else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
    line(grid.sfcT, '#ff7a66')
    line(grid.sfcTd, '#4fd695')
    ctx.strokeStyle = '#2b3444'
    ctx.strokeRect(MARGIN.l + 0.5, sy + 0.5, dims.w, STRIP_H)
    ctx.fillStyle = '#5d6b80'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`CAPE ≤${capeMax.toFixed(0)} J/kg · 2m T/Td`, MARGIN.l + 4, sy + 3)

    // ── field legend
    const legendW = 90
    const lx = MARGIN.l + dims.w - legendW - 6
    const ly = MARGIN.t + 6
    for (let k = 0; k < legendW; k++) {
      const f = k / legendW
      const sample =
        thField === 'rh'
          ? { t: 0, rh: f * 100, te: NaN, wspd: NaN }
          : thField === 'thetae'
            ? { t: 0, rh: NaN, te: 280 + f * 85, wspd: NaN }
            : thField === 'temp'
              ? { t: -60 + f * 95, rh: NaN, te: NaN, wspd: NaN }
              : { t: 0, rh: NaN, te: NaN, wspd: (f * 50) / MS2KT }
      ctx.fillStyle = fieldColor(thField, sample)
      ctx.fillRect(lx + k, ly, 1, 6)
    }
    ctx.strokeStyle = '#2b3444'
    ctx.strokeRect(lx - 0.5, ly - 0.5, legendW + 1, 7)
    ctx.fillStyle = '#8fa0b8'
    ctx.fillText(FIELD_LABELS[thField], lx, ly + 9)
  }, [dims, grid, size, thField])

  // hour marker + hover overlay
  useEffect(() => {
    const canvas = overRef.current
    if (!canvas || !dims || !grid) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(size.w * dpr)) {
      canvas.width = Math.round(size.w * dpr)
      canvas.height = Math.round(size.h * dpr)
      canvas.style.width = `${size.w}px`
      canvas.style.height = `${size.h}px`
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    // current forecast hour marker
    const mx = dims.x(forecastHour)
    ctx.strokeStyle = '#48d6ff'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(mx, MARGIN.t)
    ctx.lineTo(mx, dims.stripY + STRIP_H)
    ctx.stroke()
    ctx.fillStyle = '#48d6ff'
    ctx.beginPath()
    ctx.moveTo(mx - 4, MARGIN.t)
    ctx.lineTo(mx + 4, MARGIN.t)
    ctx.lineTo(mx, MARGIN.t + 5)
    ctx.closePath()
    ctx.fill()

    if (hoverTH) {
      ctx.strokeStyle = 'rgba(238, 243, 250, 0.25)'
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(hoverTH.x, MARGIN.t)
      ctx.lineTo(hoverTH.x, MARGIN.t + dims.h)
      ctx.moveTo(MARGIN.l, hoverTH.y)
      ctx.lineTo(MARGIN.l + dims.w, hoverTH.y)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [dims, grid, size, forecastHour, hoverTH])

  const readout = useMemo(() => {
    if (!hoverTH || !dims || !grid) return null
    const i = Math.min(Math.max(dims.iFromX(hoverTH.x), 0), dims.n - 1)
    if (hoverTH.y < MARGIN.t || hoverTH.y > MARGIN.t + dims.h) return null
    const p = dims.pFromY(hoverTH.y)
    const t = interpAt(grid, i, p, (li, ii) => grid.cells[li][ii].t, grid.sfcT[i])
    const td = interpAt(grid, i, p, (li, ii) => grid.cells[li][ii].td, grid.sfcTd[i])
    const rh = interpAt(grid, i, p, (li, ii) => grid.cells[li][ii].rh, NaN)
    const ws = interpAt(grid, i, p, (li, ii) => grid.cells[li][ii].wspd, NaN)
    const z = interpAt(grid, i, p, (li, ii) => grid.cells[li][ii].z, NaN)
    const fmt = (v: number, d = 1, u = '') => (Number.isFinite(v) ? `${v.toFixed(d)}${u}` : '—')
    const wsDisp =
      windUnit === 'kt' ? fmt(ws * MS2KT, 0, ' kt') : windUnit === 'kmh' ? fmt(ws * 3.6, 0, ' km/h') : fmt(ws, 1, ' m/s')
    return {
      x: hoverTH.x,
      rows: [
        ['Valid', grid.hours[i].replace('T', ' ') + 'Z'],
        ['P', fmt(p, 0, ' hPa')],
        ['Z', fmt(z, 0, ' m')],
        ['T', fmt(t, 1, ' °C')],
        ['Td', fmt(td, 1, ' °C')],
        ['RH', fmt(rh, 0, ' %')],
        ['Wind', wsDisp],
        ['CAPE', fmt(grid.cape[i], 0, ' J/kg')],
        ['CIN', fmt(grid.cin[i], 0, ' J/kg')],
      ] as [string, string][],
    }
  }, [hoverTH, dims, grid, windUnit])

  if (!forecast) {
    return (
      <div className="stage-empty">
        <div className="stage-empty-title">NO FORECAST LOADED</div>
        <div className="stage-empty-sub">select a station or map point in forecast mode</div>
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      className="th-wrap"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setHoverTH({ x: e.clientX - r.left, y: e.clientY - r.top })
      }}
      onMouseLeave={() => setHoverTH(null)}
      onClick={(e) => {
        if (!dims) return
        const r = e.currentTarget.getBoundingClientRect()
        const i = dims.iFromX(e.clientX - r.left)
        if (i >= 0 && i < dims.n) setForecastHour(i)
      }}
    >
      <canvas
        ref={heatRef}
        className="skewt-canvas"
        style={{
          filter:
            thBrightness !== 1 || thContrast !== 1
              ? `brightness(${thBrightness}) contrast(${thContrast})`
              : undefined,
        }}
      />
      <canvas ref={canvasRef} className="skewt-canvas" />
      <canvas ref={overRef} className="skewt-canvas skewt-overlay" />
      <div className="th-controls" onClick={(e) => e.stopPropagation()}>
        <div className="segmented">
          {(['rh', 'thetae', 'temp', 'wind'] as const).map((f) => (
            <button
              key={f}
              className="seg-btn"
              data-active={thField === f}
              onClick={() => setThField(f)}
            >
              {f === 'rh' ? 'RH' : f === 'thetae' ? 'θE' : f === 'temp' ? 'TEMP' : 'WIND'}
            </button>
          ))}
        </div>
        <label className="th-adjust" title="brightness">
          <span>☀</span>
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.02}
            value={thBrightness}
            onChange={(e) => setThAdjust(Number(e.target.value), thContrast)}
          />
        </label>
        <label className="th-adjust" title="contrast">
          <span>◐</span>
          <input
            type="range"
            min={0.6}
            max={1.8}
            step={0.02}
            value={thContrast}
            onChange={(e) => setThAdjust(thBrightness, Number(e.target.value))}
          />
        </label>
        {(thBrightness !== 1 || thContrast !== 1) && (
          <button
            className="th-adjust-reset"
            title="reset brightness/contrast"
            onClick={() => setThAdjust(1, 1)}
          >
            ×
          </button>
        )}
      </div>
      {readout && (
        <div
          className="readout th-readout"
          style={{ left: Math.min(readout.x + 14, size.w - 190), top: 40 }}
        >
          {readout.rows.map(([k, v]) => (
            <div className="readout-row" key={k}>
              <span className="readout-k">{k}</span>
              <span className="readout-v">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function drawSmallBarb(ctx: CanvasRenderingContext2D, x: number, y: number, dirFrom: number, kt: number) {
  const len = 15
  ctx.save()
  ctx.translate(x, y)
  if (kt < 2.5) {
    ctx.beginPath()
    ctx.arc(0, 0, 1.8, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }
  ctx.rotate(((dirFrom + 180) * Math.PI) / 180)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, -len)
  ctx.stroke()
  let rem = Math.round(kt / 5) * 5
  let yPos = -len
  while (rem >= 50) {
    ctx.beginPath()
    ctx.moveTo(0, yPos)
    ctx.lineTo(5, yPos + 1.8)
    ctx.lineTo(0, yPos + 3.6)
    ctx.closePath()
    ctx.fill()
    yPos += 4.4
    rem -= 50
  }
  while (rem >= 10) {
    ctx.beginPath()
    ctx.moveTo(0, yPos)
    ctx.lineTo(6, yPos - 2.2)
    ctx.stroke()
    yPos += 2.8
    rem -= 10
  }
  if (rem >= 5) {
    if (yPos === -len) yPos += 2.8
    ctx.beginPath()
    ctx.moveTo(0, yPos)
    ctx.lineTo(3.2, yPos - 1.2)
    ctx.stroke()
  }
  ctx.restore()
}
