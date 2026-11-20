import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import {
  Box,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FolderTree,
  Layers,
  Maximize,
  LoaderCircle,
  Palette,
  RotateCcw,
  Ruler,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { IfcViewportHandle } from './components/IfcViewport'
import FloatingViewportToolbar from './components/FloatingViewportToolbar'
import type { StandardView } from './components/FloatingViewportToolbar'
import MeasurementPanel from './components/MeasurementPanel'
import DataAnalysisPanel from './components/DataAnalysisPanel'
import type { ColorLegendEntry } from './components/DataAnalysisPanel'
import SectionPanel from './components/SectionPanel'
import type { SectionControlState, ViewProjection } from './components/IfcViewport'
import type { InteractionMode } from './lib/MeasurementManager'
import type { SectionAxis, SectionFace } from './lib/SectionBoxManager'
import type { IfcAnalysisElement, IfcBoqRow, IfcElement, IfcLoadProgress, IfcPropertyGroup, LoadedIfcModel } from './lib/IfcModelLoader'
import './App.css'

const IfcViewport = lazy(() => import('./components/IfcViewport'))

function formatQuantity(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: 3 })
}

function sumQuantity(rows: IfcBoqRow[], key: 'length' | 'area' | 'volume'): number | null {
  const values = rows.map((row) => row[key]).filter((value): value is number => value !== null)
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null
}

async function exportBoqWorkbook(rows: IfcBoqRow[], sourceName: string): Promise<void> {
  const XLSX = await import('xlsx')
  const grouped = new Map<string, IfcBoqRow[]>()
  rows.forEach((row) => {
    const group = grouped.get(row.type) ?? []
    group.push(row)
    grouped.set(row.type, group)
  })

  const detailRows: (string | number | null)[][] = [
    ['STT', 'Tệp IFC', 'Mã hiệu', 'Tên cấu kiện', 'Phân loại IFC', 'Vật liệu', 'Chiều dài', 'Diện tích', 'Thể tích', 'ExpressID'],
    ...rows.map((row, index) => [
      index + 1,
      row.fileName,
      row.code,
      row.name,
      row.type,
      row.material,
      row.length ?? '',
      row.area ?? '',
      row.volume ?? '',
      row.expressID,
    ]),
    ['', '', '', 'TỔNG CỘNG', '', '', sumQuantity(rows, 'length'), sumQuantity(rows, 'area'), sumQuantity(rows, 'volume'), ''],
  ]
  const summaryRows: (string | number | null)[][] = [
    ['Phân loại IFC', 'Số lượng', 'Tổng chiều dài', 'Tổng diện tích', 'Tổng thể tích'],
    ...[...grouped.entries()].sort(([typeA], [typeB]) => typeA.localeCompare(typeB)).map(([type, typeRows]) => [
      type,
      typeRows.length,
      sumQuantity(typeRows, 'length'),
      sumQuantity(typeRows, 'area'),
      sumQuantity(typeRows, 'volume'),
    ]),
    ['TỔNG CỘNG', rows.length, sumQuantity(rows, 'length'), sumQuantity(rows, 'area'), sumQuantity(rows, 'volume')],
  ]
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows)
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
  detailSheet['!cols'] = [
    { wch: 7 }, { wch: 28 }, { wch: 24 }, { wch: 42 }, { wch: 25 }, { wch: 28 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 },
  ]
  summarySheet['!cols'] = [
    { wch: 28 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
  ]

  for (let row = 1; row < detailRows.length; row += 1) {
    for (const column of [6, 7, 8]) {
      const cell = detailSheet[XLSX.utils.encode_cell({ r: row, c: column })]
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.###'
    }
  }
  for (let row = 1; row < summaryRows.length; row += 1) {
    for (const column of [2, 3, 4]) {
      const cell = summarySheet[XLSX.utils.encode_cell({ r: row, c: column })]
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.###'
    }
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Tong hop')
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Chi tiet')
  const baseName = sourceName.replace(/\.ifc$/i, '').replace(/[<>:"/\\|?*]/g, '_').trim() || 'DuAn'
  XLSX.writeFile(workbook, `${baseName}_ThongKeKhoiLuong.xlsx`)
}

function App() {
  const [models, setModels] = useState<(LoadedIfcModel & {
    threeGroup: LoadedIfcModel['group']
    visible: boolean
    opacity: number
    colorTint: string
  })[]>([])
  const [selected, setSelected] = useState<IfcElement | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [ghostActive, setGhostActive] = useState(false)
  const [projection, setProjection] = useState<ViewProjection>('perspective')
  const [elements, setElements] = useState<IfcElement[]>([])
  const [search, setSearch] = useState('')
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [propertyGroups, setPropertyGroups] = useState<IfcPropertyGroup[]>([])
  const [propertiesLoading, setPropertiesLoading] = useState(false)
  const [propertiesError, setPropertiesError] = useState('')
  const [fileName, setFileName] = useState('')
  const [xray, setXray] = useState(false)
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('select')
  const measureMode = interactionMode !== 'select'
  const [elevationOffset, setElevationOffset] = useState(0)
  const [measurement, setMeasurement] = useState({ mode: 'select' as InteractionMode, count: 0, pointCount: 0, result: '' })
  const [sectionPanelOpen, setSectionPanelOpen] = useState(false)
  const [sectionState, setSectionState] = useState<SectionControlState>({
    ranges: {
      x: { min: 0, max: 0 },
      y: { min: 0, max: 0 },
      z: { min: 0, max: 0 },
    },
    limits: {
      x: { min: 0, max: 0 },
      y: { min: 0, max: 0 },
      z: { min: 0, max: 0 },
    },
    flips: {
      xMin: false, xMax: false, yMin: false, yMax: false, zMin: false, zMax: false,
    },
    enabled: false,
    helperVisible: false,
  })
  const [gridVisible, setGridVisible] = useState(true)
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [isolatedType, setIsolatedType] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [orientationOpen, setOrientationOpen] = useState(false)
  const [boqOpen, setBoqOpen] = useState(false)
  const [boqRows, setBoqRows] = useState<IfcBoqRow[]>([])
  const [boqFilter, setBoqFilter] = useState('all')
  const [boqLoading, setBoqLoading] = useState(false)
  const [boqProgress, setBoqProgress] = useState(0)
  const [boqError, setBoqError] = useState('')
  const [boqExportError, setBoqExportError] = useState('')
  const [boqExporting, setBoqExporting] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [analysisRecords, setAnalysisRecords] = useState<IfcAnalysisElement[]>([])
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [analysisCenters, setAnalysisCenters] = useState<Map<string, { x: number; y: number; z: number }>>(new Map())
  const [colorLegend, setColorLegend] = useState<ColorLegendEntry[]>([])
  const [notice, setNotice] = useState('')
  const [progress, setProgress] = useState<IfcLoadProgress | null>(null)
  const [loadError, setLoadError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<IfcViewportHandle>(null)
  const viewerRef = useRef<HTMLElement>(null)
  const propertyRequest = useRef(0)
  const boqRequest = useRef(0)
  const analysisRequest = useRef(0)

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === viewerRef.current)
    document.addEventListener('fullscreenchange', updateFullscreen)
    return () => document.removeEventListener('fullscreenchange', updateFullscreen)
  }, [])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
      }
      if (event.key === 'Escape') {
        setDisplayOptionsOpen(false)
        setHelpOpen(false)
        setOrientationOpen(false)
        if (measureMode) {
          setInteractionMode('select')
          viewportRef.current?.cancelMeasurement()
        }
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [measureMode])

  const elementGroups = useMemo(() => models.flatMap((model) => {
    const groups = new Map<string, IfcElement[]>()
    model.elements.forEach((element) => {
      const group = groups.get(element.type) ?? []
      group.push(element)
      groups.set(element.type, group)
    })
    return [...groups.entries()].map(([type, typeElements]) => ({
      key: `${model.modelKey}:${type}`,
      modelKey: model.modelKey,
      fileName: model.fileName,
      type,
      elements: typeElements,
    }))
  }).sort((left, right) => left.fileName.localeCompare(right.fileName) || left.type.localeCompare(right.type)), [models])

  const visibleElementGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    return elementGroups.flatMap((group) => {
      const { type, elements: groupElements } = group
      const matchingElements = groupElements.filter((element) =>
        `${group.fileName} ${element.name} ${element.type} ${element.tag} ${element.expressID}`.toLowerCase().includes(query),
      )
      if (!query || type.toLowerCase().includes(query)) {
        return [{ ...group, elements: groupElements }]
      }
      return matchingElements.length > 0 ? [{ ...group, elements: matchingElements }] : []
    })
  }, [elementGroups, search])

  const chooseFiles = (selectedFiles: FileList | File[]) => {
    const files = Array.from(selectedFiles)
    if (files.length === 0) return
    const validFiles = files.filter((file) => file.name.toLowerCase().endsWith('.ifc'))
    if (validFiles.length !== files.length) {
      setLoadError('Một số tệp không phải .ifc dạng STEP và đã bị bỏ qua. Tệp IFCZIP/XML chưa được hỗ trợ.')
    }
    if (validFiles.length === 0) return
    boqRequest.current += 1
    propertyRequest.current += 1
    analysisRequest.current += 1
    setSelected(null)
    setSelectedIds([])
    setGhostActive(false)
    viewportRef.current?.clearSelection()
    setPropertyGroups([])
    setPropertiesError('')
    setPropertiesLoading(false)
    setBoqRows([])
    setBoqLoading(false)
    setBoqError('')
    setBoqExportError('')
    setAnalysisRecords([])
    setColorLegend([])
    setAnalysisError('')
    setAnalysisOpen(false)
    setAnalysisCenters(new Map())
    viewportRef.current?.setDataColorization(new Map())
    viewportRef.current?.setQaVisualization(new Set(), false)
    viewportRef.current?.clearElementIsolation()
    if (validFiles.length === files.length) setLoadError('')
    setInteractionMode('select')
    viewportRef.current?.setInteractionMode('select')
    viewportRef.current?.clearMeasurements()
    setMeasurement({ mode: 'select', count: 0, pointCount: 0, result: '' })
    setIsolatedType(null)
    setProgress({ message: 'Đang chờ nạp mô hình...', progress: 0, fileName: validFiles[0].name })
    viewportRef.current?.addModels(validFiles)
  }

  const selectElement = (instanceId: string | null) => {
    const request = ++propertyRequest.current
    const element = elements.find((item) => item.instanceId === instanceId) ?? null
    setSelected(element)
    setPropertyGroups([])
    setPropertiesError('')
    setPropertiesLoading(Boolean(element))

    if (!element) return
    void viewportRef.current?.getElementProperties(element.instanceId).then((groups) => {
      if (request === propertyRequest.current) setPropertyGroups(groups)
    }).catch((error: unknown) => {
      if (request === propertyRequest.current) {
        setPropertiesError(error instanceof Error ? error.message : 'Không thể đọc thuộc tính IFC.')
      }
    }).finally(() => {
      if (request === propertyRequest.current) setPropertiesLoading(false)
    })
  }

  const toggleTypeVisibility = (type: string) => {
    if (isolatedType) {
      viewportRef.current?.toggleTypeIsolation(isolatedType)
      setIsolatedType(null)
    }
    const visible = hiddenTypes.has(type)
    const nextHidden = new Set(hiddenTypes)
    if (visible) nextHidden.delete(type)
    else nextHidden.add(type)
    setHiddenTypes(nextHidden)
    viewportRef.current?.setTypeVisibility(type, visible)
    if (!visible && selected?.type === type) viewportRef.current?.clearSelection()
  }

  const toggleTypeExpanded = (type: string) => {
    const nextExpanded = new Set(expandedTypes)
    if (nextExpanded.has(type)) nextExpanded.delete(type)
    else nextExpanded.add(type)
    setExpandedTypes(nextExpanded)
  }

  const chooseTreeElement = (element: IfcElement, event?: MouseEvent<HTMLButtonElement>) => {
    if (measureMode) {
      setInteractionMode('select')
      viewportRef.current?.setInteractionMode('select')
    }
    selectElement(element.instanceId)
    viewportRef.current?.focusElement(element.instanceId, Boolean(event?.ctrlKey || event?.shiftKey))
  }

  const handleModelLoaded = (loaded: LoadedIfcModel) => {
    boqRequest.current += 1
    propertyRequest.current += 1
    analysisRequest.current += 1
    setModels((current) => [...current, {
      ...loaded, threeGroup: loaded.group, visible: true, opacity: 1, colorTint: '#ffffff',
    }])
    setElements((current) => [...current, ...loaded.elements])
    setExpandedTypes((current) => new Set([
      ...current,
      ...loaded.elements.map((element) => `${loaded.modelKey}:${element.type}`),
    ]))
    setFileName(loaded.fileName)
    setBoqRows([])
    setBoqLoading(false)
    setLoadError('')
  }

  const removeManagedModel = (modelKey: number) => {
    const model = models.find((item) => item.modelKey === modelKey)
    if (!model) return
    viewportRef.current?.removeModel(modelKey)
    boqRequest.current += 1
    propertyRequest.current += 1
    analysisRequest.current += 1
    setModels((current) => current.filter((item) => item.modelKey !== modelKey))
    setElements((current) => current.filter((element) => element.modelKey !== modelKey))
    if (selected?.modelKey === modelKey) selectElement(null)
    const remainingModels = models.filter((item) => item.modelKey !== modelKey)
    setFileName(remainingModels[remainingModels.length - 1]?.fileName ?? '')
    setBoqRows([])
    setAnalysisRecords([])
    setColorLegend([])
    setAnalysisCenters(new Map())
    setAnalysisOpen(false)
    viewportRef.current?.setDataColorization(new Map())
    viewportRef.current?.setQaVisualization(new Set(), false)
    viewportRef.current?.clearElementIsolation()
  }

  const updateModelVisibility = (modelKey: number, visible: boolean) => {
    viewportRef.current?.setModelVisibility(modelKey, visible)
    setModels((current) => current.map((model) => model.modelKey === modelKey ? { ...model, visible } : model))
  }

  const updateModelOpacity = (modelKey: number, opacity: number) => {
    viewportRef.current?.setModelOpacity(modelKey, opacity)
    setModels((current) => current.map((model) => model.modelKey === modelKey ? { ...model, opacity } : model))
  }

  const updateModelColor = (modelKey: number, colorTint: string) => {
    viewportRef.current?.setModelColorTint(modelKey, colorTint)
    setModels((current) => current.map((model) => model.modelKey === modelKey ? { ...model, colorTint } : model))
  }

  const toggleMeasurementMode = () => {
    const mode: InteractionMode = measureMode ? 'select' : 'measure-distance'
    setInteractionMode(mode)
    viewportRef.current?.setInteractionMode(mode)
  }

  const exitMeasurementMode = () => {
    setInteractionMode('select')
    viewportRef.current?.setInteractionMode('select')
  }

  const changeInteractionMode = (mode: InteractionMode) => {
    setInteractionMode(mode)
    viewportRef.current?.setInteractionMode(mode)
  }

  const toggleIsolation = () => {
    if (!selected) return
    const enabled = viewportRef.current?.toggleTypeIsolation(selected.type) ?? false
    setIsolatedType(enabled ? selected.type : null)
  }

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }

  const takeSnapshot = () => {
    void viewportRef.current?.takeSnapshot().then(() => showNotice('Đã lưu ảnh PNG khung nhìn 3D.')).catch((error: unknown) => {
      showNotice(error instanceof Error ? `Không thể chụp ảnh: ${error.message}` : 'Không thể chụp ảnh khung nhìn 3D.')
    })
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await viewerRef.current?.requestFullscreen()
    } catch (error) {
      setNotice(error instanceof Error ? `Không thể bật toàn màn hình: ${error.message}` : 'Không thể bật toàn màn hình.')
      window.setTimeout(() => setNotice(''), 3500)
    }
  }

  const toggleAllTypesExpanded = () => {
    const allExpanded = elementGroups.length > 0 && elementGroups.every((group) => expandedTypes.has(group.key))
    setExpandedTypes(allExpanded ? new Set() : new Set(elementGroups.map((group) => group.key)))
  }

  const openBoq = () => {
    setBoqOpen(true)
    setBoqError('')
    setBoqExportError('')
    setBoqFilter('all')
    if (elements.length === 0) {
      setBoqRows([])
      setBoqLoading(false)
      return
    }

    const request = ++boqRequest.current
    setBoqRows([])
    setBoqLoading(true)
    setBoqProgress(0)
    void viewportRef.current?.getBoqRows((value) => {
      if (request === boqRequest.current) setBoqProgress(value)
    }).then((rows) => {
      if (request === boqRequest.current) setBoqRows(rows)
    }).catch((error: unknown) => {
      if (request === boqRequest.current) {
        setBoqError(error instanceof Error ? error.message : 'Không thể bóc tách dữ liệu khối lượng IFC.')
      }
    }).finally(() => {
      if (request === boqRequest.current) setBoqLoading(false)
    })
  }

  const filteredBoqRows = useMemo(
    () => boqFilter === 'all' ? boqRows : boqRows.filter((row) => row.type === boqFilter),
    [boqFilter, boqRows],
  )
  const boqTypes = useMemo(
    () => [...new Set(boqRows.map((row) => row.type))].sort((typeA, typeB) => typeA.localeCompare(typeB)),
    [boqRows],
  )

  const exportBoq = async () => {
    setBoqExporting(true)
    setBoqExportError('')
    try {
      await exportBoqWorkbook(boqRows, models.length > 1 ? 'Federated_Models' : fileName)
    } catch (error) {
      setBoqExportError(error instanceof Error ? error.message : 'Không thể tạo tệp Excel.')
    } finally {
      setBoqExporting(false)
    }
  }

  const openAnalysis = async () => {
    setAnalysisOpen(true)
    if (analysisRecords.length > 0 || analysisLoading || models.length === 0) return
    const request = ++analysisRequest.current
    setAnalysisLoading(true)
    setAnalysisProgress(0)
    setAnalysisError('')
    try {
      const centers = viewportRef.current?.getElementCenters() ?? new Map()
      const records = await viewportRef.current?.getAnalysisElements(setAnalysisProgress)
      if (!records) throw new Error('Khung xem mô hình chưa sẵn sàng để phân tích.')
      if (request === analysisRequest.current) {
        setAnalysisCenters(centers)
        setAnalysisRecords(records)
      }
    } catch (error) {
      if (request === analysisRequest.current) {
        setAnalysisError(error instanceof Error ? error.message : 'Không thể đọc dữ liệu phân tích IFC.')
      }
    } finally {
      if (request === analysisRequest.current) setAnalysisLoading(false)
    }
  }

  return (
    <main className="app-shell h-screen overflow-hidden">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Layers size={19} strokeWidth={2.2} /></div>
          <div className="brand-copy">
            <span className="brand-name">BIM <span>DATA</span></span>
            <span className="brand-subtitle">MODEL WORKSPACE</span>
          </div>
          <div className="brand-divider" />
          <span className="product-name">BIM Data Viewer</span>
        </div>

        <div className="toolbar-actions">
          <button className="button button-primary" onClick={() => fileInput.current?.click()}>
            <Upload size={15} /> Thêm mô hình (.IFC)
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".ifc"
            multiple
            onChange={(event) => {
              chooseFiles(event.target.files ?? [])
              event.currentTarget.value = ''
            }}
          />
          <button className="button button-boq" onClick={openBoq}>
            <FileSpreadsheet size={16} /> Thống kê khối lượng <span className="boq-tag">BOQ</span>
          </button>
          <button className={`button button-analysis ${colorLegend.length > 0 ? 'is-active' : ''}`} onClick={() => void openAnalysis()} disabled={elements.length === 0}>
            <Palette size={15} /> Tô màu dữ liệu
            {colorLegend.length > 0 && <span className="boq-tag">{colorLegend.length} nhóm</span>}
          </button>
          <span className="toolbar-divider" />
          <button className="icon-button" title="Reset góc nhìn" aria-label="Reset góc nhìn" onClick={() => { viewportRef.current?.resetView(); setNotice('Đã đặt lại góc nhìn'); window.setTimeout(() => setNotice(''), 2500) }}>
            <RotateCcw size={16} />
          </button>
          <button className={`button button-xray ${xray ? 'is-active' : ''}`} onClick={() => setXray(!xray)} aria-pressed={xray}>
            <Crosshair size={16} /> X-Ray
          </button>
          <button className="icon-button settings-button" title="Tùy chọn hiển thị" aria-label="Tùy chọn hiển thị" aria-expanded={displayOptionsOpen} onClick={() => setDisplayOptionsOpen(!displayOptionsOpen)}><Settings2 size={17} /></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="side-panel left-panel">
          <div className="panel-heading">
            <div className="panel-title"><FolderTree size={16} /><span>CẤU TRÚC MÔ HÌNH</span></div>
            <button className="subtle-icon" aria-label={elementGroups.length > 0 && elementGroups.every((group) => expandedTypes.has(group.key)) ? 'Thu gọn tất cả nhóm' : 'Mở rộng tất cả nhóm'} title="Mở rộng/thu gọn tất cả nhóm" onClick={toggleAllTypesExpanded}><Maximize size={14} /></button>
          </div>
          <section className="model-manager" aria-label="Quản lý mô hình">
            <div className="model-manager-heading"><span>MODELS</span><b>{models.length}</b></div>
            <div className="model-manager-list">
              {models.map((model) => (
                <article className={`model-manager-item ${model.visible ? '' : 'model-disabled'}`} key={model.modelKey}>
                  <div className="model-manager-title" title={model.fileName}>
                    <span className="tree-label">{model.fileName}</span>
                    <small>{model.elements.length.toLocaleString('vi-VN')}</small>
                  </div>
                  <div className="model-manager-controls">
                    <button className="model-action" title={model.visible ? 'Ẩn mô hình' : 'Hiện mô hình'} aria-label={`${model.visible ? 'Ẩn' : 'Hiện'} mô hình ${model.fileName}`} onClick={() => updateModelVisibility(model.modelKey, !model.visible)}>
                      {model.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <label className="model-opacity" title={`Độ mờ ${Math.round(model.opacity * 100)}%`}>
                      <span>Opacity</span>
                      <input type="range" min="0" max="100" value={Math.round(model.opacity * 100)} aria-label={`Độ mờ ${model.fileName}`} onChange={(event) => updateModelOpacity(model.modelKey, Number(event.target.value) / 100)} />
                    </label>
                    <input className="model-tint" type="color" value={model.colorTint} aria-label={`Màu phủ ${model.fileName}`} title="Màu phủ mô hình" onChange={(event) => updateModelColor(model.modelKey, event.target.value)} />
                    <button className="model-action" title="Tập trung mô hình" aria-label={`Tập trung ${model.fileName}`} onClick={() => {
                      if (!model.visible) updateModelVisibility(model.modelKey, true)
                      viewportRef.current?.focusModel(model.modelKey)
                    }}><Crosshair size={14} /></button>
                    <button className="model-action model-remove" title="Gỡ mô hình" aria-label={`Gỡ ${model.fileName}`} onClick={() => removeManagedModel(model.modelKey)}><Trash2 size={14} /></button>
                  </div>
                </article>
              ))}
              {models.length === 0 && <div className="model-manager-empty">Chưa có mô hình nào được nạp</div>}
            </div>
          </section>
          <div className="tree-search">
            <Search size={15} />
            <input ref={searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm cấu kiện..." aria-label="Tìm cấu kiện" />
            <kbd>⌘ K</kbd>
          </div>
          <div className="tree-content">
            <div className="tree-caption">SPATIAL STRUCTURE</div>
            <div className="tree-row project-row">
              <Building2 size={15} className="tree-building" />
              <span className="tree-label">Dự án BIM</span>
              <span className="tree-count">{elements.length.toString().padStart(2, '0')}</span>
            </div>
            <div className="tree-branch">
              <div className="tree-row site-row">
                <Layers size={14} className="tree-muted-icon" />
                <span className="tree-label">Cấu kiện IFC</span>
                <span className="tree-count">{elements.length.toString().padStart(2, '0')}</span>
              </div>
              <div className="element-list">
                {models.map((model) => {
                  const modelGroups = visibleElementGroups.filter((group) => group.modelKey === model.modelKey)
                  if (search.trim() && modelGroups.length === 0) return null
                  return (
                    <div className="model-tree-group" key={model.modelKey}>
                      <div className="tree-row model-tree-header" title={model.fileName}>
                        <ChevronDown size={13} />
                        <span className="tree-label">{model.fileName}</span>
                        <span className="tree-count">{model.elements.length}</span>
                      </div>
                      <div className="tree-branch">
                        {modelGroups.map(({ key, type, elements: groupElements }) => {
                          const expanded = expandedTypes.has(key) || Boolean(search.trim())
                          const hidden = hiddenTypes.has(type)
                          return (
                            <div className="element-type-group" key={key}>
                              <div className={`tree-row type-group-row ${hidden ? 'type-hidden' : ''}`}>
                                <button className="group-expand" onClick={() => toggleTypeExpanded(key)} aria-label={`${expanded ? 'Thu gọn' : 'Mở rộng'} ${type}`} aria-expanded={expanded}>
                                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                </button>
                                <Box size={13} className="group-type-icon" />
                                <button className="group-name" onClick={() => toggleTypeExpanded(key)}>{type.replace(/^IFC/i, 'Ifc')}</button>
                                <span className="tree-count">{groupElements.length}</span>
                                <button className="group-visibility" onClick={() => toggleTypeVisibility(type)} title={hidden ? 'Hiện nhóm cấu kiện' : 'Ẩn nhóm cấu kiện'} aria-label={`${hidden ? 'Hiện' : 'Ẩn'} ${type}`}>
                                  {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </div>
                              {expanded && groupElements.map((element) => (
                                <button
                                  key={element.instanceId}
                                  className={`tree-row element-row ${selectedIds.includes(element.instanceId) ? 'selected' : ''}`}
                                  onClick={(event) => chooseTreeElement(element, event)}
                                >
                                  <span className="tree-indent" />
                                  <Box size={13} />
                                  <span className="tree-label">{element.name}</span>
                                  <span className="element-type">{element.tag || `#${element.expressID}`}</span>
                                </button>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {elements.length === 0 && <div className="empty-search">{progress ? 'Đang đọc cấu kiện...' : 'Chưa có cấu kiện IFC'}</div>}
                {elements.length > 0 && visibleElementGroups.length === 0 && <div className="empty-search">Không tìm thấy cấu kiện</div>}
              </div>
            </div>
          </div>
          <div className="panel-footer">
            <span className={`connection-dot ${fileName ? 'status-dot-green' : ''}`} />
            <span>{fileName ? 'MÔ HÌNH ĐÃ CHỌN' : 'CHƯA KẾT NỐI MÔ HÌNH'}</span>
          </div>
        </aside>

        <section ref={viewerRef} className={`viewer ${xray ? 'viewer-xray' : ''}`} aria-label="Khung xem mô hình 3D">
          <div className="viewer-toolbar">
            <div className="view-tabs">
              <button className={`view-tab ${measureMode ? '' : 'active'}`} onClick={exitMeasurementMode} aria-pressed={!measureMode}><Box size={14} /> Mô hình 3D</button>
              <button className={`view-tab ${measureMode ? 'active' : ''}`} onClick={toggleMeasurementMode} disabled={elements.length === 0} aria-pressed={measureMode} title={elements.length === 0 ? 'Hãy mở mô hình IFC trước' : 'Bật/tắt chế độ đo hai điểm'}><Ruler size={14} /> Đo lường</button>
            </div>
            <div className="viewer-tools">
              <button className={`viewer-tool orientation-toggle ${orientationOpen ? 'is-active' : ''}`} title="Điều chỉnh hướng mô hình" aria-label="Điều chỉnh hướng mô hình" aria-expanded={orientationOpen} onClick={() => setOrientationOpen(!orientationOpen)}>
                <RotateCw size={15} />
              </button>
              <span className="view-status"><span className="status-dot" /> {projection.toUpperCase()}</span>
              <button className={`viewer-tool ${displayOptionsOpen ? 'is-active' : ''}`} title="Tùy chọn hiển thị" aria-label="Tùy chọn hiển thị" aria-expanded={displayOptionsOpen} onClick={() => setDisplayOptionsOpen(!displayOptionsOpen)}><Settings2 size={15} /></button>
              <button className="viewer-tool" title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} onClick={() => void toggleFullscreen()}><Maximize size={15} /></button>
            </div>
            {displayOptionsOpen && (
              <div className="display-popover" role="group" aria-label="Tùy chọn hiển thị">
                <strong>HIỂN THỊ</strong>
                <label><input type="checkbox" checked={gridVisible} onChange={(event) => {
                  setGridVisible(event.target.checked)
                  viewportRef.current?.setGridVisible(event.target.checked)
                }} /> Lưới tọa độ</label>
                <label><input type="checkbox" checked={xray} onChange={(event) => setXray(event.target.checked)} /> Chế độ X-Ray</label>
              </div>
            )}
            {orientationOpen && (
              <div className="orientation-popover" role="group" aria-label="Điều chỉnh hướng mô hình">
                <strong>XOAY MÔ HÌNH · 90°</strong>
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <div className="orientation-row" key={axis}>
                    <span>Trục {axis.toUpperCase()}</span>
                    <button className="button orientation-button" title={`Xoay +90° quanh trục ${axis.toUpperCase()}`} aria-label={`Xoay +90 độ quanh trục ${axis.toUpperCase()}`} onClick={() => viewportRef.current?.rotateModel(axis, 1)}>
                      <RotateCw size={13} /> +90°
                    </button>
                    <button className="button orientation-button" title={`Xoay -90° quanh trục ${axis.toUpperCase()}`} aria-label={`Xoay -90 độ quanh trục ${axis.toUpperCase()}`} onClick={() => viewportRef.current?.rotateModel(axis, -1)}>
                      <RotateCcw size={13} /> -90°
                    </button>
                  </div>
                ))}
                <button className="button orientation-reset" onClick={() => viewportRef.current?.resetModelOrientation()}>
                  <Crosshair size={14} /> Đặt lại hướng
                </button>
              </div>
            )}
          </div>
          <div className="viewport">
            <div className={`viewport-grid ${gridVisible ? '' : 'is-hidden'}`} />
            <Suspense fallback={<div className="three-viewport" />}>
              <IfcViewport
                ref={viewportRef}
                xray={xray}
                showGrid={gridVisible}
                onModelLoaded={handleModelLoaded}
                onProgress={setProgress}
                onLoadError={(message) => setLoadError(message ?? '')}
                onSelectedElement={selectElement}
                onSelectionChange={setSelectedIds}
                onVisibilityChange={(types) => setHiddenTypes(new Set(types))}
                onProjectionChange={setProjection}
                onXrayChange={setXray}
                onSectionChange={setSectionState}
                onMeasurementUpdate={setMeasurement}
              />
            </Suspense>
            <MeasurementPanel
              mode={interactionMode}
              sectionOpen={sectionPanelOpen}
              pointCount={measurement.pointCount}
              count={measurement.count}
              result={measurement.result}
              elevationOffset={elevationOffset}
              onOffsetChange={(offset) => {
                setElevationOffset(offset)
                viewportRef.current?.setElevationOffset(offset)
              }}
              onFinishArea={() => viewportRef.current?.finishAreaMeasurement()}
              onCancel={() => {
                setInteractionMode('select')
                viewportRef.current?.cancelMeasurement()
              }}
              onUndo={() => viewportRef.current?.removeLastMeasurement()}
              onClear={() => viewportRef.current?.clearMeasurements()}
            />
            {sectionPanelOpen && (
              <SectionPanel
                ranges={sectionState.ranges}
                limits={sectionState.limits}
                flips={sectionState.flips}
                enabled={sectionState.enabled}
                helperVisible={sectionState.helperVisible}
                compact={measureMode || measurement.count > 0}
                onEnabledChange={(enabled) => viewportRef.current?.setSectionEnabled(enabled)}
                onRangeChange={(axis: SectionAxis, side, value) => viewportRef.current?.setSectionRange(axis, side, value)}
                onFlip={(face: SectionFace) => viewportRef.current?.flipSection(face)}
                onHelperChange={(visible) => viewportRef.current?.setSectionHelperVisible(visible)}
                onReset={() => viewportRef.current?.resetSection()}
                onClose={() => setSectionPanelOpen(false)}
              />
            )}
            {elements.length === 0 && !progress && !loadError && <div className="empty-state">
              <div className="empty-graphic">
                <div className="cube-outline"><Box size={37} strokeWidth={1.15} /></div>
                <span className="orbit orbit-one" /><span className="orbit orbit-two" />
                <span className="graphic-spark spark-one" /><span className="graphic-spark spark-two" />
              </div>
              <h1>Chưa tải mô hình IFC</h1>
              <p>Mở tệp IFC để bắt đầu khám phá mô hình BIM của bạn</p>
              <button className="button button-primary empty-open" onClick={() => fileInput.current?.click()}><Upload size={15} /> Mở tệp IFC</button>
              <div className="viewer-shortcuts"><span><kbd>Chuột trái</kbd> Xoay</span><span><kbd>Cuộn</kbd> Thu phóng</span><span><kbd>Shift + kéo</kbd> Di chuyển</span></div>
            </div>}
            {progress && <div className="loading-overlay" role="status" aria-live="polite">
              <LoaderCircle size={25} className="loading-spinner" />
              <strong>{progress.message}</strong>
              <span>{progress.fileName}</span>
              <div className="progress-track"><div className="progress-value" style={{ width: `${progress.progress}%` }} /></div>
              <small>{progress.progress}%</small>
            </div>}
            {loadError && <div className="load-error" role="alert">
              <strong>Không thể tải mô hình</strong>
              <span>{loadError}</span>
              <button className="button" onClick={() => fileInput.current?.click()}>Chọn tệp khác</button>
            </div>}
            <div className="viewport-coordinates"><Crosshair size={13} /><span>0.000, 0.000, 0.000 m</span></div>
            {!analysisOpen && colorLegend.length > 0 && <div className="viewport-color-legend" aria-label="Chú giải màu dữ liệu">
              <strong>CHÚ GIẢI MÀU</strong>
              {colorLegend.map((entry) => (
                <button key={entry.label} title={`Cô lập ${entry.label}`} onClick={() => viewportRef.current?.isolateElements(entry.instanceIds)}>
                  <i style={{ background: entry.color }} /><span>{entry.label}</span><small>{entry.count.toLocaleString('vi-VN')}</small>
                </button>
              ))}
              <button className="legend-restore" onClick={() => {
                viewportRef.current?.clearElementIsolation()
                viewportRef.current?.setDataColorization(new Map())
                setColorLegend([])
              }}>Khôi phục màu gốc</button>
            </div>}
            <div className="viewport-controls">
              <button className={!measureMode ? 'is-active' : ''} title="Chọn cấu kiện" aria-label="Chọn cấu kiện" aria-pressed={!measureMode} onClick={exitMeasurementMode}><Crosshair size={15} /></button>
              <button className={isolatedType ? 'is-active' : ''} title={isolatedType ? 'Hiện lại tất cả cấu kiện' : 'Chỉ hiện loại cấu kiện đang chọn'} aria-label={isolatedType ? 'Hiện lại tất cả cấu kiện' : 'Chỉ hiện loại cấu kiện đang chọn'} aria-pressed={Boolean(isolatedType)} disabled={!selected} onClick={toggleIsolation}><Layers size={15} /></button>
            </div>
            <FloatingViewportToolbar
              selectedCount={selectedIds.length}
              hasModel={elements.length > 0}
              projection={projection}
              ghostActive={ghostActive}
              sectionOpen={sectionPanelOpen}
              interactionMode={interactionMode}
              onIsolate={() => {
                viewportRef.current?.isolateSelection()
                setIsolatedType(null)
                setGhostActive(false)
              }}
              onHide={() => {
                viewportRef.current?.hideSelection()
                setGhostActive(false)
              }}
              onGhost={() => setGhostActive(viewportRef.current?.ghostSelection() ?? false)}
              onShowAll={() => {
                viewportRef.current?.showAll()
                setModels((current) => current.map((model) => ({ ...model, visible: true })))
                setHiddenTypes(new Set())
                setIsolatedType(null)
                setGhostActive(false)
              }}
              onRestore={() => {
                viewportRef.current?.restoreDisplay()
                setModels((current) => current.map((model) => ({ ...model, visible: true })))
                setXray(false)
                setGhostActive(false)
                setIsolatedType(null)
              }}
              onView={(view: StandardView) => viewportRef.current?.setStandardView(view)}
              onToggleProjection={() => viewportRef.current?.toggleProjection()}
              onSnapshot={takeSnapshot}
              onSectionToggle={() => setSectionPanelOpen(!sectionPanelOpen)}
              onInteractionModeChange={changeInteractionMode}
            />
            {xray && <div className="xray-indicator"><span className="status-dot" /> X-RAY MODE</div>}
          </div>
          <div className="viewer-statusbar">
            <span><span className={`status-dot ${progress ? 'loading-dot' : 'status-dot-green'}`} /> {progress ? 'ĐANG XỬ LÝ MÔ HÌNH' : elements.length > 0 ? 'MODEL LOADED' : loadError ? 'LOAD ERROR' : 'VIEWPORT READY'}</span>
            <span className="statusbar-center">{selected ? `Đang chọn: ${selected.name}` : 'Không có cấu kiện được chọn'}</span>
            <span>ĐƠN VỊ <b>METRIC (m)</b></span>
          </div>
        </section>

        <aside className="side-panel right-panel">
          <div className="panel-heading properties-heading">
            <div className="panel-title"><SlidersIcon /><span>THUỘC TÍNH</span></div>
            <button className="subtle-icon" aria-label="Thông tin thuộc tính" title="Thông tin thuộc tính" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={15} /></button>
          </div>
          {helpOpen && <div className="properties-help" role="note">Chọn cấu kiện trong mô hình hoặc cây bên trái để xem thuộc tính IFC. Dữ liệu chỉ hiển thị nếu có trong tệp.</div>}
          {selected ? (
            <div className="properties-content">
              <div className="selected-card">
                <div className="selected-icon"><Box size={20} /></div>
                <div className="selected-info"><h2>{selected.name}</h2><span>{selected.type}</span></div>
                <button className="subtle-icon" aria-label="Bỏ chọn cấu kiện" onClick={() => viewportRef.current?.clearSelection()}><X size={15} /></button>
              </div>
              <div className="property-section">
                <div className="section-label"><ChevronDown size={13} /> THÔNG TIN CHUNG</div>
              <div className="property-row"><span>Express ID</span><b>#{selected.expressID}</b></div>
              <div className="property-row"><span>Global ID</span><b>{selected.globalId || '—'}</b></div>
              <div className="property-row"><span>Loại IFC</span><b>{selected.type}</b></div>
              <div className="property-row"><span>Tên cấu kiện</span><b>{selected.name}</b></div>
              <div className="property-row"><span>Tag</span><b>{selected.tag || '—'}</b></div>
              <div className="property-row"><span>Màu IFC</span><b><span className="color-swatch" style={{ backgroundColor: selected.color }} />{selected.color}</b></div>
              </div>
              <div className="property-section geometry-section">
              <div className="section-label"><ChevronDown size={13} /> HÌNH HỌC</div>
              <div className="geometry-empty"><Crosshair size={15} /><span>Kích thước bao: {selected.dimensions}</span></div>
              </div>
              <div className="property-section">
              <div className="section-label"><ChevronDown size={13} /> PROPERTY SETS & QUANTITIES</div>
              {propertiesLoading && <div className="properties-message"><LoaderCircle size={14} className="loading-spinner" /> Đang đọc dữ liệu IFC...</div>}
              {propertiesError && <div className="properties-message properties-error">{propertiesError}</div>}
              {!propertiesLoading && !propertiesError && propertyGroups.length === 0 && (
                <div className="properties-message">Tệp IFC không có Property Set hoặc Quantity cho cấu kiện này.</div>
              )}
              {propertyGroups.map((group, index) => (
                <div className="ifc-property-group" key={`${group.name}-${index}`}>
                  <div className="ifc-property-heading">
                    <span>{group.name}</span>
                    <small>{group.type.replace(/^IFC/i, 'Ifc')}</small>
                  </div>
                  {group.properties.map((property, propertyIndex) => (
                    <div className="property-row ifc-property-row" key={`${property.name}-${propertyIndex}`}>
                      <span>{property.name}</span><b title={property.value}>{property.value}</b>
                    </div>
                  ))}
                </div>
              ))}
              </div>
            </div>
          ) : (
            <div className="properties-empty">
              <div className="properties-empty-icon"><Box size={21} /></div>
              <h2>Chưa chọn cấu kiện</h2>
              <p>Chọn một cấu kiện trong cây mô hình để xem thông tin và thông số kỹ thuật.</p>
              <div className="hint-card"><span className="hint-line" /><span>Thông tin thuộc tính<br />sẽ hiển thị tại đây</span></div>
            </div>
          )}
          <div className="properties-bottom">
            <ShieldCheck size={14} /><span>IFC 4.0 · DỮ LIỆU CẤU KIỆN</span>
          </div>
        </aside>
      </div>

      {analysisOpen && (
        <DataAnalysisPanel
          records={analysisRecords}
          initialLegend={colorLegend}
          sourceName={models.length > 1 ? 'Federated_Models' : fileName}
          centers={analysisCenters}
          loading={analysisLoading}
          progress={analysisProgress}
          error={analysisError}
          onClose={() => setAnalysisOpen(false)}
          onApplyColors={(colors, legend) => {
            setColorLegend(legend)
            viewportRef.current?.setDataColorization(colors)
          }}
          onLegendChange={setColorLegend}
          onRestoreColors={() => {
            setColorLegend([])
            viewportRef.current?.setDataColorization(new Map())
          }}
          onIsolate={(ids) => viewportRef.current?.isolateElements(ids)}
          onClearIsolation={() => viewportRef.current?.clearElementIsolation()}
          onQaVisualization={(ids, enabled) => viewportRef.current?.setQaVisualization(ids, enabled)}
          onFocus={(expressID) => viewportRef.current?.focusElement(expressID)}
        />
      )}
      {notice && <div className="toast"><Check size={15} />{notice}</div>}
      {boqOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setBoqOpen(false) }}>
          <section className="boq-modal" role="dialog" aria-modal="true" aria-labelledby="boq-title">
            <div className="modal-heading">
              <div className="modal-icon"><FileSpreadsheet size={19} /></div>
              <button className="subtle-icon" onClick={() => setBoqOpen(false)} aria-label="Đóng"><X size={17} /></button>
            </div>
            <h2 id="boq-title">Thống kê khối lượng</h2>
            <p className="modal-description">{fileName ? `Mô hình: ${fileName}` : 'Mở một tệp IFC để bắt đầu bóc tách khối lượng.'}</p>
            <div className="boq-summary">
              <span>SỐ CẤU KIỆN HIỂN THỊ <b>{filteredBoqRows.length} / {boqRows.length}</b></span>
              <label className="boq-filter">PHÂN LOẠI
                <select value={boqFilter} onChange={(event) => setBoqFilter(event.target.value)} disabled={boqLoading || boqRows.length === 0}>
                  <option value="all">Tất cả loại</option>
                  {boqTypes.map((type) => <option value={type} key={type}>{type}</option>)}
                </select>
              </label>
            </div>
            {boqLoading && (
              <div className="boq-loading" role="status" aria-live="polite">
                <LoaderCircle size={17} className="loading-spinner" />
                <span>Đang đọc dữ liệu khối lượng IFC... {boqProgress}%</span>
                <div className="progress-track"><div className="progress-value" style={{ width: `${boqProgress}%` }} /></div>
              </div>
            )}
            {boqError && <div className="boq-error" role="alert">{boqError}</div>}
            {!boqLoading && !boqError && boqRows.length === 0 && (
              <div className="boq-empty"><CircleHelp size={16} />{elements.length ? 'Chưa có dữ liệu BOQ để hiển thị.' : 'Chưa tải mô hình IFC. Hãy mở tệp .ifc trước khi thống kê.'}</div>
            )}
            {!boqLoading && !boqError && boqRows.length > 0 && (
              <div className="boq-table-wrap">
                <table className="boq-table">
                  <thead>
                    <tr><th>STT</th><th>Tệp IFC</th><th>Mã hiệu</th><th>Tên cấu kiện</th><th>Phân loại IFC</th><th>Vật liệu</th><th>Chiều dài</th><th>Diện tích</th><th>Thể tích</th></tr>
                  </thead>
                  <tbody>
                    {filteredBoqRows.map((row, index) => (
                      <tr key={row.instanceId}>
                        <td>{index + 1}</td><td title={row.fileName}>{row.fileName}</td><td title={row.code}>{row.code || '—'}</td><td title={row.name}>{row.name}</td>
                        <td>{row.type}</td><td title={row.material}>{row.material || '—'}</td>
                        <td>{formatQuantity(row.length)}</td><td>{formatQuantity(row.area)}</td><td>{formatQuantity(row.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={6}>TỔNG CỘNG ({filteredBoqRows.length} cấu kiện)</td><td>{formatQuantity(sumQuantity(filteredBoqRows, 'length'))}</td><td>{formatQuantity(sumQuantity(filteredBoqRows, 'area'))}</td><td>{formatQuantity(sumQuantity(filteredBoqRows, 'volume'))}</td></tr>
                  </tfoot>
                </table>
              </div>
            )}
            {boqExportError && <div className="boq-error" role="alert">{boqExportError}</div>}
            <div className="boq-actions">
              <span className="boq-units-note">Đơn vị theo IFC; ô trống nghĩa là tệp không có quantity. Bộ lọc chỉ ảnh hưởng bảng và tổng trên màn hình; Excel xuất toàn bộ mô hình.</span>
              <button className="button button-primary" onClick={exportBoq} disabled={boqRows.length === 0 || boqLoading || boqExporting}>
                {boqExporting ? <LoaderCircle size={15} className="loading-spinner" /> : <FileSpreadsheet size={15} />}
                {boqExporting ? 'Đang tạo Excel...' : 'Xuất ra file Excel (.xlsx)'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function SlidersIcon() {
  return <Settings2 size={16} />
}

export default App
