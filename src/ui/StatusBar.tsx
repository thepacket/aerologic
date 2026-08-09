import { useStore } from '../state/store'

export function StatusBar() {
  const sounding = useStore((s) => s.sounding)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)
  const mode = useStore((s) => s.mode)

  let stateText = 'idle'
  let stateClass = 'ok'
  if (loading) {
    stateText = 'loading'
    stateClass = 'busy'
  } else if (error) {
    stateText = error
    stateClass = 'err'
  } else if (sounding) {
    stateText = 'ready'
  }

  const details: string[] = []
  if (sounding) {
    details.push(`${sounding.levels.length} levels`)
    const top = sounding.levels[sounding.levels.length - 1]
    details.push(`top ${top.p.toFixed(0)} hPa / ${(top.z / 1000).toFixed(1)} km`)
    if (sounding.launchTime) {
      details.push(`launched ${sounding.launchTime.slice(11, 16)}Z`)
      const last = sounding.levels[sounding.levels.length - 1]
      if (last.dt) details.push(`ascent ${(last.dt / 60).toFixed(0)} min`)
    }
    details.push(
      sounding.source.kind === 'obs'
        ? `UWyo archive · ${sounding.source.src}`
        : `Open-Meteo · ${sounding.source.model}`,
    )
  }

  return (
    <footer className="statusbar">
      <span className={`status-dot ${stateClass}`} />
      <span className="status-state">{stateText}</span>
      {details.map((d, i) => (
        <span key={i} className="status-item">
          {d}
        </span>
      ))}
      <span className="status-spacer" />
      <span className="status-hint">
        {mode === 'obs' ? 'wheel zoom · double-click reset · hover inspect' : 'drag slider to scrub forecast hours'}
      </span>
    </footer>
  )
}
