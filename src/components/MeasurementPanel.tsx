import { Eraser, Ruler, Undo2, X } from 'lucide-react'
import type { InteractionMode } from '../lib/MeasurementManager'

type MeasurementPanelProps = {
  mode: InteractionMode
  sectionOpen: boolean
  pointCount: number
  count: number
  result: string
  elevationOffset: number
  onOffsetChange: (offset: number) => void
  onFinishArea: () => void
  onCancel: () => void
  onUndo: () => void
  onClear: () => void
}

const instructions: Partial<Record<InteractionMode, string>> = {
  'measure-distance': 'Bấm 2 điểm trên bề mặt mô hình để đo khoảng cách.',
  'measure-area': 'Bấm lần lượt ít nhất 3 điểm; Enter hoặc đúp chuột để khép đa giác.',
  'measure-angle': 'Bấm điểm đầu, đỉnh góc, rồi điểm cuối.',
  'measure-elevation': 'Bấm bề mặt để đặt mốc cao độ Z.',
}

export default function MeasurementPanel({
  mode,
  sectionOpen,
  pointCount,
  count,
  result,
  elevationOffset,
  onOffsetChange,
  onFinishArea,
  onCancel,
  onUndo,
  onClear,
}: MeasurementPanelProps) {
  if (mode === 'select' && count === 0) return null
  return (
    <section className={`measurement-panel ${sectionOpen ? 'measurement-panel-concurrent' : ''}`} aria-label="Công cụ đo đạc 3D">
      <header><Ruler size={15} /><strong>{mode === 'select' ? 'KẾT QUẢ ĐO' : mode.replace('measure-', '').toUpperCase()}</strong>
        {mode !== 'select' && <button title="Thoát chế độ đo (Esc)" aria-label="Thoát chế độ đo" onClick={onCancel}><X size={14} /></button>}
      </header>
      {mode !== 'select' && <span>{instructions[mode]}</span>}
      {mode === 'measure-elevation' && (
        <label className="elevation-offset">Offset mốc chuẩn (m)
          <input type="number" step="0.001" value={elevationOffset} onChange={(event) => onOffsetChange(Number(event.target.value) || 0)} />
        </label>
      )}
      {mode === 'measure-area' && (
        <button className="measurement-action" disabled={pointCount < 3} onClick={onFinishArea}>Chốt đa giác · Enter</button>
      )}
      {result && <output className="measurement-result">{result}</output>}
      <small>{count} phép đo · {pointCount} điểm đang chọn · Nhấn Esc để hủy phép đo dở</small>
      <div className="measurement-actions">
        <button className="measurement-action" disabled={count === 0} title="Xóa nét đo gần nhất" aria-label="Xóa nét đo gần nhất" onClick={onUndo}><Undo2 size={13} /> Xóa gần nhất</button>
        <button className="measurement-action" disabled={count === 0 && pointCount === 0} title="Xóa tất cả nét đo" aria-label="Xóa tất cả nét đo" onClick={onClear}><Eraser size={13} /> Xóa tất cả</button>
      </div>
    </section>
  )
}
