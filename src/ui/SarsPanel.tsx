import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { mixingRatio } from '../met/thermo'
import { MS2KT } from '../met/kinematics'
import { interpProfile } from '../met/parcel'
import type { SarsResult } from '../met/sars'

/** The SARS databases are ~160 KB of text, so the module (data included) is
 *  code-split into its own immutable chunk and fetched on first use. */
type SarsModule = typeof import('../met/sars')
let sarsModulePromise: Promise<SarsModule> | null = null
function loadSars(): Promise<SarsModule> {
  sarsModulePromise ??= import('../met/sars')
  return sarsModulePromise
}

function MatchList({ res }: { res: SarsResult }) {
  if (res.quality.length === 0) {
    return <div className="idx-note">no quality analogues</div>
  }
  return (
    <div className="sars-list">
      {res.quality.map((m, i) => (
        <div className="sars-row" key={i}>
          <span className="sars-date">{m.label}</span>
          <span className="sars-outcome" data-grade={m.grade}>
            {m.outcome}
          </span>
        </div>
      ))}
    </div>
  )
}

/** SARS analogues: match the current sounding against the SPC hail and
 *  supercell proximity-sounding databases (via SHARPpy, BSD). */
export function SarsPanel() {
  const analysis = useStore((s) => s.analysis)
  const [sars, setSars] = useState<SarsModule | null>(null)

  useEffect(() => {
    let alive = true
    void loadSars().then((m) => {
      if (alive) setSars(m)
    })
    return () => {
      alive = false
    }
  }, [])

  const model = useMemo(() => {
    if (!analysis || !sars) return null
    const a = analysis
    const t500 = interpProfile(a.prof, 't', 500)
    const elev = a.prof.z[0]

    const hail = sars.sarsHail({
      mumr: mixingRatio(a.mu.td0, a.mu.p0) * 1000,
      mucape: a.mu.cape,
      t500,
      lr75: a.lapse700500,
      shr3: a.shear3,
      shr6: a.shear6,
      shr9: a.shear9,
      srh3: a.srh3,
    })
    const supercell = sars.sarsSupercell({
      mlcape: a.ml.cape,
      mllcl: a.ml.lclZ - elev,
      t500,
      lr75: a.lapse700500,
      shr6kt: a.shear6 * MS2KT,
      shr3kt: a.shear3 * MS2KT,
      shr9kt: a.shear9 * MS2KT,
      srh1: a.srh1,
      srh3: a.srh3,
    })
    if (!hail && !supercell) return null
    return { hail, supercell }
  }, [analysis, sars])

  if (!sars) return <div className="panel-empty">loading databases…</div>
  if (!model) return <div className="panel-empty">needs CAPE + wind data</div>

  return (
    <>
      {model.hail && (
        <div className="sars-block">
          <div className="sars-head">
            <span>HAIL</span>
            <span className="sars-prob" data-hot={model.hail.prob >= 0.5}>
              {model.hail.looseCount > 0
                ? `${(model.hail.prob * 100).toFixed(0)}% sig · ${model.hail.looseCount} matches`
                : 'no matches'}
            </span>
          </div>
          {model.hail.looseCount > 0 && model.hail.avgSize !== undefined && (
            <div className="idx-note">mean size of matches {model.hail.avgSize.toFixed(1)}"</div>
          )}
          <MatchList res={model.hail} />
        </div>
      )}
      {model.supercell && (
        <div className="sars-block">
          <div className="sars-head">
            <span>SUPERCELL</span>
            <span className="sars-prob" data-hot={model.supercell.prob >= 0.5}>
              {model.supercell.looseCount > 0
                ? `${(model.supercell.prob * 100).toFixed(0)}% tor · ${model.supercell.looseCount} matches`
                : 'no matches'}
            </span>
          </div>
          <MatchList res={model.supercell} />
        </div>
      )}
      <div className="idx-note">SPC databases via SHARPpy (Jewell, Thompson)</div>
    </>
  )
}
