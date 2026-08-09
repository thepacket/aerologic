/** Precipitable-water climatology per radiosonde site (SPC data via SHARPpy,
 *  sharppy/databases/PW-*-inches.txt). Keyed by WMO station number; monthly
 *  means and standard deviations in inches. US coverage only — callers must
 *  degrade gracefully when a station is absent. */
import meansRaw from '../assets/PW-mean-inches.txt?raw'
import stdevRaw from '../assets/PW-stdev-inches.txt?raw'

interface Climo {
  mean: number[] // 12 months, inches
  stdev: number[]
}

let table: Map<string, Climo> | null = null

function parse(): Map<string, Climo> {
  const map = new Map<string, Climo>()
  const parseFile = (raw: string, field: 'mean' | 'stdev') => {
    for (const line of raw.split('\n')) {
      const cols = line.trim().split(',')
      if (cols.length < 15 || cols[0] === 'SITE') continue
      const wmo = cols[1]
      const vals = cols.slice(3, 15).map(Number)
      if (vals.some((v) => !Number.isFinite(v))) continue
      const cur = map.get(wmo) ?? { mean: [], stdev: [] }
      cur[field] = vals
      map.set(wmo, cur)
    }
  }
  parseFile(meansRaw, 'mean')
  parseFile(stdevRaw, 'stdev')
  return map
}

const MM_PER_INCH = 25.4

export interface PwClimoResult {
  /** climatological monthly mean, mm */
  meanMM: number
  /** standard deviations from the mean */
  sigma: number
}

/** Compare a PW value (mm) against the station's climatology for a month
 *  (0-based). Returns null when the station isn't in the database. */
export function pwClimo(wmoId: string, month: number, pwMM: number): PwClimoResult | null {
  if (!table) table = parse()
  const c = table.get(wmoId)
  if (!c || c.mean.length !== 12 || c.stdev.length !== 12) return null
  const mean = c.mean[month] * MM_PER_INCH
  const sd = c.stdev[month] * MM_PER_INCH
  if (!(sd > 0)) return null
  return { meanMM: mean, sigma: (pwMM - mean) / sd }
}
