import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { makeDims, pFromY, xFromTY, yFromP, inPlot } from './transform'
import { drawBackground, drawData, drawHover, drawModelOverlay, drawReference, nearestLevel } from './render'
import { registerSkewTCanvas } from './exportPng'
import { forecastSounding, modelMeta } from '../data/openmeteo'
import { theta, thetaE, wetBulb, relHumidity, mixingRatio } from '../met/thermo'
import { MS2KT } from '../met/kinematics'

interface Size {
  w: number
  h: number
}

export function SkewTCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const overRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })

  const sounding = useStore((s) => s.sounding)
  const analysis = useStore((s) => s.analysis)
  const parcelKind = useStore((s) => s.parcelKind)
  const overlays = useStore((s) => s.overlays)
  const pDomain = useStore((s) => s.pDomain)
  const setPDomain = useStore((s) => s.setPDomain)
  const hover = useStore((s) => s.hover)
  const setHover = useStore((s) => s.setHover)
  const windUnit = useStore((s) => s.windUnit)
  const editMode = useStore((s) => s.editMode)
  const reference = useStore((s) => s.reference)
  const mode = useStore((s) => s.mode)
  const forecast = useStore((s) => s.forecast)
  const forecastHour = useStore((s) => s.forecastHour)
  const compareModels = useStore((s) => s.compareModels)
  const compareData = useStore((s) => s.compareData)
  const primaryModel = useStore((s) => s.model)
  const beginEdit = useStore((s) => s.beginEdit)
  const updateEdit = useStore((s) => s.updateEdit)
  const endEdit = useStore((s) => s.endEdit)
  const editDrag = useRef<{ startX: number; active: boolean } | null>(null)
  const [editCursor, setEditCursor] = useState<'t' | 'td' | null>(null)

  const dims = useMemo(
    () => (size.w > 0 ? makeDims(size.w, size.h, pDomain) : null),
    [size, pDomain],
  )

  /** comparison-model soundings for the current valid hour */
  const overlaySoundings = useMemo(() => {
    if (mode !== 'fcst' || !forecast || compareModels.length === 0) return []
    const validTime = forecast.hours[forecastHour]
    if (!validTime) return []
    const out: { snd: ReturnType<typeof forecastSounding>; color: string; short: string; loading?: boolean }[] = []
    for (const id of compareModels) {
      if (id === primaryModel) continue
      const meta = modelMeta(id)
      const fc = compareData[id]
      if (!fc) {
        out.push({ snd: null, color: meta.color, short: meta.short, loading: true })
        continue
      }
      const hi = fc.hours.indexOf(validTime)
      if (hi < 0) continue
      out.push({ snd: forecastSounding(fc, hi, meta.short), color: meta.color, short: meta.short })
    }
    return out
  }, [mode, forecast, forecastHour, compareModels, compareData, primaryModel])

  // resize observer
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // main draw
  useEffect(() => {
    const canvas = baseRef.current
    if (!canvas || !dims || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawBackground(ctx, dims, overlays)
    if (reference && reference.sounding !== sounding) drawReference(ctx, dims, reference.sounding)
    for (const ov of overlaySoundings) {
      if (ov.snd) drawModelOverlay(ctx, dims, ov.snd, ov.color)
    }
    if (sounding) drawData(ctx, dims, sounding, analysis, parcelKind, overlays)
    registerSkewTCanvas(canvas)
  }, [dims, size, sounding, analysis, parcelKind, overlays, reference, overlaySoundings])

  // hover overlay draw
  useEffect(() => {
    const canvas = overRef.current
    if (!canvas || !dims || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(size.w * dpr)) {
      canvas.width = Math.round(size.w * dpr)
      canvas.height = Math.round(size.h * dpr)
      canvas.style.width = `${size.w}px`
      canvas.style.height = `${size.h}px`
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (hover && sounding) drawHover(ctx, dims, sounding, hover.p)
    else ctx.clearRect(0, 0, size.w, size.h)
  }, [hover, dims, size, sounding])

  /** In edit mode: which curve (if any) is under the cursor at (x, y). */
  const curveHit = (x: number, y: number): 't' | 'td' | null => {
    if (!dims || !sounding) return null
    const lv = nearestLevel(sounding, pFromY(dims, y))
    if (!lv) return null
    if (Number.isFinite(lv.t) && Math.abs(xFromTY(dims, lv.t, y) - x) < 9) return 't'
    if (Number.isFinite(lv.td) && Math.abs(xFromTY(dims, lv.td, y) - x) < 9) return 'td'
    return null
  }

  const onMove = (e: React.MouseEvent) => {
    if (!dims || !sounding) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (editDrag.current?.active) {
      const degPerPx = (dims.tMax - dims.tMin) / dims.w
      updateEdit((x - editDrag.current.startX) * degPerPx)
      return
    }

    if (!inPlot(dims, x, y)) {
      if (hover) setHover(null)
      if (editCursor) setEditCursor(null)
      return
    }
    if (editMode) {
      const hit = curveHit(x, y)
      if (hit !== editCursor) setEditCursor(hit)
    } else if (editCursor) setEditCursor(null)

    const p = pFromY(dims, y)
    const lv = nearestLevel(sounding, p)
    if (lv) setHover({ p: lv.p, z: lv.z })
  }

  const onDown = (e: React.MouseEvent) => {
    if (!editMode || !dims || !sounding) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hit = curveHit(x, y)
    if (!hit) return
    beginEdit(hit, pFromY(dims, y))
    editDrag.current = { startX: x, active: true }
  }

  const onUp = () => {
    if (editDrag.current?.active) {
      editDrag.current = null
      endEdit()
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!dims) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const pAt = pFromY(dims, Math.min(Math.max(y, dims.y0), dims.y0 + dims.h))
    const factor = Math.exp(e.deltaY * 0.0012)
    let [pb, pt] = pDomain
    // zoom in ln-p space around cursor
    const lnAt = Math.log(pAt)
    let lnB = lnAt + (Math.log(pb) - lnAt) * factor
    let lnT = lnAt + (Math.log(pt) - lnAt) * factor
    let nb = Math.exp(lnB)
    let nt = Math.exp(lnT)
    nb = Math.min(1060, Math.max(nb, 300))
    nt = Math.max(30, Math.min(nt, nb - 50))
    if (nb / nt < 1.15) return
    setPDomain([nb, nt])
  }

  const readout = useMemo(() => {
    if (!hover || !sounding || !dims) return null
    const lv = nearestLevel(sounding, hover.p)
    if (!lv) return null
    const elev = sounding.levels[0].z
    const fmtWind = (spd: number) => {
      if (!Number.isFinite(spd)) return '—'
      if (windUnit === 'kt') return `${(spd * MS2KT).toFixed(0)} kt`
      if (windUnit === 'kmh') return `${(spd * 3.6).toFixed(0)} km/h`
      return `${spd.toFixed(1)} m/s`
    }
    const rh = Number.isFinite(lv.rh) ? lv.rh : Number.isFinite(lv.td) ? relHumidity(lv.t, lv.td) : NaN
    const mr = Number.isFinite(lv.mr) ? lv.mr : Number.isFinite(lv.td) ? mixingRatio(lv.td, lv.p) * 1000 : NaN
    const rows: [string, string][] = [
      ['P', `${lv.p.toFixed(1)} hPa`],
      ['Z', `${lv.z.toFixed(0)} m · ${((lv.z - elev) / 1000).toFixed(2)} km AGL`],
      ['T', Number.isFinite(lv.t) ? `${lv.t.toFixed(1)} °C` : '—'],
      ['Td', Number.isFinite(lv.td) ? `${lv.td.toFixed(1)} °C` : '—'],
      ['Tw', Number.isFinite(lv.td) ? `${wetBulb(lv.t, lv.td, lv.p).toFixed(1)} °C` : '—'],
      ['RH', Number.isFinite(rh) ? `${rh.toFixed(0)} %` : '—'],
      ['w', Number.isFinite(mr) ? `${mr.toFixed(2)} g/kg` : '—'],
      ['θ', Number.isFinite(lv.t) ? `${theta(lv.t, lv.p).toFixed(1)} K` : '—'],
      ['θe', Number.isFinite(lv.td) ? `${thetaE(lv.t, lv.td, lv.p).toFixed(1)} K` : '—'],
      ['Wind', Number.isFinite(lv.wdir) ? `${lv.wdir.toFixed(0)}° ${fmtWind(lv.wspd)}` : '—'],
    ]
    if (Number.isFinite(lv.tice ?? NaN) && lv.t < 0 && lv.tice !== lv.td) {
      rows.push(['Tf', `${lv.tice!.toFixed(1)} °C`])
    }
    if (Number.isFinite(lv.rhIce ?? NaN) && lv.t < 0) rows.push(['RHice', `${lv.rhIce!.toFixed(0)} %`])
    if (lv.dt !== undefined) {
      const m = Math.floor(lv.dt / 60)
      rows.push(['t+', `${m}m ${(lv.dt % 60).toFixed(0)}s`])
    }
    const y = yFromP(dims, lv.p)
    const top = Math.min(Math.max(y - 60, dims.y0), dims.y0 + dims.h - 190)
    return { rows, top }
  }, [hover, sounding, dims, windUnit])

  return (
    <div
      ref={wrapRef}
      className="skewt-wrap"
      data-edit={editMode}
      style={editMode && editCursor ? { cursor: 'ew-resize' } : undefined}
      onMouseMove={onMove}
      onMouseDown={onDown}
      onMouseUp={onUp}
      onMouseLeave={() => {
        setHover(null)
        onUp()
      }}
      onWheel={onWheel}
      onDoubleClick={() => setPDomain([1050, 100])}
    >
      <canvas ref={baseRef} className="skewt-canvas" />
      <canvas ref={overRef} className="skewt-canvas skewt-overlay" />
      {overlaySoundings.length > 0 && (
        <div className="model-legend">
          <span className="model-legend-item">
            <span className="model-swatch" style={{ background: 'var(--temp)' }} />
            {modelMeta(primaryModel).short}
          </span>
          {overlaySoundings.map((ov) => (
            <span key={ov.short} className="model-legend-item" data-loading={ov.loading}>
              <span className="model-swatch" style={{ background: ov.color }} />
              {ov.short}
              {ov.loading && '…'}
            </span>
          ))}
        </div>
      )}
      {!sounding && (
        <div className="stage-empty">
          <div className="stage-empty-title">NO SOUNDING LOADED</div>
          <div className="stage-empty-sub">select a station from the list or map</div>
        </div>
      )}
      {readout && (
        <div className="readout" style={{ top: readout.top }}>
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
