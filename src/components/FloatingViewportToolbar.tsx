import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  BoxSelect,
  Eye,
  EyeOff,
  Focus,
  Layers,
  Move3D,
  Rotate3D,
  RotateCcw,
  Scan,
  Sparkles,
  Ruler,
} from 'lucide-react'
import type { InteractionMode } from '../lib/MeasurementManager'

export type StandardView = 'top' | 'front' | 'back' | 'left' | 'right' | 'bottom' | 'iso'
type Projection = 'perspective' | 'orthographic'

type FloatingViewportToolbarProps = {
  selectedCount: number
  hasModel: boolean
  projection: Projection
  ghostActive: boolean
  sectionOpen: boolean
  interactionMode: InteractionMode
  onIsolate: () => void
  onHide: () => void
  onGhost: () => void
  onShowAll: () => void
  onRestore: () => void
  onView: (view: StandardView) => void
  onToggleProjection: () => void
  onSnapshot: () => void
  onSectionToggle: () => void
  onInteractionModeChange: (mode: InteractionMode) => void
}

const viewOptions: { id: StandardView; label: string; Icon: typeof ArrowUp }[] = [
  { id: 'top', label: 'Mặt bằng', Icon: ArrowUp },
  { id: 'front', label: 'Mặt trước', Icon: ArrowDown },
  { id: 'back', label: 'Mặt sau', Icon: ArrowUp },
  { id: 'left', label: 'Trái', Icon: ArrowLeft },
  { id: 'right', label: 'Phải', Icon: ArrowRight },
  { id: 'bottom', label: 'Đáy', Icon: ArrowDown },
  { id: 'iso', label: 'Phối cảnh 3D', Icon: Move3D },
]

export default function FloatingViewportToolbar({
  selectedCount,
  hasModel,
  projection,
  ghostActive,
  sectionOpen,
  interactionMode,
  onIsolate,
  onHide,
  onGhost,
  onShowAll,
  onRestore,
  onView,
  onToggleProjection,
  onSnapshot,
  onSectionToggle,
  onInteractionModeChange,
}: FloatingViewportToolbarProps) {
  return (
    <div className="floating-viewport-toolbar" role="toolbar" aria-label="Công cụ mô hình 3D">
      <div className="floating-toolbar-group" aria-label="Thao tác cấu kiện">
        <button title="Cô lập các cấu kiện đang chọn" aria-label="Cô lập các cấu kiện đang chọn" disabled={!selectedCount} onClick={onIsolate}>
          <Focus size={15} /><span>Cô lập</span>
        </button>
        <button title="Ẩn các cấu kiện đang chọn" aria-label="Ẩn các cấu kiện đang chọn" disabled={!selectedCount} onClick={onHide}>
          <EyeOff size={15} /><span>Ẩn</span>
        </button>
        <button className={ghostActive ? 'is-active' : ''} title={ghostActive ? 'Tắt chế độ làm mờ xung quanh' : 'Làm mờ phần xung quanh (opacity 12%)'} aria-label="Làm mờ xung quanh" aria-pressed={ghostActive} disabled={!selectedCount} onClick={onGhost}>
          <Sparkles size={15} /><span>Ghost</span>
        </button>
        <button title="Hiện tất cả cấu kiện và bỏ Ghost" aria-label="Hiện tất cả cấu kiện" disabled={!hasModel} onClick={onShowAll}>
          <Eye size={15} /><span>Hiện tất cả</span>
        </button>
        <button title="Khôi phục màu IFC gốc và bỏ mọi hiệu ứng" aria-label="Khôi phục màu gốc" disabled={!hasModel} onClick={onRestore}>
          <RotateCcw size={15} /><span>Khôi phục</span>
        </button>
      </div>
      <div className="floating-toolbar-group viewpoints" aria-label="Góc nhìn chuẩn">
        {viewOptions.map(({ id, label, Icon }) => (
          <button key={id} title={`Góc nhìn ${label}`} aria-label={`Góc nhìn ${label}`} disabled={!hasModel} onClick={() => onView(id)}>
            {id === 'iso' ? <Rotate3D size={15} /> : <Icon size={15} />}
          </button>
        ))}
      </div>
      <div className="floating-toolbar-group">
        <button className={sectionOpen ? 'is-active' : ''} title="Mở bảng Mặt cắt 3 trục" aria-label="Mặt cắt" aria-pressed={sectionOpen} disabled={!hasModel} onClick={onSectionToggle}>
          <BoxSelect size={15} /><span>Mặt cắt</span>
        </button>
        <label className="measurement-mode-select" title="Chọn chế độ đo đạc 3D">
          <Ruler size={14} />
          <select aria-label="Chế độ đo đạc" value={interactionMode} disabled={!hasModel} onChange={(event) => onInteractionModeChange(event.target.value as InteractionMode)}>
            <option value="select">Chọn</option>
            <option value="measure-distance">Khoảng cách</option>
            <option value="measure-area">Diện tích</option>
            <option value="measure-angle">Góc</option>
            <option value="measure-elevation">Cao độ Z</option>
          </select>
        </label>
        <button title={`Chuyển sang ${projection === 'perspective' ? 'chiếu song song' : 'phối cảnh'}`} aria-label={`Chuyển sang ${projection === 'perspective' ? 'chiếu song song' : 'phối cảnh'}`} disabled={!hasModel} onClick={onToggleProjection}>
          {projection === 'perspective' ? <Scan size={15} /> : <Layers size={15} />}
          <span>{projection === 'perspective' ? 'Phối cảnh' : 'Song song'}</span>
        </button>
        <button title="Chụp ảnh HD khung nhìn 3D (PNG)" aria-label="Chụp ảnh HD" disabled={!hasModel} onClick={onSnapshot}>
          <Camera size={15} /><span>Chụp ảnh</span>
        </button>
      </div>
    </div>
  )
}
