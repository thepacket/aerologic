import type { ReactNode } from 'react'
import { useStore } from '../state/store'
import { MS2KT, dirSpeedFromUV } from '../met/kinematics'
import type { ParcelResult } from '../met/parcel'
import { pwClimo } from '../met/pwclimo'
import { Section } from './Section'

function Row({ k, v, cls }: { k: string; v: ReactNode; cls?: string }) {
  return (
    <div className="idx-row">
      <span className="idx-k">{k}</span>
      <span className={`idx-v ${cls ?? ''}`}>{v}</span>
    </div>
  )
}

const f = (v: number, d = 0, unit = '') =>
  Number.isFinite(v) ? `${v.toFixed(d)}${unit}` : '—'

/** severity grade → CSS class */
function grade(v: number, warn: number, hot: number, invert = false): string {
  if (!Number.isFinite(v)) return ''
  const x = invert ? -v : v
  if (x >= hot) return 'idx-hot'
  if (x >= warn) return 'idx-warn'
  return ''
}

function ParcelBlock({ p, elev }: { p: ParcelResult; elev: number }) {
  return (
    <>
      <Row k="CAPE" v={f(p.cape, 0, ' J/kg')} cls={grade(p.cape, 1000, 2500)} />
      <Row k="CIN" v={f(p.cin, 0, ' J/kg')} cls={grade(p.cin, -100, -25, true) && 'idx-cool'} />
      <Row k="LI" v={f(p.li, 1, ' °C')} cls={grade(-p.li, 4, 7)} />
      <Row
        k="LCL"
        v={
          Number.isFinite(p.lclP)
            ? `${p.lclP.toFixed(0)} hPa · ${((p.lclZ - elev)).toFixed(0)} m`
            : '—'
        }
      />
      <Row
        k="LFC"
        v={
          Number.isFinite(p.lfcP)
            ? `${p.lfcP.toFixed(0)} hPa · ${((p.lfcZ - elev)).toFixed(0)} m`
            : 'none'
        }
      />
      <Row
        k="EL"
        v={
          Number.isFinite(p.elP)
            ? `${p.elP.toFixed(0)} hPa · ${((p.elZ - elev) / 1000).toFixed(1)} km`
            : 'none'
        }
      />
      <Row k="Cap" v={f(p.capStrength, 1, ' °C')} cls={grade(p.capStrength, 2, 4)} />
    </>
  )
}

export function IndicesPanel() {
  const analysis = useStore((s) => s.analysis)
  const sounding = useStore((s) => s.sounding)
  const parcelKind = useStore((s) => s.parcelKind)
  const setParcelKind = useStore((s) => s.setParcelKind)
  const windUnit = useStore((s) => s.windUnit)

  if (!analysis || !sounding) return null
  const a = analysis
  const elev = sounding.levels[0].z
  const parcel = parcelKind === 'sb' ? a.sb : parcelKind === 'ml' ? a.ml : a.mu

  const spd = (ms: number) =>
    windUnit === 'kt'
      ? f(ms * MS2KT, 0, ' kt')
      : windUnit === 'kmh'
        ? f(ms * 3.6, 0, ' km/h')
        : f(ms, 1, ' m/s')

  return (
    <>
      <Section title="Parcel" id="parcel">
        <div className="segmented parcel-seg">
          {(['sb', 'ml', 'mu'] as const).map((k) => (
            <button
              key={k}
              className="seg-btn"
              data-active={parcelKind === k}
              onClick={() => setParcelKind(k)}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>
        <ParcelBlock p={parcel} elev={elev} />
        <div className="idx-compare">
          <div className="idx-compare-head">
            <span>—</span><span>SB</span><span>ML</span><span>MU</span>
          </div>
          <div className="idx-compare-row">
            <span>CAPE</span>
            <span>{f(a.sb.cape)}</span>
            <span>{f(a.ml.cape)}</span>
            <span>{f(a.mu.cape)}</span>
          </div>
          <div className="idx-compare-row">
            <span>CIN</span>
            <span>{f(a.sb.cin)}</span>
            <span>{f(a.ml.cin)}</span>
            <span>{f(a.mu.cin)}</span>
          </div>
        </div>
      </Section>

      <Section title="Thermodynamics" id="thermo">
        <Row k="PW" v={f(a.pw, 1, ' mm')} cls={grade(a.pw, 35, 50)} />
        {(() => {
          const month = new Date(sounding.validTime).getUTCMonth()
          const climo = pwClimo(sounding.station.id, month, a.pw)
          if (!climo) return null
          const s = climo.sigma
          return (
            <Row
              k="vs climo"
              v={`${s >= 0 ? '+' : ''}${s.toFixed(1)}σ · mean ${climo.meanMM.toFixed(0)} mm`}
              cls={s >= 2 ? 'idx-hot' : s >= 1 ? 'idx-warn' : ''}
            />
          )
        })()}
        <Row k="K index" v={f(a.k, 0)} cls={grade(a.k, 30, 38)} />
        <Row k="Totals" v={f(a.totalTotals, 0)} cls={grade(a.totalTotals, 48, 54)} />
        <Row k="SWEAT" v={f(a.sweat, 0)} cls={grade(a.sweat, 300, 400)} />
        <Row k="Showalter" v={f(a.showalter, 1)} cls={grade(-a.showalter, 2, 5)} />
        <Row k="DCAPE" v={f(a.dcape, 0, ' J/kg')} cls={grade(a.dcape, 800, 1200)} />
        <Row k="Γ 0–3 km" v={f(a.lapse03, 1, ' °C/km')} cls={grade(a.lapse03, 7, 8.5)} />
        <Row k="Γ 3–6 km" v={f(a.lapse36, 1, ' °C/km')} cls={grade(a.lapse36, 7, 8.5)} />
        <Row k="Γ 700–500" v={f(a.lapse700500, 1, ' °C/km')} cls={grade(a.lapse700500, 7, 8.5)} />
        <Row k="FZL" v={f(a.freezingLevelZ, 0, ' m AGL')} />
        <Row k="WBZ" v={f(a.wbzZ, 0, ' m AGL')} />
        <Row
          k="θe min"
          v={
            Number.isFinite(a.thetaEMin.value)
              ? `${a.thetaEMin.value.toFixed(0)} K @ ${a.thetaEMin.p.toFixed(0)} hPa`
              : '—'
          }
        />
      </Section>

      <Section title="Kinematics" id="kine">
        <Row k="Shear 0–1" v={spd(a.shear1)} cls={grade(a.shear1 * MS2KT, 15, 25)} />
        <Row k="Shear 0–3" v={spd(a.shear3)} cls={grade(a.shear3 * MS2KT, 25, 35)} />
        <Row k="Shear 0–6" v={spd(a.shear6)} cls={grade(a.shear6 * MS2KT, 30, 45)} />
        <Row k="Shear 0–8" v={spd(a.shear8)} />
        <Row k="SRH 0–1" v={f(a.srh1, 0, ' m²/s²')} cls={grade(a.srh1, 100, 200)} />
        <Row k="SRH 0–3" v={f(a.srh3, 0, ' m²/s²')} cls={grade(a.srh3, 150, 300)} />
        <Row k="SRH 0–1 LM" v={f(a.srh1Left, 0)} />
        <Row k="Crit angle" v={f(a.criticalAngle, 0, '°')} />
      </Section>

      <Section title="Effective layer" id="eff">
        {a.eil ? (
          <>
            <Row
              k="Inflow"
              v={`${(a.eil.bottomZ - elev).toFixed(0)}–${(a.eil.topZ - elev).toFixed(0)} m`}
            />
            <Row
              k=""
              v={`${a.eil.bottomP.toFixed(0)}–${a.eil.topP.toFixed(0)} hPa`}
            />
            <Row k="ESRH" v={f(a.eff.esrh, 0, ' m²/s²')} cls={grade(a.eff.esrh, 150, 300)} />
            <Row k="EBWD" v={spd(a.eff.ebwd)} cls={grade(a.eff.ebwd * MS2KT, 25, 40)} />
          </>
        ) : (
          <div className="idx-note">no effective inflow layer (CAPE &lt; 100 J/kg)</div>
        )}
      </Section>

      <Section title="Composites" id="comp">
        <div className="idx-compare">
          <div className="idx-compare-head">
            <span>—</span><span>fixed</span><span>eff</span><span />
          </div>
          <div className="idx-compare-row">
            <span>SCP</span>
            <span className={grade(a.scp, 1, 4)}>{f(a.scp, 1)}</span>
            <span className={grade(a.eff.scpEff, 1, 4)}>{f(a.eff.scpEff, 1)}</span>
            <span />
          </div>
          <div className="idx-compare-row">
            <span>STP</span>
            <span className={grade(a.stp, 1, 3)}>{f(a.stp, 1)}</span>
            <span className={grade(a.eff.stpEff, 1, 3)}>{f(a.eff.stpEff, 1)}</span>
            <span />
          </div>
        </div>
        <Row k="SHIP" v={f(a.ship, 1)} cls={grade(a.ship, 1, 2)} />
      </Section>

      <Section title="Soaring" id="soar">
        <Row k="CCL" v={Number.isFinite(a.cclP) ? `${a.cclP.toFixed(0)} hPa · ${(a.cclZ - elev).toFixed(0)} m` : '—'} />
        <Row k="Trigger T" v={f(a.tconv, 1, ' °C')} />
        <Row k="Thermal top" v={f(a.thermalTopNow, 0, ' m AGL')} />
        <Row k="@ trigger" v={f(a.thermalTopTrigger, 0, ' m AGL')} />
      </Section>

      <Section title="Fire wx" id="fire">
        <Row
          k={`Haines (${a.fire.hainesVariant})`}
          v={f(a.fire.haines, 0)}
          cls={grade(a.fire.haines, 5, 6)}
        />
        <Row k="Mixing hgt" v={f(a.fire.mixingHeight, 0, ' m AGL')} />
        <Row
          k="Transport"
          v={
            Number.isFinite(a.fire.transportWind.u)
              ? (() => {
                  const d = dirSpeedFromUV(a.fire.transportWind.u, a.fire.transportWind.v)
                  return `${d.dir.toFixed(0).padStart(3, '0')}° ${spd(d.spd)}`
                })()
              : '—'
          }
        />
      </Section>

      <Section title="Winter" id="winter">
        {a.dgz ? (
          <>
            <Row k="DGZ" v={`${a.dgz.bottomP.toFixed(0)}–${a.dgz.topP.toFixed(0)} hPa`} />
            <Row k="DGZ depth" v={f(a.dgz.depth, 0, ' m')} />
            <Row
              k="DGZ RH"
              v={f(a.dgz.meanRH, 0, ' %')}
              cls={a.dgz.meanRH > 80 ? 'idx-cool' : ''}
            />
          </>
        ) : (
          <div className="idx-note">−12…−18 °C layer not in profile</div>
        )}
      </Section>

      <Section title="Layers" id="layers">
        {a.layers.length === 0 && <div className="idx-note">no saturated layers detected</div>}
        {a.layers.map((l, i) => (
          <Row
            key={i}
            k={l.kind === 'cloud' ? 'Cloud' : 'Icing'}
            v={`${(l.bottomZ - elev).toFixed(0)}–${(l.topZ - elev).toFixed(0)} m`}
            cls={l.kind === 'icing' ? 'idx-cool' : ''}
          />
        ))}
      </Section>
    </>
  )
}
