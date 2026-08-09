import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../state/store'
import { fetchInventory, type Inventory } from '../data/inventory'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Month grid of the archive inventory for the selected station: which
 *  launches actually exist. Click a cycle chip to load it. */
export function InventoryCalendar() {
  const selected = useStore((s) => s.selected)
  const cycle = useStore((s) => s.cycle)
  const setCycle = useStore((s) => s.setCycle)

  const [view, setView] = useState(() => ({
    year: cycle.getUTCFullYear(),
    month: cycle.getUTCMonth(),
  }))
  const [inv, setInv] = useState<Inventory | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')

  // follow the active cycle when it changes (e.g. via prev/next buttons)
  useEffect(() => {
    setView({ year: cycle.getUTCFullYear(), month: cycle.getUTCMonth() })
  }, [cycle])

  useEffect(() => {
    if (!selected || selected.stationid.startsWith('@')) {
      setInv(null)
      return
    }
    let alive = true
    setState('loading')
    fetchInventory(selected.stationid, selected.src, view.year)
      .then((i) => {
        if (!alive) return
        setInv(i)
        setState('idle')
      })
      .catch(() => {
        if (!alive) return
        setInv(null)
        setState('error')
      })
    return () => {
      alive = false
    }
  }, [selected, view.year])

  const grid = useMemo(() => {
    const first = new Date(Date.UTC(view.year, view.month, 1))
    const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate()
    const lead = first.getUTCDay() // 0 = Sunday
    const cells: ({ day: number; date: string; hours: string[] } | null)[] = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${view.year}-${String(view.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cells.push({ day: d, date, hours: inv?.days.get(date) ?? [] })
    }
    return cells
  }, [view, inv])

  const shiftMonth = (dm: number) => {
    setView((v) => {
      const d = new Date(Date.UTC(v.year, v.month + dm, 1))
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
    })
  }

  const activeKey = `${cycle.toISOString().slice(0, 10)}:${String(cycle.getUTCHours()).padStart(2, '0')}`

  if (!selected || selected.stationid.startsWith('@')) return null

  return (
    <div className="inv">
      <div className="inv-head">
        <button className="tool-btn" onClick={() => shiftMonth(-1)} title="previous month">
          <ChevronLeft size={11} />
        </button>
        <span className="inv-title mono">
          {MONTHS[view.month]} {view.year}
        </span>
        <button
          className="tool-btn"
          onClick={() => shiftMonth(1)}
          title="next month"
          disabled={
            view.year > new Date().getUTCFullYear() ||
            (view.year === new Date().getUTCFullYear() && view.month >= new Date().getUTCMonth())
          }
        >
          <ChevronRight size={11} />
        </button>
      </div>
      {state === 'error' && <div className="idx-note">no inventory for this year</div>}
      <div className="inv-grid" data-loading={state === 'loading'}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="inv-dow">
            {d}
          </span>
        ))}
        {grid.map((cell, i) =>
          cell === null ? (
            <span key={i} />
          ) : (
            <span key={i} className="inv-day" data-empty={cell.hours.length === 0}>
              <span className="inv-daynum">{cell.day}</span>
              <span className="inv-chips">
                {cell.hours.map((h) => (
                  <button
                    key={h}
                    className="inv-chip"
                    data-active={activeKey === `${cell.date}:${h}`}
                    title={`${cell.date} ${h}Z`}
                    onClick={() => {
                      void setCycle(new Date(`${cell.date}T${h}:00:00Z`))
                    }}
                  >
                    {h}
                  </button>
                ))}
              </span>
            </span>
          ),
        )}
      </div>
    </div>
  )
}
