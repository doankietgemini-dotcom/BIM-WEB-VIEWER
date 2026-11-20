import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  AmbientLight,
  Box3,
  BufferGeometry,
  DirectionalLight,
  Group,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { IfcModelLoader } from '../lib/IfcModelLoader'
import { MaterialManager } from '../lib/MaterialManager'
import { MeasurementManager } from '../lib/MeasurementManager'
import type { InteractionMode } from '../lib/MeasurementManager'
import { SectionBoxManager } from '../lib/SectionBoxManager'
import type { SectionAxis, SectionFace, SectionFlips, SectionRanges } from '../lib/SectionBoxManager'
import type { StandardView } from './FloatingViewportToolbar'
import type { IfcAnalysisElement, IfcBoqRow, IfcLoadProgress, IfcPropertyGroup, LoadedIfcModel } from '../lib/IfcModelLoader'

export type ViewProjection = 'perspective' | 'orthographic'
export type SectionControlState = {
  ranges: SectionRanges
  limits: SectionRanges
  flips: SectionFlips
  enabled: boolean
  helperVisible: boolean
}

export type IfcViewportHandle = {
  resetView: () => void
  rotateModel: (axis: 'x' | 'y' | 'z', direction: 1 | -1) => void
  resetModelOrientation: () => void
  focusElement: (instanceId: string, additive?: boolean) => void
  addModels: (files: File[]) => void
  removeModel: (modelKey: number) => void
  setModelVisibility: (modelKey: number, visible: boolean) => void
  setModelOpacity: (modelKey: number, opacity: number) => void
  setModelColorTint: (modelKey: number, color: string) => void
  focusModel: (modelKey: number) => void
  clearSelection: () => void
  setTypeVisibility: (type: string, visible: boolean) => void
  setInteractionMode: (mode: InteractionMode) => void
  cancelMeasurement: () => void
  setElevationOffset: (offset: number) => void
  finishAreaMeasurement: () => void
  removeLastMeasurement: () => void
  clearMeasurements: () => void
  setGridVisible: (visible: boolean) => void
  toggleTypeIsolation: (type: string) => boolean
  isolateSelection: () => void
  hideSelection: () => void
  ghostSelection: () => boolean
  showAll: () => void
  restoreDisplay: () => void
  setStandardView: (view: StandardView) => void
  toggleProjection: () => ViewProjection
  takeSnapshot: () => Promise<void>
  setSectionEnabled: (enabled: boolean) => void
  setSectionRange: (axis: SectionAxis, side: 'min' | 'max', value: number) => void
  flipSection: (face: SectionFace) => void
  setSectionHelperVisible: (visible: boolean) => void
  resetSection: () => void
  getElementProperties: (instanceId: string) => Promise<IfcPropertyGroup[]>
  getBoqRows: (onProgress: (progress: number) => void) => Promise<IfcBoqRow[]>
  getAnalysisElements: (onProgress: (progress: number) => void) => Promise<IfcAnalysisElement[]>
  getElementCenters: () => Map<string, Vector3>
  setDataColorization: (colors: Map<string, string | null>) => void
  setQaVisualization: (issueIDs: Set<string>, enabled: boolean) => void
  isolateElements: (instanceIds: string[]) => void
  clearElementIsolation: () => void
}

type IfcViewportProps = {
  xray: boolean
  showGrid: boolean
  onModelLoaded: (model: LoadedIfcModel) => void
  onProgress: (progress: IfcLoadProgress | null) => void
  onLoadError: (message: string | null) => void
  onSelectedElement: (instanceId: string | null) => void
  onSelectionChange: (instanceIds: string[]) => void
  onVisibilityChange: (hiddenTypes: string[]) => void
  onProjectionChange: (projection: ViewProjection) => void
  onXrayChange: (enabled: boolean) => void
  onSectionChange: (state: SectionControlState) => void
  onMeasurementUpdate: (measurement: MeasurementStatus) => void
}

export type MeasurementStatus = {
  mode: InteractionMode
  count: number
  pointCount: number
  result: string
}

class ThreeIfcViewport {
  readonly scene = new Scene()
  private readonly gridScene = new Scene()
  private readonly gridCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  camera: PerspectiveCamera | OrthographicCamera = new PerspectiveCamera(45, 1, 0.01, 1_000_000)
  controls: OrbitControls
  readonly loader = new IfcModelLoader()
  private readonly materialManager = new MaterialManager()
  private readonly sectionManager: SectionBoxManager
  readonly modelRoot = new Group()
  private readonly measurementManager: MeasurementManager
  private readonly renderer: WebGLRenderer
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private frame = 0
  private resizeObserver: ResizeObserver
  private selectedID: string | null = null
  private readonly selectedIDs = new Set<string>()
  private dataColorization = new Map<string, string | null>()
  private qaIssueIDs = new Set<string>()
  private qaVisualization = false
  private isolatedElementIDs = new Set<string>()
  private xray = false
  private interactionMode: InteractionMode = 'select'
  private measurementPoints: Vector3[] = []
  private measurementCount = 0
  private elevationOffset = 0
  private isolatedType: string | null = null
  private visibilityBeforeIsolation = new Map<Group, boolean>()
  private selectionCallback: (instanceId: string | null) => void
  private selectionChangeCallback: IfcViewportProps['onSelectionChange']
  private visibilityCallback: IfcViewportProps['onVisibilityChange']
  private projectionCallback: IfcViewportProps['onProjectionChange']
  private xrayCallback: IfcViewportProps['onXrayChange']
  private sectionCallback: IfcViewportProps['onSectionChange']
  private measurementCallback: IfcViewportProps['onMeasurementUpdate']
  private pointerDown: Vector2 | null = null
  private readonly grid: Mesh<PlaneGeometry, ShaderMaterial>
  private readonly modelDisplay = new Map<number, { visible: boolean; opacity: number; colorTint: string }>()
  private ghost = false
  private cameraTween: {
    fromPosition: Vector3
    toPosition: Vector3
    fromTarget: Vector3
    toTarget: Vector3
    startedAt: number
    duration: number
  } | null = null

  constructor(
    host: HTMLDivElement,
    selectionCallback: (instanceId: string | null) => void,
    selectionChangeCallback: IfcViewportProps['onSelectionChange'],
    visibilityCallback: IfcViewportProps['onVisibilityChange'],
    projectionCallback: IfcViewportProps['onProjectionChange'],
    xrayCallback: IfcViewportProps['onXrayChange'],
    sectionCallback: IfcViewportProps['onSectionChange'],
    measurementCallback: IfcViewportProps['onMeasurementUpdate'],
  ) {
    this.selectionCallback = selectionCallback
    this.selectionChangeCallback = selectionChangeCallback
    this.visibilityCallback = visibilityCallback
    this.projectionCallback = projectionCallback
    this.xrayCallback = xrayCallback
    this.sectionCallback = sectionCallback
    this.measurementCallback = measurementCallback
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true })
    this.renderer.localClippingEnabled = true
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = 'srgb'
    this.renderer.autoClear = false
    this.renderer.domElement.className = 'viewer-canvas'
    this.renderer.domElement.setAttribute('aria-label', 'Mô hình IFC 3D')
    host.appendChild(this.renderer.domElement)

    this.camera.up.set(0, 0, 1)
    this.camera.position.set(24, -32, 24)
    this.scene.add(new AmbientLight(0xffffff, 1.6))

    const keyLight = new DirectionalLight(0xffffff, 2.4)
    keyLight.position.set(1, -1, 2)
    this.scene.add(keyLight)

    const fillLight = new DirectionalLight(0xd2e5ff, 1.1)
    fillLight.position.set(-1, 1, 1)
    this.scene.add(fillLight)

    this.grid = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
      uniforms: {
        cameraWorldMatrix: { value: this.camera.matrixWorld },
        gridHeight: { value: -0.01 },
        tanHalfFov: { value: Math.tan((45 * Math.PI) / 360) },
        aspect: { value: 1 },
        orthographic: { value: false },
        orthoHeight: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform mat4 cameraWorldMatrix;
        uniform float gridHeight;
        uniform float tanHalfFov;
        uniform float aspect;
        uniform bool orthographic;
        uniform float orthoHeight;
        varying vec2 vUv;

        float gridLine(vec2 coordinate, float spacing) {
          vec2 derivative = fwidth(coordinate / spacing);
          vec2 distanceToLine = abs(fract(coordinate / spacing - 0.5) - 0.5) / derivative;
          return 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
        }

        void main() {
          vec2 screen = vUv * 2.0 - 1.0;
          vec3 rayDirection;
          vec3 rayOrigin = cameraPosition;
          if (orthographic) {
            rayDirection = normalize((cameraWorldMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
            vec3 cameraRight = cameraWorldMatrix[0].xyz;
            vec3 cameraUp = cameraWorldMatrix[1].xyz;
            rayOrigin += cameraRight * screen.x * orthoHeight * aspect * 0.5;
            rayOrigin += cameraUp * screen.y * orthoHeight * 0.5;
          } else {
            vec3 rayView = normalize(vec3(screen.x * tanHalfFov * aspect, screen.y * tanHalfFov, -1.0));
            rayDirection = normalize((cameraWorldMatrix * vec4(rayView, 0.0)).xyz);
          }
          if (abs(rayDirection.z) < 0.000001) discard;

          float distanceToFloor = (gridHeight - rayOrigin.z) / rayDirection.z;
          if (distanceToFloor <= 0.0) discard;
          vec3 worldPosition = rayOrigin + rayDirection * distanceToFloor;
          float minorLine = gridLine(worldPosition.xy, 1.0);
          float majorLine = gridLine(worldPosition.xy, 10.0);
          float intensity = max(minorLine * 0.38, majorLine * 0.58);
          if (intensity < 0.01) discard;

          gl_FragColor = vec4(vec3(0.20, 0.25, 0.31), intensity * 0.38);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }))
    this.grid.frustumCulled = false
    this.grid.renderOrder = -1
    this.gridScene.add(this.grid)
    this.scene.add(this.modelRoot)
    this.sectionManager = new SectionBoxManager(this.scene)
    this.measurementManager = new MeasurementManager(host, this.scene)
    this.grid.visible = true

    this.controls = this.createControls()
    this.controls.target.set(0, 0, 0)

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.addEventListener('dblclick', this.handleDoubleClick)
    window.addEventListener('keydown', this.handleMeasurementKey)
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(host)
    this.resize()
    this.animate()
  }

  setXray(enabled: boolean): void {
    this.xray = enabled
    this.applyMaterialState()
  }

  async addModels(
    files: File[],
    onProgress: (progress: IfcLoadProgress) => void,
    onLoaded: (model: LoadedIfcModel) => void,
    onError: (fileName: string, message: string) => void,
  ): Promise<void> {
    for (const file of files) {
      try {
        const loaded = await this.loader.load(file, (progress) => onProgress({ ...progress, fileName: file.name }))
        this.modelRoot.add(loaded.group)
        this.modelDisplay.set(loaded.modelKey, { visible: true, opacity: 1, colorTint: '#ffffff' })
        this.loader.setModelVisibility(loaded.modelKey, true)
        this.materialManager.capture(loaded.group)
        this.updateModelBounds()
        this.updateGridHeight()
        this.focusBounds(new Box3().setFromObject(loaded.group))
        this.applyMaterialState()
        onLoaded(loaded)
      } catch (error) {
        onError(file.name, error instanceof Error ? error.message : 'Đã xảy ra lỗi khi đọc tệp IFC.')
      }
    }
  }

  removeModel(modelKey: number): void {
    const model = this.loader.removeModel(modelKey)
    if (!model) return
    const removedIDs = new Set(model.elements.map((element) => element.instanceId))
    for (const id of removedIDs) this.selectedIDs.delete(id)
    if (this.selectedID && removedIDs.has(this.selectedID)) {
      this.selectedID = null
      this.selectionCallback(null)
    }
    const group = this.modelRoot.children.find((child) => child.userData.modelKey === modelKey)
    if (group) {
      this.modelRoot.remove(group)
      this.materialManager.dispose(group)
      this.disposeGroup(group, false)
      group.clear()
    }
    this.modelDisplay.delete(modelKey)
    this.selectionChangeCallback([...this.selectedIDs])
    this.updateModelBounds()
    this.updateGridHeight()
    this.applyMaterialState()
    this.notifyVisibility()
  }

  setModelVisibility(modelKey: number, visible: boolean): void {
    const display = this.modelDisplay.get(modelKey)
    if (!display) return
    display.visible = visible
    this.loader.setModelVisibility(modelKey, visible)
    const group = this.modelRoot.children.find((child) => child.userData.modelKey === modelKey)
    if (group) group.visible = visible
    this.updateModelBounds()
    this.updateGridHeight()
    this.notifyVisibility()
  }

  setModelOpacity(modelKey: number, opacity: number): void {
    const display = this.modelDisplay.get(modelKey)
    if (!display) return
    display.opacity = Math.max(0, Math.min(1, opacity))
    this.applyMaterialState()
  }

  setModelColorTint(modelKey: number, color: string): void {
    const display = this.modelDisplay.get(modelKey)
    if (!display) return
    display.colorTint = color
    this.applyMaterialState()
  }

  focusModel(modelKey: number): void {
    const group = this.modelRoot.children.find((child) => child.userData.modelKey === modelKey)
    if (group) this.focusBounds(new Box3().setFromObject(group))
  }

  getElementProperties(instanceId: string): Promise<IfcPropertyGroup[]> {
    return this.loader.getElementProperties(instanceId)
  }

  getBoqRows(onProgress: (progress: number) => void): Promise<IfcBoqRow[]> {
    return this.loader.getBoqRows(onProgress)
  }

  getAnalysisElements(onProgress: (progress: number) => void): Promise<IfcAnalysisElement[]> {
    return this.loader.getAnalysisElements(onProgress)
  }

  getElementCenters(): Map<string, Vector3> {
    const centers = new Map<string, Vector3>()
    this.forEachElementGroup((group) => {
      const bounds = new Box3().setFromObject(group)
      if (!bounds.isEmpty()) centers.set(group.userData.instanceId, bounds.getCenter(new Vector3()))
    })
    return centers
  }

  setDataColorization(colors: Map<string, string | null>): void {
    this.dataColorization = colors
    this.applyMaterialState()
  }

  setQaVisualization(issueIDs: Set<string>, enabled: boolean): void {
    this.qaIssueIDs = issueIDs
    this.qaVisualization = enabled
    if (enabled) this.ghost = false
    this.applyMaterialState()
  }

  isolateElements(instanceIds: string[]): void {
    const nextIDs = new Set(instanceIds)
    if (this.visibilityBeforeIsolation.size > 0) {
      const alreadyIsolated = nextIDs.size === this.isolatedElementIDs.size
        && [...nextIDs].every((id) => this.isolatedElementIDs.has(id))
      if (alreadyIsolated) {
        this.visibilityBeforeIsolation.forEach((visible, group) => { group.visible = visible })
        this.visibilityBeforeIsolation.clear()
        this.isolatedElementIDs.clear()
        this.notifyVisibility()
        return
      }
      this.visibilityBeforeIsolation.forEach((visible, group) => { group.visible = visible })
      this.visibilityBeforeIsolation.clear()
    }
    this.isolatedElementIDs = nextIDs
    this.forEachElementGroup((group) => {
      this.visibilityBeforeIsolation.set(group, group.visible)
      group.visible = nextIDs.has(group.userData.instanceId)
    })
    this.isolatedType = null
    this.notifyVisibility()
  }

  clearElementIsolation(): void {
    this.visibilityBeforeIsolation.forEach((visible, group) => { group.visible = visible })
    this.visibilityBeforeIsolation.clear()
    this.isolatedElementIDs.clear()
    this.isolatedType = null
    this.notifyVisibility()
  }

  setTypeVisibility(type: string, visible: boolean): void {
    this.modelRoot.traverse((element) => {
      if (element instanceof Group && element.userData.ifcType === type) element.visible = visible
    })
    this.notifyVisibility()
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible
  }

  setInteractionMode(mode: InteractionMode): void {
    this.interactionMode = mode
    this.measurementPoints = []
    this.measurementManager.clearDraft()
    this.renderer.domElement.style.cursor = mode === 'select' ? '' : 'crosshair'
    this.emitMeasurementStatus('')
  }

  cancelMeasurement(): void {
    this.setInteractionMode('select')
  }

  setElevationOffset(offset: number): void {
    this.elevationOffset = offset
  }

  finishAreaMeasurement(): void {
    if (this.interactionMode !== 'measure-area' || this.measurementPoints.length < 3) return
    this.commitAreaMeasurement()
  }

  removeLastMeasurement(): void {
    if (this.measurementManager.removeLast()) this.measurementCount = Math.max(0, this.measurementCount - 1)
    this.emitMeasurementStatus('')
  }

  clearMeasurements(): void {
    this.measurementManager.clear()
    this.measurementPoints = []
    this.measurementCount = 0
    this.emitMeasurementStatus('')
  }

  setSectionEnabled(enabled: boolean): void {
    this.sectionManager.setEnabled(enabled)
    this.sectionCallback(this.getSectionState())
  }

  setSectionRange(axis: SectionAxis, side: 'min' | 'max', value: number): void {
    this.sectionManager.setRange(axis, side, value)
    this.sectionCallback(this.getSectionState())
  }

  flipSection(face: SectionFace): void {
    this.sectionManager.flip(face)
    this.sectionCallback(this.getSectionState())
  }

  setSectionHelperVisible(visible: boolean): void {
    this.sectionManager.setHelperVisible(visible)
    this.sectionCallback(this.getSectionState())
  }

  resetSection(): void {
    const ranges = this.sectionManager.reset()
    this.sectionManager.setEnabled(false)
    this.sectionCallback({ ...this.getSectionState(), ranges, enabled: false })
  }

  toggleTypeIsolation(type: string): boolean {
    this.isolatedElementIDs.clear()
    if (this.isolatedType === type) {
      this.visibilityBeforeIsolation.forEach((visible, group) => {
        group.visible = visible
      })
      this.visibilityBeforeIsolation.clear()
      this.isolatedType = null
      this.notifyVisibility()
      return false
    }

    if (this.isolatedType) {
      this.visibilityBeforeIsolation.forEach((visible, group) => {
        group.visible = visible
      })
      this.visibilityBeforeIsolation.clear()
    }
    this.isolatedType = type
    this.modelRoot.traverse((element) => {
      if (!(element instanceof Group) || typeof element.userData.ifcType !== 'string') return
      this.visibilityBeforeIsolation.set(element, element.visible)
      element.visible = element.userData.ifcType === type
    })
    this.notifyVisibility()
    return true
  }

  clearSelection(): void {
    this.selectedID = null
    this.selectedIDs.clear()
    this.applyMaterialState()
    this.selectionCallback(null)
    this.selectionChangeCallback([])
  }

  isolateSelection(): void {
    if (this.selectedIDs.size === 0) return
    this.ghost = false
    this.isolatedElementIDs.clear()
    this.forEachElementGroup((group) => {
      group.visible = this.selectedIDs.has(group.userData.instanceId)
    })
    this.isolatedType = null
    this.applyMaterialState()
    this.notifyVisibility()
  }

  hideSelection(): void {
    if (this.selectedIDs.size === 0) return
    this.forEachElementGroup((group) => {
      if (this.selectedIDs.has(group.userData.instanceId)) group.visible = false
    })
    this.selectedIDs.clear()
    this.selectedID = null
    this.ghost = false
    this.selectionCallback(null)
    this.selectionChangeCallback([])
    this.applyMaterialState()
    this.notifyVisibility()
  }

  ghostSelection(): boolean {
    if (this.selectedIDs.size === 0) return false
    this.ghost = !this.ghost
    this.applyMaterialState()
    return this.ghost
  }

  showAll(): void {
    this.modelDisplay.forEach((display, modelKey) => {
      display.visible = true
      this.loader.setModelVisibility(modelKey, true)
    })
    this.modelRoot.children.forEach((group) => { group.visible = true })
    this.forEachElementGroup((group) => { group.visible = true })
    this.visibilityBeforeIsolation.clear()
    this.isolatedType = null
    this.isolatedElementIDs.clear()
    this.ghost = false
    this.applyMaterialState()
    this.notifyVisibility()
  }

  restoreDisplay(): void {
    this.modelDisplay.forEach((display, modelKey) => {
      display.visible = true
      this.loader.setModelVisibility(modelKey, true)
    })
    this.modelRoot.children.forEach((group) => { group.visible = true })
    this.forEachElementGroup((group) => { group.visible = true })
    this.visibilityBeforeIsolation.clear()
    this.isolatedType = null
    this.isolatedElementIDs.clear()
    this.ghost = false
    this.xray = false
    this.dataColorization.clear()
    this.qaIssueIDs.clear()
    this.qaVisualization = false
    this.selectedIDs.clear()
    this.selectedID = null
    this.selectionCallback(null)
    this.selectionChangeCallback([])
    this.xrayCallback(false)
    this.applyMaterialState()
    this.notifyVisibility()
  }

  setStandardView(view: StandardView): void {
    const directions: Record<StandardView, { direction: Vector3; up: Vector3 }> = {
      top: { direction: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) },
      front: { direction: new Vector3(0, -1, 0), up: new Vector3(0, 0, 1) },
      back: { direction: new Vector3(0, 1, 0), up: new Vector3(0, 0, 1) },
      left: { direction: new Vector3(1, 0, 0), up: new Vector3(0, 0, 1) },
      right: { direction: new Vector3(-1, 0, 0), up: new Vector3(0, 0, 1) },
      bottom: { direction: new Vector3(0, 0, -1), up: new Vector3(0, -1, 0) },
      iso: { direction: new Vector3(1.4, -1.7, 2).normalize(), up: new Vector3(0, 0, 1) },
    }
    const { direction, up } = directions[view]
    const bounds = new Box3().setFromObject(this.modelRoot)
    const center = bounds.isEmpty() ? this.controls.target.clone() : bounds.getCenter(new Vector3())
    const radius = Math.max(bounds.getBoundingSphere(new Sphere()).radius, 0.1)
    const distance = radius / Math.sin((this.camera instanceof PerspectiveCamera ? this.camera.fov : 45) * Math.PI / 360) * 1.35
    if (this.camera instanceof OrthographicCamera) {
      this.camera.zoom = (this.camera.top - this.camera.bottom) / (radius * 2.7)
      this.camera.updateProjectionMatrix()
    }
    const currentTarget = this.controls.target.clone()
    this.controls.dispose()
    this.camera.up.copy(up)
    this.controls = this.createControls(currentTarget)
    this.animateCamera(center, center.clone().addScaledVector(direction, distance))
  }

  toggleProjection(): ViewProjection {
    const position = this.camera.position.clone()
    const up = this.camera.up.clone()
    const target = this.controls.target.clone()
    const distance = Math.max(this.camera instanceof OrthographicCamera
      ? (this.camera.top - this.camera.bottom) / (2 * Math.tan((45 * Math.PI) / 360) * this.camera.zoom)
      : position.distanceTo(target), 0.1)
    const viewDirection = position.clone().sub(target).normalize()
    const aspect = this.getCameraAspect()
    this.controls.dispose()
    if (this.camera instanceof PerspectiveCamera) {
      const height = 2 * distance * Math.tan((this.camera.fov * Math.PI) / 360)
      const ortho = new OrthographicCamera(
        -height * aspect / 2,
        height * aspect / 2,
        height / 2,
        -height / 2,
        this.camera.near,
        this.camera.far,
      )
      ortho.position.copy(position)
      ortho.up.copy(up)
      this.camera = ortho
    } else {
      const perspective = new PerspectiveCamera(45, aspect, this.camera.near, this.camera.far)
      perspective.position.copy(target).addScaledVector(viewDirection, distance)
      perspective.up.copy(up)
      this.camera = perspective
    }
    this.camera.updateProjectionMatrix()
    this.controls = this.createControls(target)
    const projection = this.camera instanceof PerspectiveCamera ? 'perspective' : 'orthographic'
    this.projectionCallback(projection)
    return projection
  }

  async takeSnapshot(): Promise<void> {
    const width = this.renderer.domElement.clientWidth
    const height = this.renderer.domElement.clientHeight
    if (!width || !height) throw new Error('Khung nhìn 3D chưa sẵn sàng để chụp ảnh.')
    const previousPixelRatio = this.renderer.getPixelRatio()
    try {
      this.renderer.setPixelRatio(Math.max(2, Math.min(window.devicePixelRatio * 2, 4)))
      this.renderer.setSize(width, height, false)
      this.renderFrame()
      const blob = await new Promise<Blob>((resolve, reject) => {
        this.renderer.domElement.toBlob((result) => {
          if (result) resolve(result)
          else reject(new Error('Không thể tạo ảnh PNG từ khung nhìn 3D.'))
        }, 'image/png')
      })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `BIM-Viewer-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } finally {
      this.renderer.setPixelRatio(previousPixelRatio)
      this.renderer.setSize(width, height, false)
      this.renderFrame()
    }
  }

  rotateModel(axis: 'x' | 'y' | 'z', direction: 1 | -1): void {
    const vector = new Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    )
    this.modelRoot.rotateOnWorldAxis(vector, direction * Math.PI / 2)
    this.modelRoot.updateMatrixWorld(true)
    this.updateGridHeight()
    this.focusBounds(new Box3().setFromObject(this.modelRoot), false)
  }

  resetModelOrientation(): void {
    this.modelRoot.rotation.set(0, 0, 0)
    this.modelRoot.updateMatrixWorld(true)
    this.updateGridHeight()
    this.focusBounds(new Box3().setFromObject(this.modelRoot), false)
  }

  resetView(): void {
    const bounds = new Box3().setFromObject(this.modelRoot)
    if (!bounds.isEmpty()) {
      this.focusBounds(bounds)
      return
    }

    this.camera.position.set(24, -32, 24)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  focusElement(instanceId: string, additive = false): void {
    const matches: Group[] = []
    this.modelRoot.traverse((child) => {
      if (child instanceof Group && child.userData.instanceId === instanceId) matches.push(child)
    })
    const element = matches[0]
    if (!element) return

    if (additive) {
      if (this.selectedIDs.has(instanceId)) this.selectedIDs.delete(instanceId)
      else this.selectedIDs.add(instanceId)
    } else {
      this.selectedIDs.clear()
      this.selectedIDs.add(instanceId)
    }
    this.selectedID = instanceId
    this.applyMaterialState()
    this.selectionCallback(instanceId)
    this.selectionChangeCallback([...this.selectedIDs])
    this.focusBounds(new Box3().setFromObject(element))
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.removeEventListener('dblclick', this.handleDoubleClick)
    window.removeEventListener('keydown', this.handleMeasurementKey)
    this.controls.dispose()
    this.loader.dispose()
    this.sectionManager.dispose()
    this.measurementManager.dispose()
    this.materialManager.dispose(this.modelRoot)
    this.disposeGroup(this.modelRoot, false)
    this.grid.geometry.dispose()
    this.grid.material.dispose()
    this.gridScene.clear()
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private readonly resize = (): void => {
    const canvas = this.renderer.domElement
    const width = canvas.parentElement?.clientWidth ?? 0
    const height = canvas.parentElement?.clientHeight ?? 0
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = width / height
    } else {
      const verticalSpan = this.camera.top - this.camera.bottom
      this.camera.left = -verticalSpan * (width / height) / 2
      this.camera.right = verticalSpan * (width / height) / 2
    }
    this.camera.updateProjectionMatrix()
  }

  private readonly animate = (): void => {
    this.frame = requestAnimationFrame(this.animate)
    this.updateCameraTween()
    this.controls.update()
    this.renderFrame()
  }

  private createControls(target = new Vector3()): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.minPolarAngle = 0.001
    controls.maxPolarAngle = Math.PI - 0.001
    controls.minDistance = 0.02
    controls.maxDistance = 100_000
    controls.target.copy(target)
    controls.update()
    return controls
  }

  private animateCamera(target: Vector3, position: Vector3): void {
    this.cameraTween = {
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      startedAt: performance.now(),
      duration: 550,
    }
  }

  private updateCameraTween(): void {
    const tween = this.cameraTween
    if (!tween) return
    const elapsed = (performance.now() - tween.startedAt) / tween.duration
    const progress = Math.min(elapsed, 1)
    const eased = progress * progress * (3 - 2 * progress)
    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased)
    this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased)
    if (progress === 1) this.cameraTween = null
  }

  private getCameraAspect(): number {
    if (this.camera instanceof PerspectiveCamera) return this.camera.aspect
    return (this.camera.right - this.camera.left) / (this.camera.top - this.camera.bottom)
  }

  private forEachElementGroup(callback: (group: Group) => void): void {
    this.modelRoot.traverse((object) => {
      if (object instanceof Group && typeof object.userData.instanceId === 'string') callback(object)
    })
  }

  private notifyVisibility(): void {
    const visibility = new Map<string, { total: number; visible: number }>()
    this.forEachElementGroup((group) => {
      const type = group.userData.ifcType
      if (typeof type !== 'string') return
      const counts = visibility.get(type) ?? { total: 0, visible: 0 }
      counts.total += 1
      if (group.visible) counts.visible += 1
      visibility.set(type, counts)
    })
    this.visibilityCallback([...visibility.entries()]
      .filter(([, counts]) => counts.total > 0 && counts.visible === 0)
      .map(([type]) => type))
  }

  private renderFrame(): void {
    this.camera.updateMatrixWorld()
    const uniforms = this.grid.material.uniforms
    uniforms.cameraWorldMatrix.value.copy(this.camera.matrixWorld)
    uniforms.orthographic.value = this.camera instanceof OrthographicCamera
    uniforms.tanHalfFov.value = this.camera instanceof PerspectiveCamera
      ? Math.tan((this.camera.fov * Math.PI) / 360)
      : 1
    uniforms.orthoHeight.value = this.camera instanceof OrthographicCamera
      ? (this.camera.top - this.camera.bottom) / this.camera.zoom
      : 1
    uniforms.aspect.value = this.getCameraAspect()
    this.measurementManager.update(
      this.camera,
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight,
    )
    this.renderer.clear()
    this.renderer.render(this.gridScene, this.gridCamera)
    this.renderer.render(this.scene, this.camera)
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.cameraTween = null
    this.pointerDown = new Vector2(event.clientX, event.clientY)
  }

  private readonly handleMeasurementKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.interactionMode !== 'select') {
      event.preventDefault()
      this.cancelMeasurement()
      return
    }
    if (event.key === 'Enter' && this.interactionMode === 'measure-area') {
      event.preventDefault()
      this.finishAreaMeasurement()
    }
  }

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    if (this.interactionMode === 'measure-area' && event.detail >= 2) this.finishAreaMeasurement()
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    if (this.pointerDown && this.pointerDown.distanceTo(new Vector2(event.clientX, event.clientY)) > 5) {
      this.pointerDown = null
      return
    }
    this.pointerDown = null
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const intersections = this.raycaster.intersectObject(this.modelRoot, true)
      .filter((intersection) => typeof intersection.object.userData.instanceId === 'string'
        && !(this.ghost && intersection.object.userData.isGhosted)
        && this.sectionManager.contains(intersection.point))
    if (this.interactionMode !== 'select') {
      if (this.interactionMode === 'measure-area' && event.detail >= 2) {
        this.finishAreaMeasurement()
        return
      }
      const point = intersections[0]?.point
      if (!point) return
      this.handleMeasurementPoint(point)
      return
    }

    const instanceId = intersections[0]?.object.userData.instanceId ?? null
    const additive = event.ctrlKey || event.shiftKey
    if (!additive) this.selectedIDs.clear()
    if (typeof instanceId === 'string') {
      if (additive && this.selectedIDs.has(instanceId)) this.selectedIDs.delete(instanceId)
      else this.selectedIDs.add(instanceId)
      this.selectedID = instanceId
    } else if (!additive) {
      this.selectedID = null
    }
    this.applyMaterialState()
    this.selectionCallback(this.selectedID)
    this.selectionChangeCallback([...this.selectedIDs])
  }

  private handleMeasurementPoint(point: Vector3): void {
    const mode = this.interactionMode
    if (mode === 'measure-elevation') {
      const elevation = this.measurementManager.addElevation(point, this.elevationOffset)
      this.measurementCount += 1
      this.emitMeasurementStatus(`Z = ${elevation >= 0 ? '+' : ''}${elevation.toFixed(3)} m`)
      return
    }

    this.measurementPoints.push(point.clone())
    this.measurementManager.showDraftPoint(point)
    if (mode === 'measure-distance' && this.measurementPoints.length >= 2) {
      const [start, end] = this.measurementPoints
      const distance = this.measurementManager.addDistance(start, end)
      this.measurementCount += 1
      this.measurementPoints = []
      this.measurementManager.clearDraft()
      this.emitMeasurementStatus(`${distance.toFixed(3)} m`)
      return
    }
    if (mode === 'measure-angle' && this.measurementPoints.length >= 3) {
      const [start, vertex, end] = this.measurementPoints
      const angle = this.measurementManager.addAngle(start, vertex, end)
      this.measurementCount += 1
      this.measurementPoints = []
      this.measurementManager.clearDraft()
      this.emitMeasurementStatus(`${angle.toFixed(2)}°`)
      return
    }
    this.emitMeasurementStatus('')
  }

  private commitAreaMeasurement(): void {
    try {
      const area = this.measurementManager.addArea(this.measurementPoints)
      this.measurementCount += 1
      this.measurementPoints = []
      this.measurementManager.clearDraft()
      this.emitMeasurementStatus(`${area.toFixed(3)} m²`)
    } catch (error) {
      this.measurementPoints = []
      this.measurementManager.clearDraft()
      this.emitMeasurementStatus(error instanceof Error ? error.message : 'Không thể tính diện tích đa giác.')
    }
  }

  private emitMeasurementStatus(result: string): void {
    this.measurementCallback({
      mode: this.interactionMode,
      count: this.measurementCount,
      pointCount: this.measurementPoints.length,
      result,
    })
  }

  private getSectionState(): SectionControlState {
    return {
      ranges: this.sectionManager.getRanges(),
      limits: this.sectionManager.getLimits(),
      flips: this.sectionManager.getFlips(),
      enabled: this.sectionManager.enabled,
      helperVisible: this.sectionManager.helperVisible,
    }
  }

  private focusBounds(bounds: Box3, setDistanceLimits = true): void {
    if (bounds.isEmpty()) return

    const center = bounds.getCenter(new Vector3())
    const sphere = bounds.getBoundingSphere(new Sphere())
    const radius = Math.max(sphere.radius, 0.1)
    const distance = radius / Math.sin((this.camera instanceof PerspectiveCamera
      ? this.camera.fov
      : 45) * Math.PI / 360) * 1.35
    const direction = new Vector3(1.4, -1.7, 2).normalize()

    this.controls.target.copy(center)
    this.camera.position.copy(center).addScaledVector(direction, distance)
    this.camera.near = Math.max(Math.min(radius / 1000, distance / 100), 0.001)
    this.camera.far = Math.max(distance + radius * 4, 10)
    if (this.camera instanceof OrthographicCamera) {
      const verticalSpan = this.camera.top - this.camera.bottom
      this.camera.zoom = verticalSpan / (radius * 2.7)
    }
    if (setDistanceLimits) {
      this.controls.minDistance = Math.max(radius * 0.005, this.camera.near * 5, 0.005)
      this.controls.maxDistance = Math.max(radius * 50, 10)
    }
    this.camera.updateProjectionMatrix()
    this.controls.update()

  }

  private updateGridHeight(): void {
    const bounds = new Box3().setFromObject(this.modelRoot)
    if (bounds.isEmpty()) return
    const radius = bounds.getBoundingSphere(new Sphere()).radius
    this.grid.material.uniforms.gridHeight.value = bounds.min.z - Math.max(radius * 0.005, 0.01)
  }

  private applyMaterialState(): void {
    this.materialManager.apply(this.modelRoot, {
      selectedIds: this.selectedIDs,
      xray: this.xray,
      ghost: this.ghost,
      colorization: this.dataColorization,
      qaIssueIds: this.qaIssueIDs,
      qaMode: this.qaVisualization,
      modelOpacity: new Map([...this.modelDisplay.entries()].map(([key, display]) => [key, display.opacity])),
      modelTint: new Map([...this.modelDisplay.entries()].map(([key, display]) => [key, display.colorTint])),
    })
  }

  private updateModelBounds(): void {
    const visibleBounds = new Box3()
    this.modelRoot.children.forEach((group) => {
      if (group.visible) visibleBounds.union(new Box3().setFromObject(group))
    })
    if (visibleBounds.isEmpty()) return
    const enabled = this.sectionManager.enabled
    const ranges = this.sectionManager.setBounds(visibleBounds)
    this.sectionManager.setEnabled(enabled)
    this.sectionCallback({
      ranges,
      limits: this.sectionManager.getLimits(),
      flips: this.sectionManager.getFlips(),
      enabled,
      helperVisible: this.sectionManager.helperVisible,
    })
  }

  private disposeGroup(group: Object3D, disposeMaterials = true): void {
    group.traverse((object) => {
      if ('geometry' in object && object.geometry instanceof BufferGeometry) object.geometry.dispose()
      if (disposeMaterials && 'material' in object) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      }
    })
  }

}

const IfcViewport = forwardRef<IfcViewportHandle, IfcViewportProps>(function IfcViewport(
  {
    xray,
    showGrid,
    onModelLoaded,
    onProgress,
    onLoadError,
    onSelectedElement,
    onSelectionChange,
    onVisibilityChange,
    onProjectionChange,
    onXrayChange,
    onSectionChange,
    onMeasurementUpdate,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<ThreeIfcViewport | null>(null)
  const callbacksRef = useRef({
    onModelLoaded,
    onProgress,
    onLoadError,
    onSelectedElement,
    onSelectionChange,
    onVisibilityChange,
    onProjectionChange,
    onXrayChange,
    onSectionChange,
    onMeasurementUpdate,
  })

  callbacksRef.current = {
    onModelLoaded,
    onProgress,
    onLoadError,
    onSelectedElement,
    onSelectionChange,
    onVisibilityChange,
    onProjectionChange,
    onXrayChange,
    onSectionChange,
    onMeasurementUpdate,
  }

  useImperativeHandle(ref, () => ({
    resetView: () => viewportRef.current?.resetView(),
    rotateModel: (axis, direction) => viewportRef.current?.rotateModel(axis, direction),
    resetModelOrientation: () => viewportRef.current?.resetModelOrientation(),
    focusElement: (expressID, additive) => viewportRef.current?.focusElement(expressID, additive),
    addModels: (files) => {
      if (!viewportRef.current) return
      void viewportRef.current.addModels(
        files,
        (progress) => callbacksRef.current.onProgress(progress),
        (model) => {
          callbacksRef.current.onModelLoaded(model)
          callbacksRef.current.onLoadError(null)
        },
        (fileName, message) => callbacksRef.current.onLoadError(`${fileName}: ${message}`),
      ).finally(() => callbacksRef.current.onProgress(null))
    },
    removeModel: (modelKey) => viewportRef.current?.removeModel(modelKey),
    setModelVisibility: (modelKey, visible) => viewportRef.current?.setModelVisibility(modelKey, visible),
    setModelOpacity: (modelKey, opacity) => viewportRef.current?.setModelOpacity(modelKey, opacity),
    setModelColorTint: (modelKey, color) => viewportRef.current?.setModelColorTint(modelKey, color),
    focusModel: (modelKey) => viewportRef.current?.focusModel(modelKey),
    clearSelection: () => viewportRef.current?.clearSelection(),
    setTypeVisibility: (type, visible) => viewportRef.current?.setTypeVisibility(type, visible),
    setInteractionMode: (mode) => viewportRef.current?.setInteractionMode(mode),
    cancelMeasurement: () => viewportRef.current?.cancelMeasurement(),
    setElevationOffset: (offset) => viewportRef.current?.setElevationOffset(offset),
    finishAreaMeasurement: () => viewportRef.current?.finishAreaMeasurement(),
    removeLastMeasurement: () => viewportRef.current?.removeLastMeasurement(),
    clearMeasurements: () => viewportRef.current?.clearMeasurements(),
    setGridVisible: (visible) => viewportRef.current?.setGridVisible(visible),
    toggleTypeIsolation: (type) => viewportRef.current?.toggleTypeIsolation(type) ?? false,
    isolateSelection: () => viewportRef.current?.isolateSelection(),
    hideSelection: () => viewportRef.current?.hideSelection(),
    ghostSelection: () => viewportRef.current?.ghostSelection() ?? false,
    showAll: () => viewportRef.current?.showAll(),
    restoreDisplay: () => viewportRef.current?.restoreDisplay(),
    setStandardView: (view) => viewportRef.current?.setStandardView(view),
    toggleProjection: () => viewportRef.current?.toggleProjection() ?? 'perspective',
    takeSnapshot: () => viewportRef.current
      ? viewportRef.current.takeSnapshot()
      : Promise.reject(new Error('Khung xem mô hình chưa sẵn sàng.')),
    setSectionEnabled: (enabled) => viewportRef.current?.setSectionEnabled(enabled),
    setSectionRange: (axis, side, value) => viewportRef.current?.setSectionRange(axis, side, value),
    flipSection: (face) => viewportRef.current?.flipSection(face),
    setSectionHelperVisible: (visible) => viewportRef.current?.setSectionHelperVisible(visible),
    resetSection: () => viewportRef.current?.resetSection(),
    getElementProperties: (expressID) => viewportRef.current
      ? viewportRef.current.getElementProperties(expressID)
      : Promise.reject(new Error('Khung xem mô hình chưa sẵn sàng.')),
    getBoqRows: (onProgress) => viewportRef.current
      ? viewportRef.current.getBoqRows(onProgress)
      : Promise.reject(new Error('Khung xem mô hình chưa sẵn sàng.')),
    getAnalysisElements: (onProgress) => viewportRef.current
      ? viewportRef.current.getAnalysisElements(onProgress)
      : Promise.reject(new Error('Khung xem mô hình chưa sẵn sàng.')),
    getElementCenters: () => viewportRef.current?.getElementCenters() ?? new Map(),
    setDataColorization: (colors) => viewportRef.current?.setDataColorization(colors),
    setQaVisualization: (ids, enabled) => viewportRef.current?.setQaVisualization(ids, enabled),
    isolateElements: (ids) => viewportRef.current?.isolateElements(ids),
    clearElementIsolation: () => viewportRef.current?.clearElementIsolation(),
  }), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let viewport: ThreeIfcViewport
    try {
      viewport = new ThreeIfcViewport(
        host,
        (expressID) => callbacksRef.current.onSelectedElement(expressID),
        (expressIDs) => callbacksRef.current.onSelectionChange(expressIDs),
        (hiddenTypes) => callbacksRef.current.onVisibilityChange(hiddenTypes),
        (projection) => callbacksRef.current.onProjectionChange(projection),
        (enabled) => callbacksRef.current.onXrayChange(enabled),
        (state) => callbacksRef.current.onSectionChange(state),
        (measurement) => callbacksRef.current.onMeasurementUpdate(measurement),
      )
    } catch (error) {
      callbacksRef.current.onLoadError(
        error instanceof Error ? `Không thể khởi tạo WebGL: ${error.message}` : 'Không thể khởi tạo WebGL.',
      )
      return
    }

    viewportRef.current = viewport
    return () => {
      viewport.dispose()
      viewportRef.current = null
    }
  }, [])

  useEffect(() => {
    viewportRef.current?.setXray(xray)
  }, [xray])

  useEffect(() => {
    viewportRef.current?.setGridVisible(showGrid)
  }, [showGrid])

  return <div ref={hostRef} className="three-viewport" aria-label="Mô hình IFC" />
})

export default IfcViewport
