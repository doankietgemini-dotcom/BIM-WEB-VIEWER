import { Box3, BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, Plane, Vector3 } from 'three'
import type { Object3D } from 'three'

export type SectionAxis = 'x' | 'y' | 'z'
export type SectionFace = 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'zMin' | 'zMax'
export type SectionRange = { min: number; max: number }
export type SectionRanges = Record<SectionAxis, SectionRange>
export type SectionFlips = Record<SectionFace, boolean>

const faces: { face: SectionFace; axis: SectionAxis; side: 'min' | 'max'; normal: Vector3 }[] = [
  { face: 'xMin', axis: 'x', side: 'min', normal: new Vector3(1, 0, 0) },
  { face: 'xMax', axis: 'x', side: 'max', normal: new Vector3(-1, 0, 0) },
  { face: 'yMin', axis: 'y', side: 'min', normal: new Vector3(0, 1, 0) },
  { face: 'yMax', axis: 'y', side: 'max', normal: new Vector3(0, -1, 0) },
  { face: 'zMin', axis: 'z', side: 'min', normal: new Vector3(0, 0, 1) },
  { face: 'zMax', axis: 'z', side: 'max', normal: new Vector3(0, 0, -1) },
]

export class SectionBoxManager {
  readonly planes = faces.map(() => new Plane())
  private readonly sourceBounds = new Box3()
  private readonly sectionBounds = new Box3()
  private readonly helper: LineSegments
  private readonly helperGeometry: BufferGeometry
  private readonly helperMaterial: LineBasicMaterial
  private readonly helperGroup = new Group()
  private readonly scene: Object3D
  private ranges: SectionRanges = {
    x: { min: 0, max: 0 },
    y: { min: 0, max: 0 },
    z: { min: 0, max: 0 },
  }
  private limits: SectionRanges = {
    x: { min: 0, max: 0 },
    y: { min: 0, max: 0 },
    z: { min: 0, max: 0 },
  }
  private flips: SectionFlips = {
    xMin: false,
    xMax: false,
    yMin: false,
    yMax: false,
    zMin: false,
    zMax: false,
  }
  enabled = false
  helperVisible = false

  constructor(scene: Object3D) {
    this.scene = scene
    this.helperGeometry = new BufferGeometry()
    this.helperGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(72), 3))
    this.helperMaterial = new LineBasicMaterial({
      color: 0x66dcbc,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
      toneMapped: false,
    })
    this.helper = new LineSegments(this.helperGeometry, this.helperMaterial)
    this.helper.renderOrder = 20
    this.helperGroup.add(this.helper)
    scene.add(this.helperGroup)
    this.helperGroup.visible = false
  }

  setBounds(bounds: Box3): SectionRanges {
    this.sourceBounds.copy(bounds)
    this.sectionBounds.copy(bounds)
    const size = bounds.getSize(new Vector3())
    const margin = Math.max(size.x, size.y, size.z, 1) * 0.002
    this.ranges = {
      x: { min: bounds.min.x - margin, max: bounds.max.x + margin },
      y: { min: bounds.min.y - margin, max: bounds.max.y + margin },
      z: { min: bounds.min.z - margin, max: bounds.max.z + margin },
    }
    this.limits = {
      x: { ...this.ranges.x },
      y: { ...this.ranges.y },
      z: { ...this.ranges.z },
    }
    this.flips = { xMin: false, xMax: false, yMin: false, yMax: false, zMin: false, zMax: false }
    this.update()
    return this.getRanges()
  }

  getRanges(): SectionRanges {
    return {
      x: { ...this.ranges.x },
      y: { ...this.ranges.y },
      z: { ...this.ranges.z },
    }
  }

  getLimits(): SectionRanges {
    return {
      x: { ...this.limits.x },
      y: { ...this.limits.y },
      z: { ...this.limits.z },
    }
  }

  getFlips(): SectionFlips {
    return { ...this.flips }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.applyVisibility()
  }

  setHelperVisible(visible: boolean): void {
    this.helperVisible = visible
    this.applyVisibility()
  }

  setRange(axis: SectionAxis, side: 'min' | 'max', value: number): void {
    const range = this.ranges[axis]
    range[side] = side === 'min'
      ? Math.min(value, range.max)
      : Math.max(value, range.min)
    this.update()
  }

  flip(face: SectionFace): SectionFlips {
    this.flips[face] = !this.flips[face]
    this.update()
    return this.getFlips()
  }

  reset(): SectionRanges {
    if (!this.sourceBounds.isEmpty()) this.setBounds(this.sourceBounds.clone())
    return this.getRanges()
  }

  contains(point: Vector3): boolean {
    if (!this.enabled) return true
    return faces.every(({ face, axis, side }) => {
      const value = point[axis]
      const boundary = this.ranges[axis][side]
      return this.flips[face]
        ? side === 'min' ? value <= boundary : value >= boundary
        : side === 'min' ? value >= boundary : value <= boundary
    })
  }

  applyMaterials(root: Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        material.clippingPlanes = this.planes
        material.clipIntersection = false
        material.needsUpdate = true
      })
    })
  }

  dispose(): void {
    this.scene.remove(this.helperGroup)
    this.helperGeometry.dispose()
    this.helperMaterial.dispose()
    this.helperGroup.clear()
  }

  private update(): void {
    faces.forEach(({ face, axis, side, normal }, index) => {
      const direction = normal.clone()
      if (this.flips[face]) direction.negate()
      const boundary = this.ranges[axis][side]
      this.planes[index].set(direction, -direction[axis] * boundary)
      if (!this.enabled) this.planes[index].constant = 1e20
    })
    this.sectionBounds.min.set(this.ranges.x.min, this.ranges.y.min, this.ranges.z.min)
    this.sectionBounds.max.set(this.ranges.x.max, this.ranges.y.max, this.ranges.z.max)
    const { min, max } = this.sectionBounds
    const corners = [
      new Vector3(min.x, min.y, min.z),
      new Vector3(max.x, min.y, min.z),
      new Vector3(max.x, max.y, min.z),
      new Vector3(min.x, max.y, min.z),
      new Vector3(min.x, min.y, max.z),
      new Vector3(max.x, min.y, max.z),
      new Vector3(max.x, max.y, max.z),
      new Vector3(min.x, max.y, max.z),
    ]
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ]
    const positions = edges.flatMap(([start, end]) => [...corners[start].toArray(), ...corners[end].toArray()])
    this.helperGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    this.helperGeometry.computeBoundingSphere()
  }

  private applyVisibility(): void {
    this.update()
    this.helperGroup.visible = this.enabled && this.helperVisible
  }
}
