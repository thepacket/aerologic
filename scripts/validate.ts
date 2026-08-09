/** Physics validation: parse a saved Wyoming CSV and compare computed indices
 *  with the archive's own INDICES output. Run: npx tsx scripts/validate.ts <csv> */
import { readFileSync } from 'node:fs'
import { parseWyomingCSV } from '../src/data/wyoming.ts'
import { analyzeSounding } from '../src/met/indices.ts'
import { dirSpeedFromUV, MS2KT } from '../src/met/kinematics.ts'

const csvPath = process.argv[2] ?? 'scratchpad/snd.csv'
const text = readFileSync(csvPath, 'utf-8')
const snd = parseWyomingCSV(
  text,
  { stationid: '71722', name: 'Maniwaki', lat: 46.14, lon: -76.08, src: 'BUFR' },
  '2026-08-08 12:00:00',
  'BUFR',
)
console.log(`levels: ${snd.levels.length}, sfc p=${snd.levels[0].p} z=${snd.levels[0].z}`)
const t0 = performance.now()
const a = analyzeSounding(snd)!
console.log(`analysis in ${(performance.now() - t0).toFixed(1)} ms`)

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—')
console.log(`
                 computed   Wyoming
MUCAPE           ${fmt(a.mu.cape)}     1029.1
MUCIN            ${fmt(a.mu.cin)}        0
SBCAPE           ${fmt(a.sb.cape)}
MLCAPE           ${fmt(a.ml.cape)}
SB LI            ${fmt(a.sb.li)}       (virt LI -3.8)
Showalter        ${fmt(a.showalter)}      -0.9
K index          ${fmt(a.k)}      32.5
Total Totals     ${fmt(a.totalTotals)}      48.1
SWEAT            ${fmt(a.sweat)}     177.7
DCAPE            ${fmt(a.dcape)}     999.6
PW mm            ${fmt(a.pw)}      34.9
SB LCL p         ${fmt(a.sb.lclP)}     950.0
SB LCL T         ${fmt(a.sb.lclT)}      18.6
SB LCL z AGL     ${fmt(a.sb.lclZ - a.prof.z[0], 0)}       571
SB LFC p         ${fmt(a.sb.lfcP)}
SB EL p          ${fmt(a.sb.elP)}
freezing lvl km  ${fmt(a.freezingLevelZ / 1000, 2)}
lapse 0-3        ${fmt(a.lapse03, 2)}
lapse 700-500    ${fmt(a.lapse700500, 2)}
shear 0-6 kt     ${fmt(a.shear6 * MS2KT)}
SRH 0-3          ${fmt(a.srh3)}
SRH 0-1          ${fmt(a.srh1)}
Bunkers RM       ${(() => { const d = dirSpeedFromUV(a.bunkersRight.u, a.bunkersRight.v); return `${fmt(d.dir, 0)}° ${fmt(d.spd * MS2KT)} kt` })()}
critical angle   ${fmt(a.criticalAngle, 0)}
SCP              ${fmt(a.scp, 2)}
STP              ${fmt(a.stp, 2)}
SHIP             ${fmt(a.ship, 2)}
`)

// gap-feature additions
console.log(`EIL              ${a.eil ? `${(a.eil.bottomZ - a.prof.z[0]).toFixed(0)}-${(a.eil.topZ - a.prof.z[0]).toFixed(0)} m AGL` : 'none'}
ESRH             ${fmt(a.eff.esrh)}
EBWD kt          ${fmt(a.eff.ebwd * MS2KT)}
SCP eff          ${fmt(a.eff.scpEff, 2)}
STP eff          ${fmt(a.eff.stpEff, 2)}
CCL              ${fmt(a.cclP, 0)} hPa   (Wyoming: 909)
Tconv            ${fmt(a.tconv, 1)} °C   (Wyoming: 25.2)
thermal top now  ${fmt(a.thermalTopNow, 0)} m AGL
thermal top trig ${fmt(a.thermalTopTrigger, 0)} m AGL
Haines (${a.fire.hainesVariant})     ${fmt(a.fire.haines, 0)}
mixing height    ${fmt(a.fire.mixingHeight, 0)} m
DGZ              ${a.dgz ? `${a.dgz.bottomP.toFixed(0)}-${a.dgz.topP.toFixed(0)} hPa, ${a.dgz.depth.toFixed(0)} m, RH ${a.dgz.meanRH.toFixed(0)}%` : 'none'}
layers           ${a.layers.map((l) => `${l.kind} ${(l.bottomZ - a.prof.z[0]).toFixed(0)}-${(l.topZ - a.prof.z[0]).toFixed(0)}m`).join(' | ') || 'none'}`)
