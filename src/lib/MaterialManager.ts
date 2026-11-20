import { Color, Mesh, MeshStandardMaterial, type Material, type Plane } from 'three'
import type { Object3D } from 'three'

type MaterialState = {
  selectedIds: ReadonlySet<string>
  xray: boolean
  ghost: boolean
  colorization: ReadonlyMap<string, string | null>
  qaIssueIds: ReadonlySet<string>
  qaMode: boolean
  modelOpacity: ReadonlyMap<number, number>
  modelTint: ReadonlyMap<number, string>
}

function getMaterials(material: Material | Material[]): Material[] {
  return Array.isArray(material) ? material : [material]
}

function getOriginalMaterial(mesh: Mesh): Material | Material[] {
  const original = mesh.userData.originalMaterial
  return (Array.isArray(original) || original?.isMaterial ? original : mesh.material) as Material | Material[]
}

export class MaterialManager {
  private readonly effectMaterials = new WeakMap<Mesh, Material | Material[]>()
  private clippingPlanes: Plane[] = []

  setClippingPlanes(planes: Plane[]): void {
    this.clippingPlanes = planes
  }

  capture(root: Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      object.userData.originalMaterial ??= object.material
    })
  }

  apply(root: Object3D, state: MaterialState): void {
    root.traverse((object) => {
      if (!(object instanceof Mesh) || object.userData.isMeasurement) return
      const original = getOriginalMaterial(object)
      getMaterials(original).forEach((material) => { material.clippingPlanes = this.clippingPlanes })
      const instanceId = object.userData.instanceId ?? object.parent?.userData.instanceId
      const modelKey = object.userData.modelKey ?? object.parent?.userData.modelKey
      const selected = typeof instanceId === 'string' && state.selectedIds.has(instanceId)
      const qaIssue = typeof instanceId === 'string' && state.qaIssueIds.has(instanceId)
      const qaGhosted = state.qaMode && !qaIssue
      const ghosted = (state.ghost && !selected) || qaGhosted
      const colorization = typeof instanceId === 'string' && state.colorization.has(instanceId)
        ? state.colorization.get(instanceId)
        : undefined
      const colorized = typeof instanceId === 'string' && state.colorization.has(instanceId)
      const opacity = typeof modelKey === 'number' ? (state.modelOpacity.get(modelKey) ?? 1) : 1
      const tint = typeof modelKey === 'number' ? state.modelTint.get(modelKey) : undefined
      const tinted = Boolean(tint && tint !== '#ffffff')
      const affected = selected || ghosted || state.xray || colorized || qaIssue || opacity < 1 || tinted
      const faded = !qaIssue && (ghosted || state.xray || opacity < 1 || (colorized && !selected && colorization === null))
      this.disposeEffectMaterial(object)
      object.userData.isGhosted = ghosted

      if (!affected) {
        object.material = original
        return
      }

      const clones = getMaterials(original).map((material) => {
        const clone = material.clone()
        clone.clippingPlanes = this.clippingPlanes
        if (clone instanceof MeshStandardMaterial) {
          if (tinted) clone.color.multiply(new Color(tint))
          if (selected && !state.qaMode) {
            clone.color.set(0x168cff)
            clone.emissive.set(0x064caa)
            clone.emissiveIntensity = 0.65
          } else if (qaIssue) {
            clone.color.set(0xff1717)
            clone.emissive.set(0xa90000)
            clone.emissiveIntensity = 0.8
          } else if (colorization) {
            clone.color.set(colorization)
            clone.emissive.set(0x000000)
            clone.emissiveIntensity = 0
          } else if (colorized) {
            clone.color.set(0xb8bec5)
            clone.emissive.set(0x000000)
            clone.emissiveIntensity = 0
          }
        }
        const effectOpacity = qaIssue ? 1 : ghosted ? 0.12 : colorized && !selected && colorization === null ? 0.35 : state.xray ? 0.2 : 1
        clone.opacity *= effectOpacity * opacity
        clone.transparent = faded || clone.transparent
        clone.depthWrite = !faded && clone.depthWrite
        clone.needsUpdate = true
        return clone
      })
      const assigned = Array.isArray(original) ? clones : clones[0]
      this.effectMaterials.set(object, assigned)
      object.material = assigned
    })
  }

  dispose(root: Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      this.disposeEffectMaterial(object)
      const original = getOriginalMaterial(object)
      getMaterials(original).forEach((material) => material.dispose())
      delete object.userData.originalMaterial
      delete object.userData.isGhosted
    })
  }

  private disposeEffectMaterial(mesh: Mesh): void {
    const effect = this.effectMaterials.get(mesh)
    if (!effect) return
    getMaterials(effect).forEach((material) => material.dispose())
    this.effectMaterials.delete(mesh)
  }
}
