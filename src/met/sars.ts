/** SARS — Sounding Analogue Retrieval System.
 *
 *  Port of the SPC algorithm as implemented in SHARPpy (sharppy/databases/
 *  sars.py, BSD licence). Databases of proximity soundings to hail events
 *  (Ryan Jewell, SPC) and to tornadic/nontornadic supercells (Rich Thompson,
 *  SPC). Two-tier range matching: "loose" matches drive the probabilities,
 *  tight "quality" matches are shown as analogues. */
import hailRaw from '../assets/sars_hail.txt?raw'
import supercellRaw from '../assets/sars_supercell.txt?raw'

export interface SarsMatch {
  /** e.g. "23 May 1995 00Z · DDC" */
  label: string
  /** hail size (in) or tornado class label */
  outcome: string
  /** severity bucket for styling: 0 none, 1 weak/sub-sig, 2 sig */
  grade: 0 | 1 | 2
}

export interface SarsResult {
  looseCount: number
  /** probability (0–1) of sig event among loose matches */
  prob: number
  /** mean hail size of loose matches, in (hail only) */
  avgSize?: number
  quality: SarsMatch[]
}

/** "95052300.DDC" / "00042320.TXK" → "23 May 1995 00Z · DDC" */
function formatId(id: string): string {
  const m = id.match(/^(\d{2})(\d{2})(\d{2})(\d{2})\.?(.*)$/)
  if (!m) return id
  const [, yy, mm, dd, hh, stn] = m
  const year = Number(yy) >= 50 ? 1900 + Number(yy) : 2000 + Number(yy)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const mon = months[Number(mm) - 1] ?? mm
  return `${Number(dd)} ${mon} ${year} ${hh}Z${stn ? ` · ${stn}` : ''}`
}

function parseTable(raw: string): number[][] & { ids?: string[] } {
  const rows: number[][] = []
  const ids: string[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('%') || /^(DATE|FILENAME)/i.test(t)) continue
    const cols = t.split(/\s+/)
    if (cols.length < 13) continue
    const nums = cols.map((c, i) => (i === 0 ? NaN : parseFloat(c)))
    if (!Number.isFinite(nums[3])) continue
    ids.push(cols[0])
    rows.push(nums)
  }
  const out = rows as number[][] & { ids?: string[] }
  out.ids = ids
  return out
}

let hailDB: (number[][] & { ids?: string[] }) | null = null
let supercellDB: (number[][] & { ids?: string[] }) | null = null

const MAX_QUALITY = 15

export interface HailParams {
  /** MU parcel mixing ratio g/kg */
  mumr: number
  mucape: number
  /** 500 hPa temperature °C */
  t500: number
  /** 700–500 lapse rate °C/km */
  lr75: number
  /** bulk shear m/s */
  shr3: number
  shr6: number
  shr9: number
  /** 0–3 km SRH m²/s² */
  srh3: number
}

/** Hail DB columns: 0 id, 1 elev, 2 size(in), 3 MUCAPE, 4 MUMR, 5 500T,
 *  6 300T, 7 LR75, 8 LR53, 9 SHR3, 10 SHR6, 11 SHR9, 12 SRH3, 13 SHIP. */
export function sarsHail(p: HailParams): SarsResult | null {
  if (![p.mumr, p.mucape, p.t500, p.lr75, p.shr3, p.shr6, p.shr9].every(Number.isFinite)) {
    return null
  }
  if (!hailDB) hailDB = parseTable(hailRaw)
  const db = hailDB
  const ids = db.ids!

  const rangeCape = p.mucape * 0.3
  const rangeCapeT1 =
    p.mucape < 500 ? p.mucape * 0.5 : p.mucape < 2000 ? p.mucape * 0.25 : p.mucape * 0.2
  const rangeSrhT1 = p.srh3 < 50 ? 25 : p.srh3 * 0.5

  let loose = 0
  let sig = 0
  let sizeSum = 0
  const quality: SarsMatch[] = []
  for (let i = 0; i < db.length; i++) {
    const r = db[i]
    const [, , size, cape, mr, t5, , lr, , s3, s6, s9, srh3] = r
    const inRange = (v: number, c: number, rng: number) => v >= c - rng && v <= c + rng
    if (
      inRange(p.mumr, mr, 2) &&
      inRange(p.mucape, cape, rangeCape) &&
      inRange(p.lr75, lr, 2) &&
      inRange(p.t500, t5, 9) &&
      inRange(p.shr6, s6, 12) &&
      inRange(p.shr9, s9, 22) &&
      inRange(p.shr3, s3, 10)
    ) {
      loose++
      sizeSum += size
      if (size >= 2) sig++
    }
    if (
      quality.length < MAX_QUALITY &&
      inRange(p.mumr, mr, 2) &&
      inRange(p.mucape, cape, rangeCapeT1) &&
      inRange(p.lr75, lr, 0.4) &&
      inRange(p.t500, t5, 1.5) &&
      inRange(p.shr6, s6, 6) &&
      inRange(p.shr9, s9, 15) &&
      inRange(p.shr3, s3, 8) &&
      Number.isFinite(p.srh3) &&
      inRange(p.srh3, srh3, rangeSrhT1)
    ) {
      quality.push({
        label: formatId(ids[i]),
        outcome: `${size.toFixed(2)}"`,
        grade: size >= 2 ? 2 : 1,
      })
    }
  }
  return {
    looseCount: loose,
    prob: loose > 0 && p.mucape > 0 ? sig / loose : 0,
    avgSize: loose > 0 ? sizeSum / loose : undefined,
    quality,
  }
}

export interface SupercellParams {
  mlcape: number
  /** ML LCL height m AGL */
  mllcl: number
  t500: number
  lr75: number
  /** bulk shear in KNOTS (database convention) */
  shr6kt: number
  shr3kt: number
  shr9kt: number
  /** SRH m²/s² */
  srh1: number
  srh3: number
}

/** Supercell DB columns: 0 id, 1 cat(0/1/2), 2 MLMR, 3 MLCAPE, 4 MLCIN,
 *  5 MLLCL, 6 SRH1, 7 SHR6kt, 8 STPC, 9 500T, 10 500DIR, 11 LR75,
 *  12 SHR3kt, 13 SHR9kt, 14 SRH3. */
export function sarsSupercell(p: SupercellParams): SarsResult | null {
  if (![p.mlcape, p.mllcl, p.t500, p.lr75, p.shr6kt, p.srh1].every(Number.isFinite)) return null
  if (!supercellDB) supercellDB = parseTable(supercellRaw)
  const db = supercellDB
  const ids = db.ids!

  const rangeCape = p.mlcape === 0 ? 0 : 1300
  const rangeCapeT1 = p.mlcape * 0.25
  const rangeSrh = Math.abs(p.srh1) < 50 ? 100 : Math.abs(p.srh1)
  const rangeSrhT1 = Math.abs(p.srh1) < 100 ? 50 : Math.abs(p.srh1) * 0.3
  const rangeSrh3T1 = Math.abs(p.srh3) < 100 ? 50 : Math.abs(p.srh3) * 0.5

  let loose = 0
  let tor = 0
  const quality: SarsMatch[] = []
  const inRange = (v: number, c: number, rng: number) => v >= c - rng && v <= c + rng
  for (let i = 0; i < db.length; i++) {
    const r = db[i]
    const cat = r[1]
    const cape = r[3]
    const lcl = r[5]
    const srh1 = r[6]
    const s6 = r[7]
    const t5 = r[9]
    const lr = r[11]
    const s3 = r[12]
    const s9 = r[13]
    const srh3 = r[14]
    if (
      inRange(p.mlcape, cape, rangeCape) &&
      inRange(p.mllcl, lcl, 500) &&
      inRange(p.shr6kt, s6, 14) &&
      inRange(p.srh1, srh1, rangeSrh) &&
      inRange(p.t500, t5, 7) &&
      inRange(p.lr75, lr, 1)
    ) {
      loose++
      if (cat > 0) tor++
    }
    if (
      quality.length < MAX_QUALITY &&
      inRange(p.mlcape, cape, rangeCapeT1) &&
      inRange(p.mllcl, lcl, 200) &&
      inRange(p.shr6kt, s6, 10) &&
      inRange(p.srh1, srh1, rangeSrhT1) &&
      inRange(p.t500, t5, 5) &&
      inRange(p.lr75, lr, 0.8) &&
      inRange(p.shr3kt, s3, 15) &&
      inRange(p.shr9kt, s9, 25) &&
      inRange(p.srh3, srh3, rangeSrh3T1)
    ) {
      quality.push({
        label: formatId(ids[i]),
        outcome: cat === 2 ? 'SIGTOR' : cat === 1 ? 'WEAKTOR' : 'NONTOR',
        grade: cat as 0 | 1 | 2,
      })
    }
  }
  return {
    looseCount: loose,
    prob: loose > 0 && p.mlcape > 0 ? tor / loose : 0,
    quality,
  }
}
