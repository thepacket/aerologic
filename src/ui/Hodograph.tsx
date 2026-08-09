import { useMemo } from 'react'
import { useStore } from '../state/store'
import { MS2KT, dirSpeedFromUV, windAt } from '../met/kinematics'

const BANDS: { z0: number; z1: number; color: string; label: string }[] = [
  { z0: 0, z1: 1000, color: '#ff7a66', label: '0–1' },
  { z0: 1000, z1: 3000, color: '#ffb454', label: '1–3' },
  { z0: 3000, z1: 6000, color: '#4fd695', label: '3–6' },
  { z0: 6000, z1: 9000, color: '#48d6ff', label: '6–9' },
  { z0: 9000, z1: 12000, color: '#9d8cff', label: '9–12' },
]

const SIZE = 252
const C = SIZE / 2

export function Hodograph() {
  const analysis = useStore((s) => s.analysis)
  const hover = useStore((s) => s.hover)
  const windUnit = useStore((s) => s.windUnit)
  const sounding = useStore((s) => s.sounding)

  const model = useMemo(() => {
    const wind = analysis?.wind
    if (!wind || wind.z.length < 3) return null

    const unitScale = windUnit === 'kt' ? MS2KT : windUnit === 'kmh' ? 3.6 : 1
    const ringStepDisp = windUnit === 'ms' ? 10 : 20

    // fit view to the 0–12 km trace plus the origin, in display units
    let minU = 0, maxU = 0, minV = 0, maxV = 0
    for (let i = 0; i < wind.z.length; i++) {
      if (wind.z[i] > 12000) break
      const du = wind.u[i] * unitScale
      const dv = wind.v[i] * unitScale
      if (du < minU) minU = du
      if (du > maxU) maxU = du
      if (dv < minV) minV = dv
      if (dv > maxV) maxV = dv
    }
    const spanU = Math.max(maxU - minU, 10)
    const spanV = Math.max(maxV - minV, 10)
    const pxPer = (SIZE - 44) / Math.max(spanU, spanV)
    const bcx = (minU + maxU) / 2
    const bcy = (minV + maxV) / 2
    const toXY = (u: number, v: number) => ({
      x: C + (u * unitScale - bcx) * pxPer,
      y: C - (v * unitScale - bcy) * pxPer,
    })
    // origin position in view; rings centered there
    const origin = { x: C - bcx * pxPer, y: C + bcy * pxPer }
    const maxRadiusNeeded = Math.hypot(Math.max(Math.abs(minU), maxU), Math.max(Math.abs(minV), maxV)) * 1.05
    const nRings = Math.max(2, Math.ceil(maxRadiusNeeded / ringStepDisp))

    // band polylines
    const paths = BANDS.map((b) => {
      const pts: string[] = []
      const step = 100
      for (let z = b.z0; z <= b.z1; z += step) {
        if (z > wind.z[wind.z.length - 1]) break
        const w = windAt(wind, z)
        const { x, y } = toXY(w.u, w.v)
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
      }
      return { ...b, d: pts.length > 1 ? `M${pts.join('L')}` : null }
    })

    const rings = Array.from({ length: nRings }, (_, i) => (i + 1) * ringStepDisp)

    const mark = (uv: { u: number; v: number }) => toXY(uv.u, uv.v)
    const rm = Number.isFinite(analysis.bunkersRight.u) ? mark(analysis.bunkersRight) : null
    const lm = Number.isFinite(analysis.bunkersLeft.u) ? mark(analysis.bunkersLeft) : null
    const mw = Number.isFinite(analysis.meanWind06.u) ? mark(analysis.meanWind06) : null

    // hover marker: wind at hovered height
    let hoverPt: { x: number; y: number } | null = null
    if (hover && sounding) {
      const zAGL = hover.z - sounding.levels[0].z
      if (zAGL >= 0 && zAGL <= wind.z[wind.z.length - 1]) {
        const w = windAt(wind, zAGL)
        hoverPt = toXY(w.u, w.v)
      }
    }

    // km ticks along the trace
    const ticks: { x: number; y: number; km: number }[] = []
    for (let km = 1; km <= 12; km++) {
      if (km * 1000 > wind.z[wind.z.length - 1]) break
      const w = windAt(wind, km * 1000)
      ticks.push({ ...toXY(w.u, w.v), km })
    }

    return { paths, rings, pxPer, ringStepDisp, rm, lm, mw, hoverPt, ticks, origin }
  }, [analysis, windUnit, hover, sounding])

  if (!model) return <div className="panel-empty">no wind data</div>

  const unitLabel = windUnit === 'kt' ? 'kt' : windUnit === 'kmh' ? 'km/h' : 'm/s'

  return (
    <div className="hodo">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* rings */}
        {model.rings.map((r) => (
          <circle key={r} cx={model.origin.x} cy={model.origin.y} r={r * model.pxPer} className="hodo-ring" />
        ))}
        {model.rings.map((r) => {
          const x = model.origin.x + r * model.pxPer - 2
          if (x < 8 || x > SIZE - 8 || model.origin.y < 8 || model.origin.y > SIZE - 8) return null
          return (
            <text key={r} x={x} y={model.origin.y - 3} className="hodo-ring-label">
              {r}
            </text>
          )
        })}
        <line x1={0} y1={model.origin.y} x2={SIZE} y2={model.origin.y} className="hodo-axis" />
        <line x1={model.origin.x} y1={0} x2={model.origin.x} y2={SIZE} className="hodo-axis" />

        {/* storm-relative fan: RM to trace at 0.5..3km */}
        {model.rm && (
          <g>
            {model.paths[0].d && (
              <path
                d={`${model.paths[0].d} L${model.rm.x},${model.rm.y} Z`}
                className="hodo-srh-fill"
              />
            )}
          </g>
        )}

        {model.paths.map(
          (b) =>
            b.d && (
              <path key={b.label} d={b.d} stroke={b.color} className="hodo-trace" />
            ),
        )}

        {model.ticks.map((t) => (
          <g key={t.km}>
            <circle cx={t.x} cy={t.y} r={2.4} className="hodo-tick" />
            {(t.km === 1 || t.km === 3 || t.km === 6 || t.km === 9) && (
              <text x={t.x + 4} y={t.y - 4} className="hodo-tick-label">
                {t.km}
              </text>
            )}
          </g>
        ))}

        {model.mw && (
          <g transform={`translate(${model.mw.x},${model.mw.y})`}>
            <rect x={-2.6} y={-2.6} width={5.2} height={5.2} className="hodo-mw" />
            <text x={5} y={3} className="hodo-marker-label">MW</text>
          </g>
        )}
        {model.rm && (
          <g transform={`translate(${model.rm.x},${model.rm.y})`}>
            <circle r={3.2} className="hodo-rm" />
            <text x={5} y={3} className="hodo-marker-label">RM</text>
          </g>
        )}
        {model.lm && (
          <g transform={`translate(${model.lm.x},${model.lm.y})`}>
            <circle r={3.2} className="hodo-lm" />
            <text x={5} y={3} className="hodo-marker-label">LM</text>
          </g>
        )}
        {model.hoverPt && (
          <circle cx={model.hoverPt.x} cy={model.hoverPt.y} r={4} className="hodo-hover" />
        )}
      </svg>
      <div className="hodo-legend">
        {BANDS.map((b) => (
          <span key={b.label} className="hodo-legend-item">
            <span className="hodo-swatch" style={{ background: b.color }} />
            {b.label} km
          </span>
        ))}
        <span className="hodo-legend-unit">{unitLabel}</span>
      </div>
      {analysis && Number.isFinite(analysis.bunkersRight.u) && (
        <div className="hodo-motion">
          {(() => {
            const f = (uv: { u: number; v: number }) => {
              const d = dirSpeedFromUV(uv.u, uv.v)
              const s =
                windUnit === 'kt' ? d.spd * MS2KT : windUnit === 'kmh' ? d.spd * 3.6 : d.spd
              return `${d.dir.toFixed(0).padStart(3, '0')}°/${s.toFixed(0)}`
            }
            return (
              <>
                <span>RM {f(analysis.bunkersRight)}</span>
                <span>LM {f(analysis.bunkersLeft)}</span>
                <span>MW {f(analysis.meanWind06)}</span>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
