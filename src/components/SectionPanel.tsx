import { FlipHorizontal2, RotateCcw, X } from 'lucide-react'
import type { SectionAxis, SectionFace, SectionFlips, SectionRanges } from '../lib/SectionBoxManager'

type SectionPanelProps = {
  ranges: SectionRanges
  limits: SectionRanges
  flips: SectionFlips
  enabled: boolean
  helperVisible: boolean
  compact: boolean
  onEnabledChange: (enabled: boolean) => void
  onRangeChange: (axis: SectionAxis, side: 'min' | 'max', value: number) => void
  onFlip: (face: SectionFace) => void
  onHelperChange: (visible: boolean) => void
  onReset: () => void
  onClose: () => void
}

const axes: { axis: SectionAxis; label: string; minLabel: string; maxLabel: string }[] = [
  { axis: 'x', label: 'X · Trái / Phải', minLabel: 'Trái', maxLabel: 'Phải' },
  { axis: 'y', label: 'Y · Trước / Sau', minLabel: 'Trước', maxLabel: 'Sau' },
  { axis: 'z', label: 'Z · Dưới / Trên', minLabel: 'Dưới', maxLabel: 'Trên' },
]

export default function SectionPanel({
  ranges,
  limits,
  flips,
  enabled,
  helperVisible,
  compact,
  onEnabledChange,
  onRangeChange,
  onFlip,
  onHelperChange,
  onReset,
  onClose,
}: SectionPanelProps) {
  return (
    <section className={`section-panel ${compact ? 'section-panel-compact' : ''}`} aria-label="Điều khiển mặt cắt">
      <header className="section-panel-heading">
        <strong>MẶT CẮT 3 TRỤC</strong>
        <button title="Đóng bảng mặt cắt" aria-label="Đóng bảng mặt cắt" onClick={onClose}><X size={14} /></button>
      </header>
      <label className="section-toggle">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
        Bật clipping planes
      </label>
      {axes.map(({ axis, label, minLabel, maxLabel }) => {
        const range = ranges[axis]
        const limit = limits[axis]
        const span = Math.max(limit.max - limit.min, 0.000001)
        const precision = span > 100 ? 1 : span > 10 ? 2 : 3
        const minFace = `${axis}Min` as SectionFace
        const maxFace = `${axis}Max` as SectionFace
        return (
          <div className="section-axis" key={axis}>
            <div className="section-axis-heading"><span>{label}</span><small>{range.min.toFixed(precision)} – {range.max.toFixed(precision)} m</small></div>
            <div className="section-slider-row">
              <label>
                <span>{minLabel}</span>
                <input type="range" min={limit.min} max={limit.max} step={span / 1000} value={range.min} onChange={(event) => onRangeChange(axis, 'min', Number(event.target.value))} aria-label={`Mặt cắt ${label} ${minLabel}`} />
              </label>
              <button className={flips[minFace] ? 'is-flipped' : ''} title={`Đảo chiều mặt phẳng ${minLabel}`} aria-label={`Đảo chiều mặt phẳng ${minLabel}`} aria-pressed={flips[minFace]} onClick={() => onFlip(minFace)}><FlipHorizontal2 size={13} /></button>
            </div>
            <div className="section-slider-row">
              <label>
                <span>{maxLabel}</span>
                <input type="range" min={limit.min} max={limit.max} step={span / 1000} value={range.max} onChange={(event) => onRangeChange(axis, 'max', Number(event.target.value))} aria-label={`Mặt cắt ${label} ${maxLabel}`} />
              </label>
              <button className={flips[maxFace] ? 'is-flipped' : ''} title={`Đảo chiều mặt phẳng ${maxLabel}`} aria-label={`Đảo chiều mặt phẳng ${maxLabel}`} aria-pressed={flips[maxFace]} onClick={() => onFlip(maxFace)}><FlipHorizontal2 size={13} /></button>
            </div>
          </div>
        )
      })}
      <label className="section-helper-toggle">
        <input type="checkbox" checked={helperVisible} onChange={(event) => onHelperChange(event.target.checked)} />
        Hiện khung viền vùng cắt
      </label>
      <button className="button section-reset" onClick={onReset}><RotateCcw size={13} /> Đặt lại mặt cắt</button>
    </section>
  )
}
