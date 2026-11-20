import { Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { IfcAPI as IfcAPIType } from 'web-ifc'

export type IfcElement = {
  instanceId: string
  modelKey: number
  modelId: number
  fileName: string
  expressID: number
  name: string
  type: string
  globalId: string
  tag: string
  color: string
  dimensions: string
}

export type IfcProperty = {
  name: string
  value: string
}

export type IfcPropertyGroup = {
  name: string
  type: string
  properties: IfcProperty[]
}

export type IfcBoqRow = {
  instanceId: string
  modelKey: number
  modelId: number
  fileName: string
  expressID: number
  code: string
  name: string
  type: string
  material: string
  length: number | null
  area: number | null
  volume: number | null
}

export type IfcAnalysisElement = {
  instanceId: string
  modelKey: number
  modelId: number
  fileName: string
  expressID: number
  name: string
  type: string
  globalId: string
  tag: string
  material: string
  storey: string
  properties: Record<string, string>
  volume: number | null
}

type SpatialNode = { expressID: number; type: string; children: SpatialNode[] }

export type IfcLoadProgress = {
  message: string
  progress: number
  fileName?: string
}

export type LoadedIfcModel = {
  modelKey: number
  modelId: number
  fileName: string
  group: Group
  elements: IfcElement[]
}

type RuntimeIfcModel = LoadedIfcModel & { visible: boolean }

function readValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'value' in value) {
    const innerValue = value.value
    if (typeof innerValue === 'string' || typeof innerValue === 'number') return String(innerValue)
  }
  return ''
}

function getPropertyValue(value: unknown): string {
  const primitive = readValue(value)
  if (primitive) return primitive
  if (Array.isArray(value)) return value.map(getPropertyValue).filter(Boolean).join(', ')
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const nestedValue = record.NominalValue ?? record.Value ?? record.value
    if (nestedValue !== undefined) return getPropertyValue(nestedValue)
    if (record.Name !== undefined) return readValue(record.Name)
  }
  return ''
}

function getDefinitions(definition: Record<string, unknown>): unknown[] {
  const values = definition.HasProperties ?? definition.Quantities
  if (Array.isArray(values)) return values
  return values === undefined || values === null ? [] : [values]
}

function getReferenceIDs(value: unknown): number[] {
  const references = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  return references.flatMap((reference) => {
    if (typeof reference === 'number' && Number.isInteger(reference)) return [reference]
    if (reference && typeof reference === 'object' && 'value' in reference) {
      const id = reference.value
      return typeof id === 'number' && Number.isInteger(id) ? [id] : []
    }
    return []
  })
}

function getDefinitionProperties(definition: Record<string, unknown>): IfcProperty[] {
  return getDefinitions(definition).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const property = entry as Record<string, unknown>
    const name = readValue(property.Name)
    const valueKey = ['NominalValue', 'LengthValue', 'AreaValue', 'VolumeValue', 'CountValue', 'WeightValue', 'TimeValue']
      .find((key) => property[key] !== undefined)
    const value = valueKey ? getPropertyValue(property[valueKey]) : ''
    return name && value ? [{ name, value }] : []
  })
}

function getNumericValue(value: string): number | null {
  const match = value.trim().replace(/,/g, '').match(/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i)
  if (!match) return null
  const number = Number(match[0])
  return Number.isFinite(number) ? number : null
}

function findQuantity(properties: IfcProperty[], dimension: 'length' | 'area' | 'volume'): number | null {
  const suffix = dimension
  const candidates = properties
    .map((property) => ({
      name: property.name.toLowerCase().replace(/[^a-z]/g, ''),
      value: getNumericValue(property.value),
    }))
    .filter((property): property is { name: string; value: number } =>
      property.value !== null && property.name.endsWith(suffix),
    ).sort((left, right) => {
      const priority = (name: string) => name.startsWith(`net${suffix}`)
        ? 0
        : name === suffix ? 1 : name.startsWith(`gross${suffix}`) ? 2 : 3
      return priority(left.name) - priority(right.name)
    })
  return candidates[0]?.value ?? null
}

function collectMaterialNames(
  value: unknown,
  names: Set<string>,
  getType: (expressID: number) => string,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectMaterialNames(entry, names, getType))
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  const explicitType = typeof record.type === 'string' ? record.type : ''
  const type = (explicitType || (typeof record.expressID === 'number' ? getType(record.expressID) : '')).toUpperCase()
  const name = readValue(record.Name)
  if (type.includes('MATERIAL') && name) names.add(name)
  Object.values(record).forEach((entry) => collectMaterialNames(entry, names, getType))
}

function formatDimension(value: number): string {
  return `${value.toFixed(2)} m`
}

function getVerticalAxisVotes(type: string, dimensions: Vector3): [number, number, number] {
  const axes: [number, number, number] = [dimensions.x, dimensions.y, dimensions.z]
  const sortedDimensions = [...axes].sort((a, b) => b - a)
  const normalizedType = type.toUpperCase()

  if (normalizedType === 'IFCCOLUMN' && sortedDimensions[1] > 0 && sortedDimensions[0] / sortedDimensions[1] > 2.5) {
    const axis = axes.indexOf(sortedDimensions[0])
    const votes: [number, number, number] = [0, 0, 0]
    votes[axis] = 2
    return votes
  }

  if ((normalizedType === 'IFCSLAB' || normalizedType === 'IFCPLATE') && sortedDimensions[1] > 0) {
    const axis = axes.indexOf(sortedDimensions[2])
    const votes: [number, number, number] = [0, 0, 0]
    if (sortedDimensions[2] / sortedDimensions[1] < 0.1) votes[axis] = 1
    return votes
  }

  return [0, 0, 0]
}

export class IfcModelLoader {
  private api: IfcAPIType | null = null
  private initPromise: Promise<IfcAPIType> | null = null
  private readonly models = new Map<number, RuntimeIfcModel>()
  private readonly storeyCache = new Map<number, Map<number, string>>()
  private nextModelKey = 1
  private federationOrigin: Vector3 | null = null
  private federationRotation: Vector3 | null = null
  private loadQueue: Promise<void> = Promise.resolve()
  private disposed = false

  load(file: File, onProgress: (progress: IfcLoadProgress) => void): Promise<LoadedIfcModel> {
    const result = this.loadQueue.then(() => this.loadInternal(file, onProgress))
    this.loadQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async getElementProperties(instanceId: string): Promise<IfcPropertyGroup[]> {
    const api = this.api
    const resolved = this.resolveElement(instanceId)
    if (!api || !resolved) {
      throw new Error('Mô hình IFC chưa sẵn sàng để đọc thuộc tính.')
    }

    const { modelId, expressID } = resolved
    const definitions = await this.getPropertyDefinitions(api, modelId, expressID)
    return definitions.flatMap((rawDefinition) => {
      if (!rawDefinition || typeof rawDefinition !== 'object') return []
      const definition = rawDefinition as Record<string, unknown>
      const definitionID = typeof definition.expressID === 'number' ? definition.expressID : null
      const type = definitionID === null
        ? 'IFCPROPERTYSET'
        : api.GetNameFromTypeCode(api.GetLineType(modelId, definitionID))
      const name = readValue(definition.Name) || type
      const properties = getDefinitionProperties(definition)
      return properties.length > 0 ? [{ name, type, properties }] : []
    })
  }

  async getBoqRows(onProgress: (progress: number) => void): Promise<IfcBoqRow[]> {
    const api = this.api
    if (!api || this.models.size === 0) {
      throw new Error('Mô hình IFC chưa sẵn sàng để bóc tách khối lượng.')
    }

    const rows: IfcBoqRow[] = []
    const models = [...this.models.values()].filter((model) => model.visible)
    const elements = models.flatMap((model) => model.elements)
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]
      const modelID = element.modelId
      const [definitions, materials] = await Promise.all([
        this.getPropertyDefinitions(api, modelID, element.expressID),
        this.getElementMaterials(api, modelID, element.expressID),
      ])
      const properties = definitions.flatMap((rawDefinition) => {
        if (!rawDefinition || typeof rawDefinition !== 'object') return []
        return getDefinitionProperties(rawDefinition as Record<string, unknown>)
      })
      const materialNames = new Set<string>()
      collectMaterialNames(materials, materialNames, (expressID) =>
        api.GetNameFromTypeCode(api.GetLineType(modelID, expressID)),
      )

      rows.push({
        instanceId: element.instanceId,
        modelKey: element.modelKey,
        modelId: modelID,
        fileName: element.fileName,
        expressID: element.expressID,
        code: element.tag || element.globalId,
        name: element.name,
        type: element.type,
        material: [...materialNames].join(', '),
        length: findQuantity(properties, 'length'),
        area: findQuantity(properties, 'area'),
        volume: findQuantity(properties, 'volume'),
      })
      onProgress(Math.round(((index + 1) / Math.max(elements.length, 1)) * 100))
      if (index % 20 === 0) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }
    return rows
  }

  async getAnalysisElements(onProgress: (progress: number) => void): Promise<IfcAnalysisElement[]> {
    const api = this.api
    const models = [...this.models.values()].filter((model) => model.visible)
    if (!api || models.length === 0) {
      throw new Error('Mô hình IFC chưa sẵn sàng để phân tích.')
    }

    const storeysByModel = new Map<number, Map<number, string>>()
    for (const model of models) {
      let storeys = this.storeyCache.get(model.modelKey)
      if (!storeys) {
        const spatialRoot = await api.properties.getSpatialStructure(model.modelId)
        storeys = new Map<number, string>()
        const assignStorey = (node: SpatialNode, storey: string) => {
          const currentStorey = node.type.toUpperCase() === 'IFCBUILDINGSTOREY'
            ? readValue(api.GetLine(model.modelId, node.expressID).Name) || `Storey #${node.expressID}`
            : storey
          if (currentStorey) storeys?.set(node.expressID, currentStorey)
          node.children.forEach((child) => assignStorey(child, currentStorey))
        }
        assignStorey(spatialRoot, '')
        this.storeyCache.set(model.modelKey, storeys)
      }
      storeysByModel.set(model.modelKey, storeys)
    }

    const rows: IfcAnalysisElement[] = []
    const elements = models.flatMap((model) => model.elements)
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]
      const modelID = element.modelId
      const [definitions, materials] = await Promise.all([
        this.getPropertyDefinitions(api, modelID, element.expressID),
        this.getElementMaterials(api, modelID, element.expressID),
      ])
      const properties: Record<string, string> = {}
      definitions.forEach((rawDefinition) => {
        if (!rawDefinition || typeof rawDefinition !== 'object') return
        const definition = rawDefinition as Record<string, unknown>
        const setName = readValue(definition.Name) || 'Thuộc tính'
        getDefinitionProperties(definition).forEach((property) => {
          properties[`${setName}.${property.name}`] ??= property.value
        })
      })
      const materialNames = new Set<string>()
      collectMaterialNames(materials, materialNames, (expressID) =>
        api.GetNameFromTypeCode(api.GetLineType(modelID, expressID)),
      )
      const volumeProperty = Object.entries(properties).find(([key]) => /(^|\.)(net|gross)?volume$/i.test(key))
      const volume = volumeProperty ? getNumericValue(volumeProperty[1]) : null
      rows.push({
        ...element,
        name: readValue(api.GetLine(modelID, element.expressID).Name),
        material: [...materialNames].join(', '),
        storey: storeysByModel.get(element.modelKey)?.get(element.expressID) ?? '',
        properties,
        volume,
      })
      onProgress(Math.round(((index + 1) / Math.max(elements.length, 1)) * 100))
      if (index % 20 === 0) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }
    return rows
  }

  setModelVisibility(modelKey: number, visible: boolean): void {
    const model = this.models.get(modelKey)
    if (model) model.visible = visible
  }

  removeModel(modelKey: number): LoadedIfcModel | null {
    const model = this.models.get(modelKey)
    if (!model) return null
    this.models.delete(modelKey)
    this.storeyCache.delete(modelKey)
    this.api?.CloseModel(model.modelId)
    if (this.models.size === 0) {
      this.federationOrigin = null
      this.federationRotation = null
    }
    return model
  }

  private resolveElement(instanceId: string): IfcElement | null {
    for (const model of this.models.values()) {
      const element = model.elements.find((candidate) => candidate.instanceId === instanceId)
      if (element) return element
    }
    return null
  }

  private async getPropertyDefinitions(
    api: IfcAPIType,
    modelID: number,
    elementID: number,
  ): Promise<unknown[]> {
    const definitions = await api.properties.getPropertySets(modelID, elementID, true, false)
    const typeObjects = await api.properties.getTypeProperties(modelID, elementID, false)
    const definitionIDs = new Set<number>()

    for (const rawTypeObject of typeObjects) {
      if (!rawTypeObject || typeof rawTypeObject !== 'object') continue
      const typeObject = rawTypeObject as Record<string, unknown>
      getReferenceIDs(typeObject.HasPropertySets).forEach((id) => definitionIDs.add(id))
    }

    const typeDefinitions = await Promise.all(
      [...definitionIDs].map((id) => api.GetLine(modelID, id, true)),
    )
    return [...definitions, ...typeDefinitions.filter(Boolean)]
  }

  private async getElementMaterials(
    api: IfcAPIType,
    modelID: number,
    elementID: number,
  ): Promise<unknown[]> {
    const materials = await api.properties.getMaterialsProperties(modelID, elementID, true, false)
    const typeObjects = await api.properties.getTypeProperties(modelID, elementID, false)
    const typeIDs = typeObjects.flatMap((typeObject) => {
      if (!typeObject || typeof typeObject !== 'object') return []
      const id = (typeObject as Record<string, unknown>).expressID
      return typeof id === 'number' && Number.isInteger(id) ? [id] : []
    })
    const typeMaterials = await Promise.all(typeIDs.map((id) =>
      api.properties.getMaterialsProperties(modelID, id, true, false),
    ))
    return [...materials, ...typeMaterials.flat()]
  }

  dispose(): void {
    this.disposed = true
    this.models.forEach((model) => this.api?.CloseModel(model.modelId))
    this.models.clear()
    this.storeyCache.clear()
    this.federationOrigin = null
    this.federationRotation = null
  }

  private initialize(): Promise<IfcAPIType> {
    if (!this.initPromise) {
      this.initPromise = import('web-ifc').then(async ({ IfcAPI }) => {
        const api = new IfcAPI()
        api.SetWasmPath('/wasm/')
        await api.Init(undefined, true)
        this.api = api
        return api
      })
    }
    return this.initPromise
  }

  private async loadInternal(
    file: File,
    onProgress: (progress: IfcLoadProgress) => void,
  ): Promise<LoadedIfcModel> {
    onProgress({ message: 'Đang khởi tạo bộ đọc IFC...', progress: 3 })
    const api = await this.initialize()

    onProgress({ message: 'Đang đọc dữ liệu IFC...', progress: 8 })
    const data = new Uint8Array(await file.arrayBuffer())
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const modelID = api.OpenModel(data)
    if (modelID < 0) {
      throw new Error('Không thể mở mô hình IFC. Hãy kiểm tra tệp có đúng định dạng IFC hay không.')
    }

    const modelKey = this.nextModelKey++
    const group = new Group()
    const elements: IfcElement[] = []
    const allElements: IfcElement[] = []
    const verticalAxisVotes: [number, number, number] = [0, 0, 0]
    let geometryOrigin: Vector3 | null = null

    try {
      const { IFCPRODUCT } = await import('web-ifc')
      const productIDs = api.GetLineIDsWithType(modelID, IFCPRODUCT, true)
      const total = productIDs.size()

      if (total === 0) {
        throw new Error('Tệp IFC không có cấu kiện IfcProduct để hiển thị.')
      }

      onProgress({ message: 'Đang bắt đầu dựng hình 3D...', progress: 10 })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      for (let index = 0; index < total; index += 1) {
        const expressID = productIDs.get(index)
        const elementGroup = new Group()

        try {
          const line = api.GetLine(modelID, expressID)
          const type = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID))
          allElements.push({
            instanceId: `${modelKey}:${expressID}`,
            modelKey,
            modelId: modelID,
            fileName: file.name,
            expressID,
            name: readValue(line.Name) || `${type} #${expressID}`,
            type,
            globalId: readValue(line.GlobalId),
            tag: readValue(line.Tag),
            color: '#b8c0c8',
            dimensions: '—',
          })
          const flatMesh = api.GetFlatMesh(modelID, expressID)
          const elementBounds = new Box3()
          const elementColor = new Color(0.72, 0.75, 0.78)
          let hasGeometry = false

          for (let geometryIndex = 0; geometryIndex < flatMesh.geometries.size(); geometryIndex += 1) {
            const placedGeometry = flatMesh.geometries.get(geometryIndex)
            const ifcGeometry = api.GetGeometry(modelID, placedGeometry.geometryExpressID)

            try {
              const vertexData = api.GetVertexArray(ifcGeometry.GetVertexData(), ifcGeometry.GetVertexDataSize())
              const positions = new Float32Array((vertexData.length / 6) * 3)
              const normals = new Float32Array(positions.length)

              for (let vertex = 0, target = 0; vertex < vertexData.length; vertex += 6, target += 3) {
                positions[target] = vertexData[vertex]
                positions[target + 1] = vertexData[vertex + 1]
                positions[target + 2] = vertexData[vertex + 2]
                normals[target] = vertexData[vertex + 3]
                normals[target + 1] = vertexData[vertex + 4]
                normals[target + 2] = vertexData[vertex + 5]
              }

              const geometry = new BufferGeometry()
              geometry.setAttribute('position', new BufferAttribute(positions, 3))
              geometry.setAttribute('normal', new BufferAttribute(normals, 3))
              geometry.setIndex(new BufferAttribute(
                api.GetIndexArray(ifcGeometry.GetIndexData(), ifcGeometry.GetIndexDataSize()).slice(),
                1,
              ))
              const geometryTransform = new Matrix4().fromArray(placedGeometry.flatTransformation)
              if (!geometryOrigin) {
                geometryOrigin = new Vector3(
                  geometryTransform.elements[12],
                  geometryTransform.elements[13],
                  geometryTransform.elements[14],
                )
              }
              geometryTransform.elements[12] -= geometryOrigin.x
              geometryTransform.elements[13] -= geometryOrigin.y
              geometryTransform.elements[14] -= geometryOrigin.z
              geometry.applyMatrix4(geometryTransform)
              geometry.computeBoundingBox()

              const alpha = placedGeometry.hasColor ? placedGeometry.color.w : 1
              const materialColor = placedGeometry.hasColor
                ? new Color(placedGeometry.color.x, placedGeometry.color.y, placedGeometry.color.z)
                : new Color(0.72, 0.75, 0.78)
              const material = new MeshStandardMaterial({
                color: materialColor,
                opacity: alpha,
                transparent: alpha < 0.999,
                depthWrite: alpha >= 0.999,
                side: DoubleSide,
                roughness: 0.78,
                metalness: 0.04,
              })
              material.userData.ifcOpacity = alpha
              material.userData.ifcColor = material.color.getHex()
              const mesh = new Mesh(geometry, material)
              mesh.userData.expressID = expressID
              mesh.userData.instanceId = `${modelKey}:${expressID}`
              mesh.userData.modelKey = modelKey
              mesh.userData.originalMaterial = material
              elementGroup.add(mesh)

              if (geometry.boundingBox) {
                elementBounds.union(geometry.boundingBox)
              }
              if (placedGeometry.hasColor) {
                elementColor.copy(materialColor)
              }
              hasGeometry = true
            } finally {
              ifcGeometry.delete()
            }
          }

          if (hasGeometry) {
            elementGroup.userData.expressID = expressID
            elementGroup.userData.instanceId = `${modelKey}:${expressID}`
            elementGroup.userData.modelKey = modelKey
            elementGroup.userData.ifcType = type
            group.add(elementGroup)
            const dimensions = elementBounds.getSize(new Vector3())
            const axisVotes = getVerticalAxisVotes(type, dimensions)
            verticalAxisVotes[0] += axisVotes[0]
            verticalAxisVotes[1] += axisVotes[1]
            verticalAxisVotes[2] += axisVotes[2]
            const element = {
              instanceId: `${modelKey}:${expressID}`,
              modelKey,
              modelId: modelID,
              fileName: file.name,
              expressID,
              name: readValue(line.Name) || `${type} #${expressID}`,
              type,
              globalId: readValue(line.GlobalId),
              tag: readValue(line.Tag),
              color: `#${elementColor.getHexString()}`,
              dimensions: `${formatDimension(dimensions.x)} × ${formatDimension(dimensions.y)} × ${formatDimension(dimensions.z)}`,
            }
            elements.push(element)
            allElements[allElements.length - 1] = element
          }
        } catch (error) {
          elementGroup.traverse((object) => {
            if (object instanceof Mesh) {
              object.geometry.dispose()
              const materials = Array.isArray(object.material) ? object.material : [object.material]
              materials.forEach((material) => material.dispose())
            }
          })
          console.warn(`Skipping IFC element ${expressID} because its geometry could not be loaded.`, error)
        }

        if (index % 25 === 0 || index === total - 1) {
          onProgress({
            message: 'Đang dựng hình 3D...',
            progress: 10 + Math.round(((index + 1) / total) * 85),
          })
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        }
      }

      if (elements.length === 0) {
        throw new Error('Không tìm thấy hình học 3D trong tệp IFC.')
      }

      if (!this.federationRotation) {
        const verticalAxis = verticalAxisVotes.indexOf(Math.max(...verticalAxisVotes))
        const highestVote = verticalAxisVotes[verticalAxis]
        const secondHighestVote = Math.max(...verticalAxisVotes.filter((_, axis) => axis !== verticalAxis))
        const detectedVerticalAxis = highestVote >= 2 && highestVote > secondHighestVote * 1.5
          ? verticalAxis
          : 1
        this.federationRotation = new Vector3(
          detectedVerticalAxis === 1 ? Math.PI / 2 : 0,
          detectedVerticalAxis === 0 ? -Math.PI / 2 : 0,
          0,
        )
      }

      const localBounds = new Box3().setFromObject(group)
      const localCenter = localBounds.getCenter(new Vector3())
      if (!this.federationOrigin) {
        this.federationOrigin = (geometryOrigin ?? new Vector3()).add(localCenter)
      }
      group.rotation.set(
        this.federationRotation.x,
        this.federationRotation.y,
        this.federationRotation.z,
      )
      group.position.copy(geometryOrigin ?? new Vector3())
        .sub(this.federationOrigin)
        .applyEuler(group.rotation)
      group.updateMatrixWorld(true)
      if (geometryOrigin && Math.max(
        Math.abs(geometryOrigin.x),
        Math.abs(geometryOrigin.y),
        Math.abs(geometryOrigin.z),
      ) > 100_000) {
        console.info('IFC shared coordinates were rebased before rendering to preserve geometry precision.')
      }

      if (this.disposed) {
        throw new Error('Bộ đọc IFC đã được đóng.')
      }

      group.userData.modelKey = modelKey
      group.userData.modelId = modelID
      group.userData.fileName = file.name
      const loaded = { modelKey, modelId: modelID, fileName: file.name, group, elements }
      this.models.set(modelKey, { ...loaded, visible: true })
      onProgress({ message: 'Hoàn tất nạp mô hình.', progress: 100 })
      return loaded
    } catch (error) {
      group.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
      api.CloseModel(modelID)
      throw error
    }
  }
}
