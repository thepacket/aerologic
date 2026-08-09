import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { customPoint } from '../state/permalink'
import type { WyoStation } from '../data/wyoming'
import land from '../assets/land110.json'

interface View {
  lon: number
  lat: number
  /** px per degree longitude */
  scale: number
}

const H = 210

type Ring = [number, number][]

function landRings(): Ring[] {
  const rings: Ring[] = []
  for (const f of (land as any).features) {
    const g = f.geometry
    if (g.type === 'Polygon') rings.push(g.coordinates[0])
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) rings.push(p[0])
  }
  return rings
}
const RINGS = landRings()

export function StationMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stations = useStore((s) => s.stations)
  const selected = useStore((s) => s.selected)
  const selectStation = useStore((s) => s.selectStation)
  const [view, setView] = useState<View>({ lon: -40, lat: 35, scale: 0.75 })
  const [width, setWidth] = useState(0)
  const [hoverSt, setHoverSt] = useState<WyoStation | null>(null)
  const drag = useRef<{ x: number; y: number; lon: number; lat: number } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => setWidth(es[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const proj = (lon: number, lat: number, w: number) => ({
    x: w / 2 + (lon - view.lon) * view.scale,
    y: H / 2 - (lat - view.lat) * view.scale * 1.25,
  })
  const unproj = (x: number, y: number, w: number) => ({
    lon: view.lon + (x - w / 2) / view.scale,
    lat: view.lat - (y - H / 2) / (view.scale * 1.25),
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(H * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0a0d12'
    ctx.fillRect(0, 0, width, H)

    // land
    ctx.fillStyle = '#141a23'
    ctx.strokeStyle = '#232c3a'
    ctx.lineWidth = 0.75
    for (const ring of RINGS) {
      ctx.beginPath()
      let first = true
      for (const [lon, lat] of ring) {
        const { x, y } = proj(lon, lat, width)
        if (first) {
          ctx.moveTo(x, y)
          first = false
        } else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }

    // stations
    for (const s of stations) {
      const { x, y } = proj(s.lon, s.lat, width)
      if (x < -4 || x > width + 4 || y < -4 || y > H + 4) continue
      const isSel = selected?.stationid === s.stationid
      ctx.beginPath()
      ctx.arc(x, y, isSel ? 3.4 : 2, 0, Math.PI * 2)
      ctx.fillStyle = isSel ? '#48d6ff' : s.src === 'BUFR' ? '#2f7f9e' : '#3f6f55'
      ctx.fill()
      if (isSel) {
        ctx.strokeStyle = 'rgba(72,214,255,0.5)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(x, y, 6.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    // custom forecast point (not part of the station list)
    if (selected?.src === 'PT') {
      const { x, y } = proj(selected.lon, selected.lat, width)
      ctx.beginPath()
      ctx.moveTo(x, y - 5)
      ctx.lineTo(x + 4, y + 3)
      ctx.lineTo(x - 4, y + 3)
      ctx.closePath()
      ctx.fillStyle = '#ffb454'
      ctx.fill()
    }
    if (hoverSt) {
      const { x, y } = proj(hoverSt.lon, hoverSt.lat, width)
      ctx.beginPath()
      ctx.arc(x, y, 3.4, 0, Math.PI * 2)
      ctx.strokeStyle = '#eef3fa'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }, [stations, selected, view, width, hoverSt])

  const nearest = (mx: number, my: number): WyoStation | null => {
    let best: WyoStation | null = null
    let bd = 100
    for (const s of stations) {
      const { x, y } = proj(s.lon, s.lat, width)
      const d = (x - mx) ** 2 + (y - my) ** 2
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return best
  }

  return (
    <div ref={wrapRef} className="stmap-wrap">
      <canvas
        ref={canvasRef}
        className="stmap"
        onWheel={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top
          const before = unproj(mx, my, width)
          const factor = Math.exp(-e.deltaY * 0.0015)
          const ns = Math.min(30, Math.max(0.5, view.scale * factor))
          // keep cursor point fixed
          const lon = before.lon - (mx - width / 2) / ns
          const lat = before.lat + (my - H / 2) / (ns * 1.25)
          setView({ lon, lat, scale: ns })
        }}
        onMouseDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, lon: view.lon, lat: view.lat }
        }}
        onMouseMove={(e) => {
          if (drag.current) {
            const dx = e.clientX - drag.current.x
            const dy = e.clientY - drag.current.y
            setView((v) => ({
              ...v,
              lon: drag.current!.lon - dx / v.scale,
              lat: drag.current!.lat + dy / (v.scale * 1.25),
            }))
          } else {
            const rect = e.currentTarget.getBoundingClientRect()
            setHoverSt(nearest(e.clientX - rect.left, e.clientY - rect.top))
          }
        }}
        onMouseUp={(e) => {
          if (!drag.current) return
          const moved =
            Math.abs(e.clientX - drag.current.x) + Math.abs(e.clientY - drag.current.y) > 4
          drag.current = null
          if (!moved) {
            const rect = e.currentTarget.getBoundingClientRect()
            const mx = e.clientX - rect.left
            const my = e.clientY - rect.top
            const s = nearest(mx, my)
            if (s) void selectStation(s)
            else if (useStore.getState().mode === 'fcst') {
              // forecast mode: any point on the map is a valid profile location
              const { lon, lat } = unproj(mx, my, width)
              if (lat >= -85 && lat <= 85) {
                void selectStation(customPoint(lat, ((lon + 540) % 360) - 180))
              }
            }
          }
        }}
        onMouseLeave={() => {
          drag.current = null
          setHoverSt(null)
        }}
      />
      {hoverSt && (
        <div className="stmap-tip">
          <span className="mono">{hoverSt.stationid}</span> {hoverSt.name}
        </div>
      )}
    </div>
  )
}
