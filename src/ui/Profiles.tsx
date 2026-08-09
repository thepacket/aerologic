import { useMemo } from 'react'
import { useStore } from '../state/store'
import { thetaE } from '../met/thermo'
import { MS2KT, windAt } from '../met/kinematics'
import { interpProfile } from '../met/parcel'

const W = 118
const H = 170
const PAD = { l: 26, r: 6, t: 8, b: 16 }

interface Pt { x: number; y: number }

function polyline(pts: Pt[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

/** θe vs height and storm-relative wind vs height, side by side. */
export function Profiles() {
  const analysis = useStore((s) => s.analysis)
  const windUnit = useStore((s) => s.windUnit)
  const hover = useStore((s) => s.hover)

  const model = useMemo(() => {
    if (!analysis) return null
    const prof = analysis.prof
    const elev = prof.z[0]
    const zTop = 9000

    // θe profile
    const tePts: { z: number; v: number }[] = []
    for (let i = 0; i < prof.p.length; i++) {
      const zAGL = prof.z[i] - elev
      if (zAGL > zTop) break
      tePts.push({ z: zAGL, v: thetaE(prof.t[i], prof.td[i], prof.p[i]) })
    }
    if (tePts.length < 4) return null
    let teMin = Infinity
    let teMax = -Infinity
    for (const p of tePts) {
      if (p.v < teMin) teMin = p.v
      if (p.v > teMax) teMax = p.v
    }
    const teSpan = Math.max(teMax - teMin, 10)
    const plotH = H - PAD.t - PAD.b
    const plotW = W - PAD.l - PAD.r
    const teLine = tePts.map((p) => ({
      x: PAD.l + ((p.v - teMin) / teSpan) * plotW,
      y: PAD.t + plotH - (p.z / zTop) * plotH,
    }))

    // storm-relative wind profile (vs right mover)
    let srLine: Pt[] | null = null
    let srMax = 0
    const unitScale = windUnit === 'kt' ? MS2KT : windUnit === 'kmh' ? 3.6 : 1
    if (analysis.wind && Number.isFinite(analysis.bunkersRight.u)) {
      const pts: { z: number; v: number }[] = []
      for (let z = 0; z <= zTop; z += 150) {
        if (z > analysis.wind.z[analysis.wind.z.length - 1]) break
        const w = windAt(analysis.wind, z)
        const sr = Math.hypot(w.u - analysis.bunkersRight.u, w.v - analysis.bunkersRight.v)
        pts.push({ z, v: sr * unitScale })
      }
      for (const p of pts) if (p.v > srMax) srMax = p.v
      srMax = Math.max(srMax * 1.1, windUnit === 'ms' ? 15 : 30)
      srLine = pts.map((p) => ({
        x: PAD.l + (p.v / srMax) * plotW,
        y: PAD.t + plotH - (p.z / zTop) * plotH,
      }))
    }

    // hover marker height
    let hoverY: number | null = null
    if (hover) {
      const zAGL = interpProfile(prof, 'z', hover.p) - elev
      if (zAGL >= 0 && zAGL <= zTop) hoverY = PAD.t + plotH - (zAGL / zTop) * plotH
    }

    return { teLine, teMin, teMax, srLine, srMax, hoverY, plotH, plotW }
  }, [analysis, windUnit, hover])

  if (!model) return <div className="panel-empty">no profile data</div>

  const kmTicks = [0, 3, 6, 9]
  const unitLabel = windUnit === 'kt' ? 'kt' : windUnit === 'kmh' ? 'km/h' : 'm/s'

  return (
    <div className="profiles">
      <div className="profile-block">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {kmTicks.map((km) => {
            const y = PAD.t + model.plotH - (km / 9) * model.plotH
            return (
              <g key={km}>
                <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} className="prof-grid" />
                <text x={PAD.l - 4} y={y + 3} className="prof-tick">{km}</text>
              </g>
            )
          })}
          <polyline points={polyline(model.teLine)} className="prof-line prof-te" />
          {model.hoverY !== null && (
            <line x1={PAD.l} y1={model.hoverY} x2={W - PAD.r} y2={model.hoverY} className="prof-hover" />
          )}
          <text x={PAD.l} y={H - 4} className="prof-label">
            θe {model.teMin.toFixed(0)}–{model.teMax.toFixed(0)} K
          </text>
        </svg>
      </div>
      <div className="profile-block">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {kmTicks.map((km) => {
            const y = PAD.t + model.plotH - (km / 9) * model.plotH
            return (
              <g key={km}>
                <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} className="prof-grid" />
                <text x={PAD.l - 4} y={y + 3} className="prof-tick">{km}</text>
              </g>
            )
          })}
          {model.srLine ? (
            <>
              {/* classic 15–25 kt (≈8–13 m/s) supercell inflow band */}
              <rect
                x={PAD.l + ((windUnit === 'ms' ? 8 : windUnit === 'kmh' ? 28 : 15) / model.srMax) * model.plotW}
                y={PAD.t}
                width={Math.max(
                  0,
                  (((windUnit === 'ms' ? 13 : windUnit === 'kmh' ? 47 : 25) -
                    (windUnit === 'ms' ? 8 : windUnit === 'kmh' ? 28 : 15)) /
                    model.srMax) * model.plotW,
                )}
                height={model.plotH}
                className="prof-band"
              />
              <polyline points={polyline(model.srLine)} className="prof-line prof-sr" />
            </>
          ) : (
            <text x={PAD.l + 4} y={H / 2} className="prof-label">no wind</text>
          )}
          {model.hoverY !== null && (
            <line x1={PAD.l} y1={model.hoverY} x2={W - PAD.r} y2={model.hoverY} className="prof-hover" />
          )}
          <text x={PAD.l} y={H - 4} className="prof-label">SR wind ({unitLabel})</text>
        </svg>
      </div>
    </div>
  )
}
