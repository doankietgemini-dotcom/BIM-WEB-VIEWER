import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Palette, Plus, RotateCcw, ScanSearch, ShieldCheck, X } from 'lucide-react'
import type { IfcAnalysisElement } from '../lib/IfcModelLoader'

export type ColorLegendEntry = {
  label: string
  color: string
  count: number
  instanceIds: string[]
}

type AttributeOption = { key: string; label: string }
type RuleId = 'name' | 'material' | 'volume' | 'naming' | 'duplicates'
type CustomRule = {
  id: number
  attribute: string
  condition: 'not-empty' | 'greater-than' | 'less-than' | 'contains'
  value: string
}
type QaIssue = { element: IfcAnalysisElement; reasons: string[] }

type DataAnalysisPanelProps = {
  records: IfcAnalysisElement[]
  initialLegend: ColorLegendEntry[]
  sourceName: string
  centers: Map<string, { x: number; y: number; z: number }>
  loading: boolean
  progress: number
  error: string
  onClose: () => void
  onApplyColors: (colors: Map<string, string | null>, legend: ColorLegendEntry[]) => void
  onLegendChange: (legend: ColorLegendEntry[]) => void
  onRestoreColors: () => void
  onIsolate: (instanceIds: string[]) => void
  onClearIsolation: () => void
  onQaVisualization: (ids: Set<string>, enabled: boolean) => void
  onFocus: (instanceId: string) => void
}

const coreAttributes: AttributeOption[] = [
  { key: 'IfcType', label: 'Phân loại cấu kiện (IfcType)' },
  { key: 'Storey', label: 'Tầng / Cao trình' },
  { key: 'Material', label: 'Vật liệu' },
  { key: 'Name', label: 'Tên cấu kiện' },
  { key: 'Tag', label: 'Tag / Mã hiệu' },
  { key: 'GlobalId', label: 'GlobalId' },
  { key: 'Volume', label: 'Thể tích' },
]

const ruleLabels: Record<RuleId, string> = {
  name: 'Thiếu tên cấu kiện',
  material: 'Chưa gán vật liệu',
  volume: 'Thiếu thể tích hoặc thể tích ≤ 0',
  naming: 'Tên không khớp tiền tố / Regex',
  duplicates: 'Trùng vị trí, loại và thể tích',
}

function valueFor(element: IfcAnalysisElement, key: string): string {
  const propertyKey = key.startsWith('property:') ? key.slice('property:'.length) : key
  if (key === 'IfcType') return element.type
  if (key === 'Storey') return element.storey
  if (key === 'Material') return element.material
  if (key === 'Name') return element.name
  if (key === 'Tag') return element.tag
  if (key === 'GlobalId') return element.globalId
  if (key === 'Volume') return element.volume === null ? '' : String(element.volume)
  return element.properties[propertyKey] ?? ''
}

function numericValue(value: string): number | null {
  const match = value.trim().replace(/,/g, '').match(/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function colorHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

function heatColor(ratio: number): string {
  const value = Math.max(0, Math.min(1, ratio))
  const stops = [[58, 205, 137], [255, 210, 69], [239, 76, 67]]
  const segment = value <= 0.5 ? value * 2 : (value - 0.5) * 2
  const from = value <= 0.5 ? stops[0] : stops[1]
  const to = value <= 0.5 ? stops[1] : stops[2]
  return colorHex(
    from[0] + (to[0] - from[0]) * segment,
    from[1] + (to[1] - from[1]) * segment,
    from[2] + (to[2] - from[2]) * segment,
  )
}

function categoricalColor(index: number): string {
  const hue = (index * 137.508 + 154) % 360
  return `hsl(${hue} 68% 58%)`
}

function addIssue(issues: Map<string, Set<string>>, id: string, reason: string): void {
  const reasons = issues.get(id) ?? new Set<string>()
  reasons.add(reason)
  issues.set(id, reasons)
}

function buildQaIssues(
  records: IfcAnalysisElement[],
  centers: Map<string, { x: number; y: number; z: number }>,
  enabledRules: Record<RuleId, boolean>,
  namingPattern: string,
  namingMode: 'prefix' | 'regex',
  customRules: CustomRule[],
): QaIssue[] {
  const issues = new Map<string, Set<string>>()
  let namingRegex: RegExp | null = null
  if (enabledRules.naming && namingMode === 'regex' && namingPattern.trim()) {
    try {
      namingRegex = new RegExp(namingPattern)
    } catch (error) {
      throw new Error(`Regex tên không hợp lệ: ${error instanceof Error ? error.message : 'cú pháp không hợp lệ.'}`)
    }
  }

  records.forEach((element) => {
    if (enabledRules.name && !element.name.trim()) addIssue(issues, element.instanceId, ruleLabels.name)
    if (enabledRules.material && !element.material.trim()) addIssue(issues, element.instanceId, ruleLabels.material)
    if (enabledRules.volume && (element.volume === null || element.volume <= 0)) {
      addIssue(issues, element.instanceId, ruleLabels.volume)
    }
    if (enabledRules.naming && namingPattern.trim()) {
      if (namingRegex) namingRegex.lastIndex = 0
      const valid = namingMode === 'prefix'
        ? element.name.startsWith(namingPattern)
        : Boolean(namingRegex?.test(element.name))
      if (!valid) addIssue(issues, element.instanceId, `${ruleLabels.naming}: ${namingPattern}`)
    }

    customRules.forEach((rule) => {
      const value = valueFor(element, rule.attribute)
      const numeric = numericValue(value)
      const threshold = numericValue(rule.value)
      const failed = rule.condition === 'not-empty'
        ? !value.trim()
        : rule.condition === 'greater-than'
          ? numeric === null || threshold === null || numeric <= threshold
          : rule.condition === 'less-than'
            ? numeric === null || threshold === null || numeric >= threshold
            : !value.toLowerCase().includes(rule.value.toLowerCase())
      if (failed) {
        const attribute = rule.attribute.startsWith('property:')
          ? rule.attribute.slice('property:'.length)
          : rule.attribute
        addIssue(issues, element.instanceId, `Tùy chỉnh · ${attribute} ${rule.condition} ${rule.value}`)
      }
    })
  })

  if (enabledRules.duplicates) {
    const tolerance = 0.001
    const buckets = new Map<string, IfcAnalysisElement[]>()
    records.forEach((element) => {
      const center = centers.get(element.instanceId)
      const volume = element.volume
      if (!center || volume === null) return
      const cell = [center.x, center.y, center.z].map((value) => Math.floor(value / tolerance))
      const candidates: IfcAnalysisElement[] = []
      for (let x = -1; x <= 1; x += 1) {
        for (let y = -1; y <= 1; y += 1) {
          for (let z = -1; z <= 1; z += 1) {
            const key = `${element.type}:${cell[0] + x}:${cell[1] + y}:${cell[2] + z}`
            candidates.push(...(buckets.get(key) ?? []))
          }
        }
      }
      candidates.forEach((candidate) => {
        const other = centers.get(candidate.instanceId)
        if (!other || candidate.type !== element.type || candidate.volume === null) return
        if (Math.abs(center.x - other.x) < tolerance
          && Math.abs(center.y - other.y) < tolerance
          && Math.abs(center.z - other.z) < tolerance
          && Math.abs(volume - candidate.volume) < tolerance) {
          addIssue(issues, element.instanceId, `${ruleLabels.duplicates} (${candidate.fileName} · #${candidate.expressID})`)
          addIssue(issues, candidate.instanceId, `${ruleLabels.duplicates} (${element.fileName} · #${element.expressID})`)
        }
      })
      const key = `${element.type}:${cell[0]}:${cell[1]}:${cell[2]}`
      const bucket = buckets.get(key) ?? []
      bucket.push(element)
      buckets.set(key, bucket)
    })
  }

  return records.flatMap((element) => {
    const reasons = issues.get(element.instanceId)
    return reasons ? [{ element, reasons: [...reasons] }] : []
  })
}

async function exportQaReport(issues: QaIssue[], sourceName: string): Promise<void> {
  const XLSX = await import('xlsx')
  const rows = [
    ['Tệp IFC', 'ExpressID', 'GlobalId', 'Tag', 'Tên cấu kiện', 'Phân loại IFC', 'Vật liệu', 'Tầng', 'Thể tích', 'Lỗi cần xử lý'],
    ...issues.map(({ element, reasons }) => [
      element.fileName,
      element.expressID,
      element.globalId,
      element.tag,
      element.name,
      element.type,
      element.material,
      element.storey,
      element.volume ?? '',
      reasons.join('; '),
    ]),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 38 }, { wch: 25 }, { wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 65 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'QA QC')
  const baseName = sourceName.replace(/\.ifc$/i, '').replace(/[<>:"/\\|?*]/g, '_').trim() || 'DuAn'
  XLSX.writeFile(workbook, `${baseName}_QA_QC.xlsx`)
}

export default function DataAnalysisPanel({
  records,
  initialLegend,
  sourceName,
  centers,
  loading,
  progress,
  error,
  onClose,
  onApplyColors,
  onLegendChange,
  onRestoreColors,
  onIsolate,
  onClearIsolation,
  onQaVisualization,
  onFocus,
}: DataAnalysisPanelProps) {
  const [tab, setTab] = useState<'colorize' | 'qaqc'>('colorize')
  const [attribute, setAttribute] = useState('IfcType')
  const [issues, setIssues] = useState<QaIssue[]>([])
  const [scanComplete, setScanComplete] = useState(false)
  const [scanError, setScanError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [qaVisible, setQaVisible] = useState(false)
  const [legend, setLegend] = useState<ColorLegendEntry[]>(initialLegend)
  const [activeLegend, setActiveLegend] = useState('')
  const [enabledRules, setEnabledRules] = useState<Record<RuleId, boolean>>({
    name: true, material: true, volume: true, naming: true, duplicates: true,
  })
  const [namingMode, setNamingMode] = useState<'prefix' | 'regex'>('prefix')
  const [namingPattern, setNamingPattern] = useState('')
  const [customRules, setCustomRules] = useState<CustomRule[]>([])
  const [nextRuleID, setNextRuleID] = useState(1)

  const attributes = useMemo(() => {
    const properties = new Set(records.flatMap((element) => Object.keys(element.properties)))
    return [
      ...coreAttributes,
      ...[...properties].sort((a, b) => a.localeCompare(b)).map((key) => ({ key: `property:${key}`, label: key })),
    ]
  }, [records])

  const applyColorization = () => {
    const values = records.map((element) => ({
      element,
      raw: valueFor(element, attribute.startsWith('property:') ? attribute.slice('property:'.length) : attribute),
    }))
    const nonEmpty = values.filter(({ raw }) => raw.trim())
    const numeric = nonEmpty.length > 0 && nonEmpty.every(({ raw }) => numericValue(raw) !== null)
    const colors = new Map<string, string | null>()
    const groups = new Map<string, IfcAnalysisElement[]>()
    values.forEach(({ element, raw }) => {
      const key = raw.trim() || '(Không có dữ liệu)'
      const group = groups.get(key) ?? []
      group.push(element)
      groups.set(key, group)
    })

    let legendEntries: ColorLegendEntry[]
    if (numeric) {
      const numericRows = nonEmpty.map(({ element, raw }) => ({ element, value: numericValue(raw) as number }))
      const min = Math.min(...numericRows.map((row) => row.value))
      const max = Math.max(...numericRows.map((row) => row.value))
      const bins = Array.from({ length: 8 }, (_, index) => ({
        label: `${(min + (max - min) * index / 8).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} – ${(min + (max - min) * (index + 1) / 8).toLocaleString('vi-VN', { maximumFractionDigits: 3 })}`,
        color: heatColor((index + 0.5) / 8),
        instanceIds: [] as string[],
      }))
      numericRows.forEach(({ element, value }) => {
        const ratio = max === min ? 0.5 : (value - min) / (max - min)
        const bin = Math.min(Math.floor(ratio * bins.length), bins.length - 1)
        const color = heatColor(ratio)
        colors.set(element.instanceId, color)
        bins[bin].instanceIds.push(element.instanceId)
      })
      legendEntries = bins.filter((bin) => bin.instanceIds.length > 0)
        .map((bin) => ({ ...bin, count: bin.instanceIds.length }))
      const missing = groups.get('(Không có dữ liệu)') ?? []
      if (missing.length) {
        legendEntries.push({
          label: '(Không có dữ liệu)',
          color: '#b8bec5',
          count: missing.length,
          instanceIds: missing.map((element) => element.instanceId),
        })
      }
    } else {
      const labels = [...groups.keys()].filter((label) => label !== '(Không có dữ liệu)').sort((a, b) => a.localeCompare(b))
      const colorByValue = new Map(labels.map((label, index) => [label, categoricalColor(index)]))
      groups.forEach((members, label) => {
        const color = colorByValue.get(label) ?? null
        members.forEach((element) => colors.set(element.instanceId, color))
      })
      legendEntries = [...groups.entries()].map(([label, members]) => ({
        label,
        color: colorByValue.get(label) ?? '#b8bec5',
        count: members.length,
        instanceIds: members.map((element) => element.instanceId),
      })).sort((a, b) => a.label.localeCompare(b.label))
    }
    setLegend(legendEntries)
    onLegendChange(legendEntries)
    setActiveLegend('')
    onClearIsolation()
    onQaVisualization(new Set(), false)
    onApplyColors(colors, legendEntries)
  }

  const runScan = () => {
    setScanError('')
    setScanComplete(false)
    try {
      const result = buildQaIssues(records, centers, enabledRules, namingPattern, namingMode, customRules)
      setIssues(result)
      setScanComplete(true)
      setQaVisible(false)
      onQaVisualization(new Set(), false)
    } catch (scanFailure) {
      setScanError(scanFailure instanceof Error ? scanFailure.message : 'Không thể chạy quy tắc QA/QC.')
    }
  }

  const toggleQaVisualization = () => {
    const next = !qaVisible
    setQaVisible(next)
    onClearIsolation()
    onQaVisualization(new Set(issues.map((issue) => issue.element.instanceId)), next)
  }

  const toggleLegendIsolation = (entry: ColorLegendEntry) => {
    if (activeLegend === entry.label) {
      setActiveLegend('')
      onClearIsolation()
    } else {
      setActiveLegend(entry.label)
      onIsolate(entry.instanceIds)
    }
  }

  const exportReport = async () => {
    setExporting(true)
    setExportError('')
    try {
      await exportQaReport(issues, sourceName)
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Không thể xuất báo cáo QA/QC.')
    } finally {
      setExporting(false)
    }
  }

  const addCustomRule = () => {
    setCustomRules((rules) => [...rules, {
      id: nextRuleID,
      attribute: attributes[0]?.key ?? 'Name',
      condition: 'not-empty',
      value: '',
    }])
    setNextRuleID((id) => id + 1)
  }

  const passed = Math.max(records.length - new Set(issues.map((issue) => issue.element.instanceId)).size, 0)
  const passPercent = records.length ? Math.round((passed / records.length) * 100) : 0

  return (
    <div className="analysis-backdrop" role="presentation">
      <section className="analysis-panel" role="dialog" aria-modal="true" aria-label="Phân tích dữ liệu và QA QC">
        <header className="analysis-heading">
          <div><ScanSearch size={18} /><div><strong>PHÂN TÍCH MÔ HÌNH</strong><small>{records.length.toLocaleString('vi-VN')} cấu kiện khả dụng</small></div></div>
          <button title="Đóng bảng phân tích" aria-label="Đóng bảng phân tích" onClick={onClose}><X size={17} /></button>
        </header>
        <nav className="analysis-tabs" aria-label="Công cụ phân tích">
          <button className={tab === 'colorize' ? 'is-active' : ''} onClick={() => setTab('colorize')}><Palette size={15} /> Tô màu dữ liệu</button>
          <button className={tab === 'qaqc' ? 'is-active' : ''} onClick={() => setTab('qaqc')}><ShieldCheck size={15} /> Kiểm lỗi QA/QC</button>
        </nav>

        {loading && <div className="analysis-loading" role="status">Đang đọc thuộc tính IFC… {progress}%<div><span style={{ width: `${progress}%` }} /></div></div>}
        {error && <div className="analysis-error" role="alert">{error}</div>}

        {tab === 'colorize' && (
          <div className="analysis-content">
            <label className="analysis-field">Thuộc tính tô màu
              <select value={attribute} onChange={(event) => setAttribute(event.target.value)} disabled={loading || records.length === 0}>
                {attributes.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
            <p className="analysis-hint">Thuộc tính số dùng dải màu xanh → vàng → đỏ; giá trị dạng chữ được phân màu theo nhóm. Cấu kiện thiếu dữ liệu hiển thị màu xám.</p>
            <div className="analysis-actions">
              <button className="button button-primary" disabled={loading || records.length === 0} onClick={applyColorization}><Palette size={14} /> Áp dụng tô màu</button>
              <button className="button" onClick={() => {
                setLegend([])
                onLegendChange([])
                setActiveLegend('')
                onClearIsolation()
                setQaVisible(false)
                onQaVisualization(new Set(), false)
                onRestoreColors()
              }}><RotateCcw size={14} /> Khôi phục màu gốc</button>
            </div>
            {legend.length > 0 && <div className="color-legend" aria-label="Bảng chú giải màu">
              <strong>CHÚ GIẢI · BẤM ĐỂ CÔ LẬP</strong>
              {legend.map((entry) => (
                <button key={entry.label} className={activeLegend === entry.label ? 'is-active' : ''} title={`Cô lập ${entry.label}`} onClick={() => toggleLegendIsolation(entry)}>
                  <i style={{ background: entry.color }} /><span>{entry.label}</span><small>{entry.count.toLocaleString('vi-VN')}</small>
                </button>
              ))}
            </div>}
          </div>
        )}

        {tab === 'qaqc' && (
          <div className="analysis-content">
            <div className="qa-rules">
              {(Object.keys(ruleLabels) as RuleId[]).map((id) => (
                <label key={id}><input type="checkbox" checked={enabledRules[id]} onChange={(event) => setEnabledRules((rules) => ({ ...rules, [id]: event.target.checked }))} /><span>{ruleLabels[id]}</span></label>
              ))}
            </div>
            {enabledRules.naming && <div className="naming-rule">
              <select aria-label="Kiểu quy tắc đặt tên" value={namingMode} onChange={(event) => setNamingMode(event.target.value as 'prefix' | 'regex')}>
                <option value="prefix">Tiền tố bắt buộc</option><option value="regex">Regex</option>
              </select>
              <input aria-label="Tiền tố hoặc Regex tên" placeholder={namingMode === 'prefix' ? 'Ví dụ: STR-' : 'Ví dụ: ^STR-'} value={namingPattern} onChange={(event) => setNamingPattern(event.target.value)} />
            </div>}
            <div className="custom-rules-heading"><strong>QUY TẮC TÙY CHỈNH</strong><button className="analysis-icon-button" title="Thêm quy tắc" aria-label="Thêm quy tắc tùy chỉnh" onClick={addCustomRule}><Plus size={14} /></button></div>
            {customRules.map((rule) => (
              <div className="custom-rule" key={rule.id}>
                <select aria-label="Thuộc tính quy tắc" value={rule.attribute} onChange={(event) => setCustomRules((rules) => rules.map((item) => item.id === rule.id ? { ...item, attribute: event.target.value } : item))}>
                  {attributes.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <select aria-label="Điều kiện quy tắc" value={rule.condition} onChange={(event) => setCustomRules((rules) => rules.map((item) => item.id === rule.id ? { ...item, condition: event.target.value as CustomRule['condition'] } : item))}>
                  <option value="not-empty">Không được rỗng</option><option value="greater-than">Lớn hơn</option><option value="less-than">Nhỏ hơn</option><option value="contains">Chứa ký tự</option>
                </select>
                {rule.condition !== 'not-empty' && <input aria-label="Giá trị quy tắc" value={rule.value} onChange={(event) => setCustomRules((rules) => rules.map((item) => item.id === rule.id ? { ...item, value: event.target.value } : item))} placeholder="Giá trị" />}
                <button className="analysis-icon-button" title="Xóa quy tắc" aria-label="Xóa quy tắc tùy chỉnh" onClick={() => setCustomRules((rules) => rules.filter((item) => item.id !== rule.id))}><X size={13} /></button>
              </div>
            ))}
            <button className="button button-primary qa-run" disabled={loading || records.length === 0} onClick={runScan}><ScanSearch size={14} /> Chạy quét kiểm lỗi</button>
            {scanError && <div className="analysis-error" role="alert">{scanError}</div>}
            {scanComplete && <>
              <div className="qa-summary">
                <div><strong>{passPercent}%</strong><span>Đạt</span><small>{passed}/{records.length}</small></div>
                <div className="qa-progress"><span style={{ width: `${passPercent}%` }} /></div>
                <b>{issues.length} cấu kiện lỗi</b>
              </div>
              <div className="analysis-actions qa-actions">
                <button className="button" disabled={issues.length === 0} onClick={toggleQaVisualization}><AlertTriangle size={14} />{qaVisible ? 'Tắt tô đỏ QA/QC' : 'Tô đỏ tất cả lỗi trên 3D'}</button>
                <button className="button" disabled={issues.length === 0 || exporting} onClick={() => void exportReport()}><Download size={14} />{exporting ? 'Đang xuất…' : 'Xuất báo cáo (.xlsx)'}</button>
              </div>
              {exportError && <div className="analysis-error" role="alert">{exportError}</div>}
              <div className="qa-issue-list" aria-label="Danh sách cấu kiện lỗi">
                {issues.length === 0
                  ? <div className="qa-all-clear"><CheckCircle2 size={16} /> Không phát hiện cấu kiện lỗi theo các quy tắc đã chọn.</div>
                  : issues.map((issue) => (
                    <button key={issue.element.instanceId} onClick={() => onFocus(issue.element.instanceId)}>
                      <span className="qa-issue-title">{issue.element.name || `${issue.element.type} #${issue.element.expressID}`}</span>
                      <small>{issue.element.fileName} · {issue.element.type} · #{issue.element.expressID}</small>
                      <span className="qa-issue-reasons">{issue.reasons.join(' · ')}</span>
                    </button>
                  ))}
              </div>
            </>}
          </div>
        )}
      </section>
    </div>
  )
}
