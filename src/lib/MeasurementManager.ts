import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  ShapeUtils,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three'
import type { Camera, Material, Object3D } from 'three'

export type InteractionMode =
  | 'select'
  | 'measure-distance'
  | 'measure-area'
  | 'measure-angle'
  | 'measure-elevation'

export type MeasurementKind = 'distance' | 'area' | 'angle' | 'elevation'

type MeasurementRecord = {
  group: Group
  label: HTMLDivElement
  anchor: Vector3
}

const colors: Record<MeasurementKind, number> = {
  distance: 0xffc15e,
  area: 0x61d9bb,
  angle: 0xff9d66,
  elevation: 0x78b8ff,
}

export class MeasurementManager {
  private readonly root = new Group()
  private readonly labelRoot = document.createElement('div')
  private readonly records: MeasurementRecord[] = []
  private readonly draft = new Group()
  private readonly markerGeometry = new SphereGeometry(1, 14, 10)

  private readonly host: HTMLElement

  constructor(host: HTMLElement, scene: Object3D) {
    this.host = host
    this.labelRoot.className = 'measurement-label-root'
    host.appendChild(this.labelRoot)
    scene.add(this.root)
    this.root.add(this.draft)
  }

  addDistance(start: Vector3, end: Vector3): number {
    const distance = start.distanceTo(end)
    const delta = end.clone().sub(start)
    const label = `${distance.toFixed(3)} m`
    const tooltip = `ΔX ${delta.x.toFixed(3)} m · ΔY ${delta.y.toFixed(3)} m · ΔZ ${delta.z.toFixed(3)} m`
    const group = this.createLineMeasurement([start, end], colors.distance)
    this.addMarker(group, start, colors.distance)
    this.addMarker(group, end, colors.distance)
    this.addRecord(group, label, tooltip, start.clone().add(end).multiplyScalar(0.5))
    return distance
  }

  addElevation(point: Vector3, offset: number): number {
    const elevation = point.z + offset
    const group = new Group()
    this.addMarker(group, point, colors.elevation)
    const baseline = new Vector3(point.x, point.y, 0)
    if (Math.abs(point.z - baseline.z) > 0.001) group.add(this.createLine([baseline, point], colors.elevation))
    this.addRecord(group, `Z = ${elevation >= 0 ? '+' : ''}${elevation.toFixed(3)} m`, `Mốc chuẩn (Offset): ${offset.toFixed(3)} m`, point.clone().add(new Vector3(0, 0, 0.18)))
    return elevation
  }

  addArea(points: Vector3[]): number {
    const normal = this.polygonNormal(points)
    const origin = points[0]
    const basisX = points[1].clone().sub(origin).normalize()
    const basisY = normal.clone().cross(basisX).normalize()
    const contour = points.map((point) => {
      const relative = point.clone().sub(origin)
      return new Vector2(relative.dot(basisX), relative.dot(basisY))
    })
    const triangles = ShapeUtils.triangulateShape(contour, [])
    const positions = points.flatMap((point) => point.toArray())
    const indices = triangles.flatMap((triangle) => triangle)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const material = new MeshBasicMaterial({
      color: colors.area,
      transparent: true,
      opacity: 0.2,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    const group = new Group()
    const fill = new Mesh(geometry, material)
    fill.renderOrder = 1001
    group.add(fill)
    group.add(this.createLine([...points, points[0]], colors.area))
    points.forEach((point) => this.addMarker(group, point, colors.area))

    const centroid = points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / points.length)
    const area = this.polygonArea(points, normal)
    this.addRecord(group, `${area.toFixed(3)} m²`, 'Diện tích đa giác', centroid)
    return area
  }

  addAngle(start: Vector3, vertex: Vector3, end: Vector3): number {
    const armA = start.clone().sub(vertex).normalize()
    const armB = end.clone().sub(vertex).normalize()
    const angle = Math.acos(Math.max(-1, Math.min(1, armA.dot(armB))))
    const degrees = angle * 180 / Math.PI
    const radius = Math.max(Math.min(start.distanceTo(vertex), end.distanceTo(vertex)) * 0.22, 0.08)
    const normal = armA.clone().cross(armB).normalize()
    if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1)
    const tangent = normal.clone().cross(armA).normalize()
    const arc = Array.from({ length: 25 }, (_, index) => {
      const theta = angle * index / 24
      return vertex.clone()
        .addScaledVector(armA, Math.cos(theta) * radius)
        .addScaledVector(tangent, Math.sin(theta) * radius)
    })
    const group = this.createLineMeasurement([start, vertex, end], colors.angle)
    group.add(this.createLine(arc, colors.angle))
    this.addMarker(group, start, colors.angle)
    this.addMarker(group, vertex, colors.angle)
    this.addMarker(group, end, colors.angle)
    const bisector = armA.clone().add(armB).normalize()
    this.addRecord(group, `${degrees.toFixed(2)}°`, 'Góc giữa hai đoạn thẳng', vertex.clone().addScaledVector(bisector, radius * 1.35))
    return degrees
  }

  update(camera: Camera, width: number, height: number): void {
    this.records.forEach((record) => {
      const projected = record.anchor.clone().project(camera)
      const visible = projected.z >= -1 && projected.z <= 1
        && Math.abs(projected.x) <= 1.15 && Math.abs(projected.y) <= 1.15
      record.label.hidden = !visible
      if (!visible) return
      const x = (projected.x * 0.5 + 0.5) * width
      const y = (-projected.y * 0.5 + 0.5) * height
      record.label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
    })
  }

  clearDraft(): void {
    this.disposeObject(this.draft)
    this.draft.clear()
  }

  showDraftPoint(point: Vector3): void {
    this.draft.add(this.createMarker(point, 0xffd166))
  }

  removeLast(): boolean {
    const record = this.records.pop()
    if (!record) return false
    this.root.remove(record.group)
    record.label.remove()
    this.disposeObject(record.group)
    return true
  }

  clear(): void {
    this.records.splice(0).forEach((record) => {
      record.label.remove()
      this.disposeObject(record.group)
    })
    this.clearDraft()
  }

  dispose(): void {
    this.clear()
    this.host.removeChild(this.labelRoot)
    this.root.clear()
    this.markerGeometry.dispose()
  }

  private createLineMeasurement(points: Vector3[], color: number): Group {
    const group = new Group()
    group.add(this.createLine(points, color))
    return group
  }

  private createLine(points: Vector3[], color: number): Line {
    const geometry = new BufferGeometry().setFromPoints(points)
    const material = new LineBasicMaterial({ color, depthTest: false, toneMapped: false })
    const line = new Line(geometry, material)
    line.renderOrder = 1002
    return line
  }

  private addMarker(group: Group, position: Vector3, color: number): void {
    group.add(this.createMarker(position, color))
  }

  private createMarker(position: Vector3, color: number): Mesh {
    const marker = new Mesh(
      this.markerGeometry,
      new MeshBasicMaterial({ color, depthTest: false, toneMapped: false }),
    )
    marker.scale.setScalar(0.035)
    marker.position.copy(position)
    marker.renderOrder = 1003
    return marker
  }

  private addRecord(group: Group, text: string, tooltip: string, anchor: Vector3): void {
    const label = document.createElement('div')
    label.className = 'measurement-label'
    label.textContent = text
    label.title = tooltip
    this.labelRoot.appendChild(label)
    this.root.add(group)
    this.records.push({ group, label, anchor })
  }

  private polygonNormal(points: Vector3[]): Vector3 {
    const normal = new Vector3()
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length]
      normal.x += (point.y - next.y) * (point.z + next.z)
      normal.y += (point.z - next.z) * (point.x + next.x)
      normal.z += (point.x - next.x) * (point.y + next.y)
    })
    if (normal.lengthSq() < 1e-10) throw new Error('Không thể tính diện tích: các điểm gần như thẳng hàng.')
    return normal.normalize()
  }

  private polygonArea(points: Vector3[], normal: Vector3): number {
    const sum = new Vector3()
    points.forEach((point, index) => {
      sum.add(point.clone().cross(points[(index + 1) % points.length]))
    })
    return Math.abs(sum.dot(normal)) * 0.5
  }

  private disposeObject(object: Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof Mesh) && !(child instanceof Line)) return
      if (child.geometry !== this.markerGeometry) child.geometry.dispose()
      const materials: Material[] = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach((material) => material.dispose())
    })
  }
}
