/** Wyoming archive inventory: which launches exist for a station in a given
 *  year. The wsgi INVENTORY page is HTML; every available sounding appears as
 *  a link with a full `datetime=YYYY-MM-DD HH:00:00` query parameter. */

export interface Inventory {
  /** "YYYY-MM-DD" → sorted list of hours with data, e.g. ["00", "12"] */
  days: Map<string, string[]>
  year: number
  stationId: string
}

const cache = new Map<string, Inventory>()

export async function fetchInventory(
  stationId: string,
  src: string,
  year: number,
): Promise<Inventory> {
  const key = `${stationId}:${src}:${year}`
  const hit = cache.get(key)
  if (hit) return hit

  const url =
    `/api/wyo/sounding?datetime=${encodeURIComponent(`${year}-06-15 00:00:00`)}` +
    `&id=${encodeURIComponent(stationId)}&type=INVENTORY&src=${encodeURIComponent(src || 'BUFR')}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`inventory: HTTP ${res.status}`)
  const html = await res.text()

  const days = new Map<string, string[]>()
  const re = /datetime=(\d{4})-(\d{2})-(\d{2}) (\d{2}):00:00/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const [, y, mo, d, h] = m
    if (Number(y) !== year) continue // the page links other years too
    const date = `${y}-${mo}-${d}`
    const hours = days.get(date) ?? []
    if (!hours.includes(h)) {
      hours.push(h)
      hours.sort()
      days.set(date, hours)
    }
  }
  const inv: Inventory = { days, year, stationId }
  // cache past years forever, current year only briefly (session-scoped map)
  if (year < new Date().getUTCFullYear() || days.size > 0) cache.set(key, inv)
  return inv
}
