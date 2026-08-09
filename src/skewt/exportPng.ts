/** PNG export of the current Skew-T canvas with a small caption header. */
let baseCanvas: HTMLCanvasElement | null = null

export function registerSkewTCanvas(c: HTMLCanvasElement | null) {
  baseCanvas = c
}

export function exportSkewTPng(title: string, subtitle: string) {
  if (!baseCanvas) return
  const dpr = window.devicePixelRatio || 1
  const header = Math.round(34 * dpr)
  const out = document.createElement('canvas')
  out.width = baseCanvas.width
  out.height = baseCanvas.height + header
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#07090c'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.fillStyle = '#eef3fa'
  ctx.font = `600 ${Math.round(12 * dpr)}px -apple-system, system-ui, sans-serif`
  ctx.fillText(title, Math.round(12 * dpr), Math.round(15 * dpr))
  ctx.fillStyle = '#93a1b5'
  ctx.font = `${Math.round(10 * dpr)}px ui-monospace, Menlo, monospace`
  ctx.fillText(subtitle + '  ·  aerologic', Math.round(12 * dpr), Math.round(28 * dpr))
  ctx.drawImage(baseCanvas, 0, header)
  out.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `skewt-${title.replace(/[^\w-]+/g, '_')}-${subtitle.replace(/[^\w-]+/g, '_')}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  })
}
