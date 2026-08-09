import type { Sounding } from '../met/types'
import type { Analysis } from '../met/indices'
import type { ParcelKind, ParcelResult } from '../met/parcel'
import type { Overlays } from '../state/store'
import { dewpointFromMixingRatio, moistAdiabatTemp, tempOnDryAdiabat, wetBulb } from '../met/thermo'
import { MS2KT } from '../met/kinematics'
import type { SkewTDims } from './transform'
import { xFromTY, yFromP } from './transform'

export const PAL = {
  bg: '#07090c',
  frame: '#2b3444',
  grid: '#1e2532',
  gridMinor: '#151b26',
  label: '#8fa0b8',
  labelDim: '#5d6b80',
  isothermZero: '#2f6f8f',
  dryAdiabat: 'rgba(255, 180, 84, 0.14)',
  moistAdiabat: 'rgba(87, 217, 163, 0.15)',
  mixing: 'rgba(72, 214, 255, 0.18)',
  temp: '#ff7a66',
  dewpoint: '#4fd695',
  wetbulb: '#5f9fd6',
  virtual: '#ffb454',
  parcel: '#e8eef8',
  capeFill: 'rgba(255, 122, 102, 0.16)',
  cinFill: 'rgba(79, 158, 255, 0.18)',
  barb: '#a9b8cf',
  marker: '#48d6ff',
  freezing: '#7fc0e8',
}

const P_MAJOR = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100]
const P_MINOR = [975, 950, 900, 800, 750, 650, 550, 450, 350]
const MIXING_LINES = [0.5, 1, 2, 3, 5, 8, 12, 16, 20, 28, 36]

/** Cache of moist adiabat curves: θw at 1000 hPa → [(p, t)] */
let moistCache: { p: number[]; curves: Map<number, number[]> } | null = null
function moistAdiabats(): { p: number[]; curves: Map<number, number[]> } {
  if (moistCache) return moistCache
  const ps: number[] = []
  for (let p = 1060; p >= 100; p -= 10) ps.push(p)
  const curves = new Map<number, number[]>()
  for (let tw = -32; tw <= 36; tw += 4) {
    const ts: number[] = []
    let lastT = tw
    let lastP = 1060
    // start slightly below chart bottom so curves span fully
    for (const p of ps) {
      const t = moistAdiabatTemp(lastP, lastT, p)
      ts.push(t)
      lastT = t
      lastP = p
    }
    curves.set(tw, ts)
  }
  moistCache = { p: ps, curves }
  return moistCache
}

function clipPlot(ctx: CanvasRenderingContext2D, d: SkewTDims) {
  ctx.beginPath()
  ctx.rect(d.x0, d.y0, d.w, d.h)
  ctx.clip()
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  d: SkewTDims,
  ov: Overlays,
) {
  ctx.save()
  ctx.fillStyle = PAL.bg
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.font = '9.5px ui-monospace, Menlo, monospace'

  // ── isobars
  for (const p of P_MINOR) {
    if (p > d.pBot || p < d.pTop) continue
    const y = yFromP(d, p)
    ctx.strokeStyle = PAL.gridMinor
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(d.x0, y)
    ctx.lineTo(d.x0 + d.w, y)
    ctx.stroke()
  }
  for (const p of P_MAJOR) {
    if (p > d.pBot || p < d.pTop) continue
    const y = yFromP(d, p)
    ctx.strokeStyle = PAL.grid
    ctx.beginPath()
    ctx.moveTo(d.x0, y)
    ctx.lineTo(d.x0 + d.w, y)
    ctx.stroke()
    ctx.fillStyle = PAL.label
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(p), d.x0 - 6, y)
  }

  ctx.save()
  clipPlot(ctx, d)

  // ── isotherms (skewed)
  for (let t = -120; t <= 50; t += 10) {
    const yB = d.y0 + d.h
    const yT = d.y0
    const x1 = xFromTY(d, t, yB)
    const x2 = xFromTY(d, t, yT)
    if (Math.max(x1, x2) < d.x0 || Math.min(x1, x2) > d.x0 + d.w) continue
    ctx.strokeStyle = t === 0 ? PAL.isothermZero : PAL.grid
    ctx.lineWidth = t === 0 ? 1.25 : 1
    ctx.beginPath()
    ctx.moveTo(x1, yB)
    ctx.lineTo(x2, yT)
    ctx.stroke()
  }

  // ── dry adiabats (θ 250..440 K step 10)
  if (ov.dryAdiabats) {
    ctx.strokeStyle = PAL.dryAdiabat
    ctx.lineWidth = 1
    for (let th = 250; th <= 440; th += 10) {
      ctx.beginPath()
      let started = false
      for (let p = d.pBot; p >= d.pTop; p -= 10) {
        const t = tempOnDryAdiabat(th, p)
        const y = yFromP(d, p)
        const x = xFromTY(d, t, y)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  // ── moist adiabats
  if (ov.moistAdiabats) {
    const { p: ps, curves } = moistAdiabats()
    ctx.strokeStyle = PAL.moistAdiabat
    ctx.lineWidth = 1
    for (const [, ts] of curves) {
      ctx.beginPath()
      let started = false
      for (let i = 0; i < ps.length; i++) {
        if (ps[i] > d.pBot || ps[i] < d.pTop) continue
        const y = yFromP(d, ps[i])
        const x = xFromTY(d, ts[i], y)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  // ── mixing ratio lines (dashed, ground → 550 hPa)
  if (ov.mixingLines) {
    ctx.strokeStyle = PAL.mixing
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    const pStop = Math.max(d.pTop, 550)
    for (const wgkg of MIXING_LINES) {
      ctx.beginPath()
      let started = false
      for (let p = d.pBot; p >= pStop; p -= 15) {
        const t = dewpointFromMixingRatio(wgkg / 1000, p)
        const y = yFromP(d, p)
        const x = xFromTY(d, t, y)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      ctx.stroke()
      // label at ~just above bottom
      const pL = Math.min(d.pBot - 12, 1000)
      const t = dewpointFromMixingRatio(wgkg / 1000, pL)
      const y = yFromP(d, pL)
      const x = xFromTY(d, t, y)
      if (x > d.x0 && x < d.x0 + d.w) {
        ctx.save()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(72, 214, 255, 0.45)'
        ctx.font = '8.5px ui-monospace, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(String(wgkg), x, y - 3)
        ctx.restore()
      }
    }
    ctx.setLineDash([])
  }
  ctx.restore()

  // ── temperature axis labels (bottom)
  ctx.fillStyle = PAL.label
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = '9.5px ui-monospace, Menlo, monospace'
  const yB = d.y0 + d.h
  for (let t = -120; t <= 50; t += 10) {
    const x = xFromTY(d, t, yB)
    if (x < d.x0 || x > d.x0 + d.w) continue
    ctx.fillText(`${t}°`, x, yB + 6)
  }

  // ── frame
  ctx.strokeStyle = PAL.frame
  ctx.lineWidth = 1
  ctx.strokeRect(d.x0 + 0.5, d.y0 + 0.5, d.w, d.h)
  ctx.restore()
}

/** Subsample a high-res profile for smooth-but-cheap polylines. */
function displayLevels(snd: Sounding, maxPts = 900) {
  const ls = snd.levels
  if (ls.length <= maxPts) return ls
  const stride = Math.ceil(ls.length / maxPts)
  const out = []
  for (let i = 0; i < ls.length; i += stride) out.push(ls[i])
  if (out[out.length - 1] !== ls[ls.length - 1]) out.push(ls[ls.length - 1])
  return out
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  d: SkewTDims,
  pts: { p: number; v: number }[],
) {
  ctx.beginPath()
  let started = false
  for (const pt of pts) {
    if (!Number.isFinite(pt.v) || pt.p > d.pBot || pt.p < d.pTop) {
      started = false
      continue
    }
    const y = yFromP(d, pt.p)
    const x = xFromTY(d, pt.v, y)
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else ctx.lineTo(x, y)
  }
}

/** Ghost curves for a pinned reference sounding (comparison overlay). */
export function drawReference(ctx: CanvasRenderingContext2D, d: SkewTDims, snd: Sounding) {
  const ls = displayLevels(snd, 400)
  ctx.save()
  clipPlot(ctx, d)
  ctx.lineJoin = 'round'
  ctx.setLineDash([2, 3])
  ctx.strokeStyle = 'rgba(238, 243, 250, 0.38)'
  ctx.lineWidth = 1.4
  tracePath(ctx, d, ls.map((l) => ({ p: l.p, v: l.t })))
  ctx.stroke()
  ctx.strokeStyle = 'rgba(160, 200, 235, 0.32)'
  tracePath(ctx, d, ls.map((l) => ({ p: l.p, v: l.td })))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

/** Thin colored curves for a comparison model at the same valid time. */
export function drawModelOverlay(
  ctx: CanvasRenderingContext2D,
  d: SkewTDims,
  snd: Sounding,
  color: string,
) {
  const ls = displayLevels(snd, 200)
  ctx.save()
  clipPlot(ctx, d)
  ctx.lineJoin = 'round'
  ctx.globalAlpha = 0.8
  ctx.strokeStyle = color
  ctx.lineWidth = 1.2
  tracePath(ctx, d, ls.map((l) => ({ p: l.p, v: l.t })))
  ctx.stroke()
  ctx.setLineDash([3, 3])
  ctx.lineWidth = 1
  tracePath(ctx, d, ls.map((l) => ({ p: l.p, v: l.td })))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

/** Cloud / icing bands drawn as a strip along the inside-left edge. */
function drawLayerBands(ctx: CanvasRenderingContext2D, d: SkewTDims, analysis: Analysis) {
  for (const layer of analysis.layers) {
    if (layer.bottomP < d.pTop || layer.topP > d.pBot) continue
    const y0 = yFromP(d, Math.min(layer.bottomP, d.pBot))
    const y1 = yFromP(d, Math.max(layer.topP, d.pTop))
    if (layer.kind === 'cloud') {
      ctx.fillStyle = 'rgba(170, 190, 215, 0.10)'
      ctx.fillRect(d.x0 + 14, y1, 8, y0 - y1)
    } else {
      ctx.fillStyle = 'rgba(110, 180, 255, 0.28)'
      ctx.fillRect(d.x0 + 24, y1, 4, y0 - y1)
    }
  }
}

export function drawData(
  ctx: CanvasRenderingContext2D,
  d: SkewTDims,
  snd: Sounding,
  analysis: Analysis | null,
  parcelKind: ParcelKind,
  ov: Overlays,
) {
  const ls = displayLevels(snd)
  ctx.save()
  clipPlot(ctx, d)

  if (analysis) drawLayerBands(ctx, d, analysis)

  const parcel: ParcelResult | null = analysis
    ? parcelKind === 'sb' ? analysis.sb : parcelKind === 'ml' ? analysis.ml : analysis.mu
    : null

  // ── CAPE / CIN shading between parcel Tv and env Tv
  if (parcel && ov.parcel && ov.capeShade && analysis) {
    const prof = analysis.prof
    const envT: { p: number; v: number }[] = []
    for (let i = 0; i < prof.p.length; i++) envT.push({ p: prof.p[i], v: prof.tv[i] - 273.15 })
    const region = (positive: boolean) => {
      // CIN shading only exists below an LFC — mirroring how the CIN number
      // itself is defined. A stable parcel with no LFC gets no negative fill
      // (otherwise the whole stable atmosphere would be painted).
      if (!positive && Number.isNaN(parcel.lfcP)) return
      ctx.beginPath()
      let started = false
      const pts = parcel.curve.filter((c) => c.p <= parcel.p0)
      const use = (c: (typeof pts)[number], b: number) =>
        positive ? b > 0 : b < 0 && c.p > parcel.lfcP
      for (const c of pts) {
        const b = c.tv - interpEnvTv(analysis, c.p)
        if (use(c, b)) {
          const y = yFromP(d, c.p)
          const x = xFromTY(d, c.tv - 273.15, y)
          if (!started) {
            ctx.moveTo(x, y)
            started = true
          } else ctx.lineTo(x, y)
        }
      }
      for (let i = pts.length - 1; i >= 0; i--) {
        const c = pts[i]
        const envTv = interpEnvTv(analysis, c.p)
        const b = c.tv - envTv
        if (use(c, b)) {
          const y = yFromP(d, c.p)
          ctx.lineTo(xFromTY(d, envTv - 273.15, y), y)
        }
      }
      ctx.closePath()
      ctx.fillStyle = positive ? PAL.capeFill : PAL.cinFill
      ctx.fill()
    }
    region(true)
    region(false)
  }

  // ── wet-bulb profile
  if (ov.wetBulb) {
    const sub = displayLevels(snd, 160)
    ctx.strokeStyle = PAL.wetbulb
    ctx.lineWidth = 1.1
    tracePath(
      ctx, d,
      sub
        .filter((l) => Number.isFinite(l.t) && Number.isFinite(l.td))
        .map((l) => ({ p: l.p, v: wetBulb(l.t, l.td, l.p) })),
    )
    ctx.stroke()
  }

  // ── virtual temperature (env)
  if (ov.virtualTemp && analysis) {
    const prof = analysis.prof
    ctx.strokeStyle = PAL.virtual
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    const pts = []
    for (let i = 0; i < prof.p.length; i++) pts.push({ p: prof.p[i], v: prof.tv[i] - 273.15 })
    tracePath(ctx, d, pts)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ── parcel ascent curve
  if (parcel && ov.parcel) {
    ctx.strokeStyle = PAL.parcel
    ctx.lineWidth = 1.4
    ctx.setLineDash([5, 4])
    tracePath(ctx, d, parcel.curve.map((c) => ({ p: c.p, v: c.tv - 273.15 })))
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ── dewpoint & temperature
  ctx.lineJoin = 'round'
  ctx.strokeStyle = PAL.dewpoint
  ctx.lineWidth = 1.8
  tracePath(ctx, d, ls.map((l) => ({ p: l.p, v: l.td })))
  ctx.stroke()

  ctx.strokeStyle = PAL.temp
  ctx.lineWidth = 2
  tracePath(ctx, d, ls.map((l) => ({ p: l.p, v: l.t })))
  ctx.stroke()

  ctx.restore()

  // ── LCL / LFC / EL markers (right inside edge)
  if (parcel && ov.parcel) {
    const markers: { p: number; label: string }[] = []
    if (Number.isFinite(parcel.lclP)) markers.push({ p: parcel.lclP, label: 'LCL' })
    if (Number.isFinite(parcel.lfcP)) markers.push({ p: parcel.lfcP, label: 'LFC' })
    if (Number.isFinite(parcel.elP)) markers.push({ p: parcel.elP, label: 'EL' })
    ctx.font = '600 8.5px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    let lastLabelY = Infinity
    for (const m of markers.sort((a, b) => b.p - a.p)) {
      if (m.p > d.pBot || m.p < d.pTop) continue
      const y = yFromP(d, m.p)
      ctx.strokeStyle = PAL.marker
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(d.x0 + d.w - 22, y)
      ctx.lineTo(d.x0 + d.w - 4, y)
      ctx.stroke()
      ctx.fillStyle = PAL.marker
      // stack labels that would collide
      let ly = y - 6
      if (lastLabelY - ly < 11) ly = lastLabelY - 11
      ctx.fillText(m.label, d.x0 + d.w - 21, ly)
      lastLabelY = ly
    }
  }

  // ── effective inflow layer bracket (inside-right)
  if (analysis?.eil) {
    const { bottomP, topP } = analysis.eil
    if (bottomP <= d.pBot && topP >= d.pTop) {
      const yB = yFromP(d, bottomP)
      const yT = yFromP(d, topP)
      const x = d.x0 + d.w - 34
      ctx.strokeStyle = '#c792ea'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(x + 5, yB)
      ctx.lineTo(x, yB)
      ctx.lineTo(x, yT)
      ctx.lineTo(x + 5, yT)
      ctx.stroke()
      ctx.fillStyle = '#c792ea'
      ctx.font = '600 8.5px ui-monospace, Menlo, monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText('EIL', x - 3, (yB + yT) / 2)
      ctx.textAlign = 'left'
    }
  }

  // ── freezing level
  if (analysis && Number.isFinite(analysis.freezingLevelP)) {
    const p = analysis.freezingLevelP
    if (p <= d.pBot && p >= d.pTop && analysis.prof.t[0] > 0) {
      const y = yFromP(d, p)
      ctx.strokeStyle = 'rgba(127, 192, 232, 0.4)'
      ctx.setLineDash([6, 5])
      ctx.beginPath()
      ctx.moveTo(d.x0, y)
      ctx.lineTo(d.x0 + d.w, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = PAL.freezing
      ctx.font = '8.5px ui-monospace, Menlo, monospace'
      ctx.textAlign = 'left'
      ctx.fillText('0°C', d.x0 + 4, y - 6)
    }
  }

  // ── height labels (km MSL) on inside-left
  if (ov.heightLabels) {
    ctx.font = '8.5px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const zp: { z: number; p: number }[] = snd.levels
      .filter((l) => Number.isFinite(l.z))
      .map((l) => ({ z: l.z, p: l.p }))
    if (zp.length > 2) {
      for (let km = 1; km <= 30; km++) {
        const zT = km * 1000
        let p = NaN
        for (let i = 0; i < zp.length - 1; i++) {
          if (zp[i].z <= zT && zp[i + 1].z > zT) {
            const f = (zT - zp[i].z) / (zp[i + 1].z - zp[i].z)
            p = Math.exp(Math.log(zp[i].p) + f * (Math.log(zp[i + 1].p) - Math.log(zp[i].p)))
            break
          }
        }
        if (!Number.isFinite(p) || p > d.pBot || p < d.pTop) continue
        const y = yFromP(d, p)
        ctx.strokeStyle = PAL.labelDim
        ctx.beginPath()
        ctx.moveTo(d.x0, y)
        ctx.lineTo(d.x0 + 5, y)
        ctx.stroke()
        ctx.fillStyle = PAL.labelDim
        ctx.fillText(`${km}`, d.x0 + 8, y)
      }
    }
  }

  // ── wind barbs column
  if (ov.windBarbs) {
    drawWindBarbs(ctx, d, snd)
  }
}

function interpEnvTv(analysis: Analysis, p: number): number {
  const prof = analysis.prof
  const ps = prof.p
  if (p >= ps[0]) return prof.tv[0]
  const n = ps.length
  if (p <= ps[n - 1]) return prof.tv[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ps[mid] > p) lo = mid
    else hi = mid
  }
  const f = (Math.log(ps[lo]) - Math.log(p)) / (Math.log(ps[lo]) - Math.log(ps[hi]))
  return prof.tv[lo] + f * (prof.tv[hi] - prof.tv[lo])
}

/** Standard wind barb: half=5 kt, full=10 kt, flag=50 kt. Staff points in the
 *  direction the wind comes FROM. */
function drawWindBarbs(ctx: CanvasRenderingContext2D, d: SkewTDims, snd: Sounding) {
  const x = d.x0 + d.w + 30
  const spacing = 26
  const withWind = snd.levels.filter(
    (l) => Number.isFinite(l.wdir) && Number.isFinite(l.wspd) && l.p <= d.pBot && l.p >= d.pTop,
  )
  if (!withWind.length) return
  let lastY = Infinity
  ctx.strokeStyle = PAL.barb
  ctx.fillStyle = PAL.barb
  ctx.lineWidth = 1
  for (const l of withWind) {
    const y = yFromP(d, l.p)
    if (lastY - y < spacing && l !== withWind[withWind.length - 1]) continue
    lastY = y
    const kt = l.wspd * MS2KT
    drawBarb(ctx, x, y, l.wdir, kt)
  }
  // column separator
  ctx.strokeStyle = PAL.gridMinor
  ctx.beginPath()
  ctx.moveTo(d.x0 + d.w + 8, d.y0)
  ctx.lineTo(d.x0 + d.w + 8, d.y0 + d.h)
  ctx.stroke()
}

function drawBarb(ctx: CanvasRenderingContext2D, x: number, y: number, dirFrom: number, kt: number) {
  const len = 21
  ctx.save()
  ctx.translate(x, y)
  if (kt < 2.5) {
    // calm: open circle
    ctx.beginPath()
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }
  ctx.rotate(((dirFrom + 180) * Math.PI) / 180) // staff extends toward the source
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, -len)
  ctx.stroke()
  // dot at the observation point
  ctx.beginPath()
  ctx.arc(0, 0, 1.4, 0, Math.PI * 2)
  ctx.fill()

  let rem = Math.round(kt / 5) * 5
  let yPos = -len
  const step = 3.6
  const flagW = 7
  while (rem >= 50) {
    ctx.beginPath()
    ctx.moveTo(0, yPos)
    ctx.lineTo(flagW, yPos + 2.4)
    ctx.lineTo(0, yPos + 4.8)
    ctx.closePath()
    ctx.fill()
    yPos += 5.6
    rem -= 50
  }
  while (rem >= 10) {
    ctx.beginPath()
    ctx.moveTo(0, yPos)
    ctx.lineTo(8.5, yPos - 3)
    ctx.stroke()
    yPos += step
    rem -= 10
  }
  if (rem >= 5) {
    if (yPos === -len) yPos += step // half barb never at the very tip
    ctx.beginPath()
    ctx.moveTo(0, yPos)
    ctx.lineTo(4.5, yPos - 1.6)
    ctx.stroke()
  }
  ctx.restore()
}

/** Hover crosshair on the overlay canvas. */
export function drawHover(
  ctx: CanvasRenderingContext2D,
  d: SkewTDims,
  snd: Sounding,
  p: number,
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (p > d.pBot || p < d.pTop) return
  const y = yFromP(d, p)
  ctx.strokeStyle = 'rgba(238, 243, 250, 0.25)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(d.x0, y)
  ctx.lineTo(d.x0 + d.w, y)
  ctx.stroke()
  ctx.setLineDash([])

  // markers on curves at this pressure
  const lv = nearestLevel(snd, p)
  if (lv) {
    if (Number.isFinite(lv.t)) {
      dot(ctx, xFromTY(d, lv.t, y), y, PAL.temp)
    }
    if (Number.isFinite(lv.td)) {
      dot(ctx, xFromTY(d, lv.td, y), y, PAL.dewpoint)
    }
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.beginPath()
  ctx.arc(x, y, 3.2, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = '#07090c'
  ctx.lineWidth = 1.2
  ctx.stroke()
}

export function nearestLevel(snd: Sounding, p: number) {
  const ls = snd.levels
  if (!ls.length) return null
  // levels sorted descending in p — binary search
  let lo = 0
  let hi = ls.length - 1
  if (p >= ls[0].p) return ls[0]
  if (p <= ls[hi].p) return ls[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ls[mid].p > p) lo = mid
    else hi = mid
  }
  return Math.abs(ls[lo].p - p) < Math.abs(ls[hi].p - p) ? ls[lo] : ls[hi]
}
