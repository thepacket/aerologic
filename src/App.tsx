import { useEffect } from 'react'
import { useStore } from './state/store'
import { customPoint, initPermalink, parseHash } from './state/permalink'
import { TitleBar } from './ui/TitleBar'
import { StationPanel } from './ui/StationPanel'
import { IndicesPanel } from './ui/IndicesPanel'
import { Hodograph } from './ui/Hodograph'
import { DriftMap } from './ui/DriftMap'
import { Profiles } from './ui/Profiles'
import { SarsPanel } from './ui/SarsPanel'
import { StatusBar } from './ui/StatusBar'
import { Section } from './ui/Section'
import { SkewTCanvas } from './skewt/SkewTCanvas'
import { TimeHeight } from './timeheight/TimeHeight'

export default function App() {
  const leftOpen = useStore((s) => s.leftOpen)
  const rightOpen = useStore((s) => s.rightOpen)
  const analysis = useStore((s) => s.analysis)
  const mode = useStore((s) => s.mode)
  const stageView = useStore((s) => s.stageView)

  useEffect(() => {
    initPermalink()
    void (async () => {
      const hash = parseHash()
      const st = useStore.getState()
      if (hash?.cycle) useStore.setState({ cycle: hash.cycle })
      if (hash?.model) useStore.setState({ model: hash.model })
      if (hash?.mode) useStore.setState({ mode: hash.mode })

      await st.loadStations()
      const { stations, selectStation, selected } = useStore.getState()
      if (selected) return

      if (hash?.point) {
        await selectStation(customPoint(hash.point.lat, hash.point.lon))
        return
      }
      if (stations.length === 0) return
      const target =
        (hash?.stationId && stations.find((s) => s.stationid === hash.stationId)) ||
        stations.find((s) => s.stationid === '71722') ||
        stations.find((s) => s.src === 'BUFR') ||
        stations[0]
      await selectStation(target)

      // restore forecast hour from permalink once the forecast is loaded
      if (hash?.mode === 'fcst' && hash.hour) {
        const { forecast, setForecastHour } = useStore.getState()
        const idx = forecast?.hours.indexOf(hash.hour) ?? -1
        if (idx >= 0) setForecastHour(idx)
      }
    })()
  }, [])

  return (
    <div className="shell">
      <TitleBar />
      <div className="shell-body">
        {leftOpen && <StationPanel />}
        <main className="stage">
          {mode === 'fcst' && stageView === 'th' ? <TimeHeight /> : <SkewTCanvas />}
        </main>
        {rightOpen && (
          <aside className="panel right">
            <div className="panel-head">
              <span className="panel-title">Analysis</span>
            </div>
            <div className="panel-body">
              {analysis ? (
                <>
                  <IndicesPanel />
                  <Section title="SARS analogues" id="sars">
                    <SarsPanel />
                  </Section>
                  <Section title="Hodograph" id="hodo">
                    <Hodograph />
                  </Section>
                  <Section title="Profiles" id="profiles">
                    <Profiles />
                  </Section>
                  <Section title="Balloon drift" id="drift">
                    <DriftMap />
                  </Section>
                </>
              ) : (
                <div className="panel-empty">no sounding loaded</div>
              )}
            </div>
          </aside>
        )}
      </div>
      <StatusBar />
    </div>
  )
}
