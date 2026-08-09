import { useMemo } from 'react'
import { useStore } from '../state/store'

const W = 252
const H = 200

/** Balloon drift track from per-second BUFR positions. */
export function DriftMap() {
  const sounding = useStore((s) => s.sounding)
  const hover = useStore((s) => s.hover)

  const model = useMemo(() => {
    if (!sounding) return null
    const pts = sounding.levels.filter(
      (l) => Number.isFinite(l.lat ?? NaN) && Number.isFinite(l.lon ?? NaN),
    )
    if (pts.length < 10) return null
    const lat0 = pts[0].lat!
    const lon0 = pts[0].lon!
    // km east/north relative to launch
    const kmPerLon = 111.32 * Math.cos((lat0 * Math.PI) / 180)
    const track = pts.map((l) => ({
      x: (l.lon! - lon0) * kmPerLon,
      y: (l.lat! - lat0) * 111.32,
      z: l.z,
      p: l.p,
    }))
    // distinct positions? FM35 files repeat station coords → no drift
    let maxR = 0
    for (const t of track) maxR = Math.max(maxR, Math.hypot(t.x, t.y))
    if (maxR < 0.5) return null

    const scale = (Math.min(W, H) / 2 - 18) / maxR
    const cx = W / 2
    const cy = H / 2
    const toXY = (t: { x: number; y: number }) => ({
      x: cx + t.x * scale,
      y: cy - t.y * scale,
    })

    // color by altitude band (same palette as hodograph)
    const seg = (z: number) =>
      z < 1000 + track[0].z ? '#ff7a66'
      : z < 3000 + track[0].z ? '#ffb454'
      : z < 6000 + track[0].z ? '#4fd695'
      : z < 9000 + track[0].z ? '#48d6ff'
      : '#9d8cff'

    const polylines: { color: string; d: string }[] = []
    let cur: string[] = []
    let curColor = seg(track[0].z)
    for (const t of track) {
      const c = seg(t.z)
      const { x, y } = toXY(t)
      if (c !== curColor && cur.length) {
        cur.push(`${x.toFixed(1)},${y.toFixed(1)}`)
        polylines.push({ color: curColor, d: cur.join(' ') })
        cur = []
        curColor = c
      }
      cur.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    if (cur.length > 1) polylines.push({ color: curColor, d: cur.join(' ') })

    // ring at nice km radius
    const ringKm = maxR > 60 ? 50 : maxR > 30 ? 25 : maxR > 12 ? 10 : 5
    const end = toXY(track[track.length - 1])

    let hoverPt: { x: number; y: number } | null = null
    if (hover) {
      let best: (typeof track)[number] | null = null
      let bd = Infinity
      for (const t of track) {
        const d = Math.abs(t.p - hover.p)
        if (d < bd) {
          bd = d
          best = t
        }
      }
      if (best) hoverPt = toXY(best)
    }

    return { polylines, ringKm, ringR: ringKm * scale, end, maxR, hoverPt }
  }, [sounding, hover])

  if (!model) return <div className="panel-empty">no position telemetry</div>

  return (
    <div className="drift">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="hodo-axis" />
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} className="hodo-axis" />
        <circle cx={W / 2} cy={H / 2} r={model.ringR} className="hodo-ring" />
        <text x={W / 2 + model.ringR - 2} y={H / 2 - 3} className="hodo-ring-label">
          {model.ringKm} km
        </text>
        {model.polylines.map((p, i) => (
          <polyline key={i} points={p.d} stroke={p.color} className="drift-trace" />
        ))}
        <circle cx={W / 2} cy={H / 2} r={3} className="drift-launch" />
        <circle cx={model.end.x} cy={model.end.y} r={2.5} className="drift-end" />
        {model.hoverPt && (
          <circle cx={model.hoverPt.x} cy={model.hoverPt.y} r={4} className="hodo-hover" />
        )}
      </svg>
      <div className="drift-stats">
        max drift <span className="mono">{model.maxR.toFixed(1)} km</span>
      </div>
    </div>
  )
}
