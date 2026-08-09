import { Download, PanelLeft, PanelRight, Pencil, Pin, Undo2, Wind, X } from 'lucide-react'
import { useStore } from '../state/store'
import { exportSkewTPng } from '../skewt/exportPng'

export function TitleBar() {
  const sounding = useStore((s) => s.sounding)
  const selected = useStore((s) => s.selected)
  const windUnit = useStore((s) => s.windUnit)
  const setWindUnit = useStore((s) => s.setWindUnit)
  const toggleLeft = useStore((s) => s.toggleLeft)
  const toggleRight = useStore((s) => s.toggleRight)
  const mode = useStore((s) => s.mode)
  const editMode = useStore((s) => s.editMode)
  const toggleEditMode = useStore((s) => s.toggleEditMode)
  const edits = useStore((s) => s.edits)
  const resetEdits = useStore((s) => s.resetEdits)
  const reference = useStore((s) => s.reference)
  const pinReference = useStore((s) => s.pinReference)
  const clearReference = useStore((s) => s.clearReference)
  const stageView = useStore((s) => s.stageView)
  const setStageView = useStore((s) => s.setStageView)

  const title = sounding
    ? `${sounding.station.name}`
    : selected
      ? selected.name
      : 'Skew-T Sounding Viewer'
  const sub = sounding
    ? `${sounding.station.id} · ${sounding.validTime.replace('T', ' ').replace(':00Z', 'Z')}${
        mode === 'fcst' && sounding.source.kind === 'forecast' ? ` · ${sounding.source.model}` : ''
      }`
    : ''

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <span className="brand">
          <Wind size={13} className="brand-icon" />
          <span className="brand-name">AEROLOGIC</span>
        </span>
        <button className="tool-btn" onClick={toggleLeft} title="toggle station panel">
          <PanelLeft size={13} />
        </button>
        <button
          className="tool-btn"
          data-active={editMode}
          onClick={toggleEditMode}
          title="modify sounding: drag the T or Td curve"
        >
          <Pencil size={12} />
        </button>
        {mode === 'fcst' && (
          <div className="segmented">
            <button
              className="seg-btn"
              data-active={stageView === 'skewt'}
              onClick={() => setStageView('skewt')}
            >
              SKEW-T
            </button>
            <button
              className="seg-btn"
              data-active={stageView === 'th'}
              onClick={() => setStageView('th')}
              title="BUFKIT-style time × height section of the model run"
            >
              TIME×HGT
            </button>
          </div>
        )}
        {edits.length > 0 && (
          <button className="chip chip-warn" onClick={resetEdits} title="discard modifications">
            <Undo2 size={10} /> MODIFIED ×{edits.length}
          </button>
        )}
      </div>
      <div className="titlebar-center">
        <span className="doc-title">{title}</span>
        {sub && <span className="doc-sub mono">{sub}</span>}
        {editMode && <span className="chip chip-accent">EDIT</span>}
      </div>
      <div className="titlebar-right">
        {reference ? (
          <button className="chip" onClick={clearReference} title="clear comparison overlay">
            REF {reference.label} <X size={9} />
          </button>
        ) : (
          <button
            className="tool-btn"
            onClick={pinReference}
            title="pin current sounding as comparison overlay"
            disabled={!sounding}
          >
            <Pin size={12} />
          </button>
        )}
        <button
          className="tool-btn"
          title="export PNG"
          disabled={!sounding}
          onClick={() => {
            if (!sounding) return
            exportSkewTPng(
              sounding.station.name || sounding.station.id,
              sounding.validTime.replace('T', ' ').replace(':00Z', 'Z'),
            )
          }}
        >
          <Download size={12} />
        </button>
        <div className="segmented">
          {(['kt', 'ms', 'kmh'] as const).map((u) => (
            <button
              key={u}
              className="seg-btn"
              data-active={windUnit === u}
              onClick={() => setWindUnit(u)}
            >
              {u === 'kt' ? 'KT' : u === 'ms' ? 'M/S' : 'KM/H'}
            </button>
          ))}
        </div>
        <button className="tool-btn" onClick={toggleRight} title="toggle analysis panel">
          <PanelRight size={13} />
        </button>
      </div>
    </header>
  )
}
