import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

const KEY = 'skewt:section-collapsed:'

export function Section({ title, id, children, right }: {
  title: string
  id: string
  children: ReactNode
  right?: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY + id) === '1')
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(KEY + id, next ? '1' : '0')
  }
  return (
    <div className="section" data-collapsed={collapsed}>
      <button className="section-head" onClick={toggle}>
        {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        <span className="section-title">{title}</span>
        {right && <span className="section-right">{right}</span>}
      </button>
      {!collapsed && <div className="section-body">{children}</div>}
    </div>
  )
}
