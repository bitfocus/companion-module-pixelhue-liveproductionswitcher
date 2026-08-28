import type { Layer } from '../interfaces/Layer.js'
import type ModuleInstance from '../main.js'
import { FeedbackId } from './enum.js'
import { asRecordList } from './recordCoerce.js'
import { LAYER_SCENE_PGM, LAYER_SCENE_PVW } from './stateParsers.js'

/** LCD LayerType::Bkgd (1 << 13). */
export const BKGD_LAYER_TYPE = 8192

/** sourceType 0/1 = 空 / 无源。 */
const EMPTY_SOURCE_TYPES = new Set([0, 1])

export type BkgdBus = 'PGM' | 'PVW'

const BUS_TO_SCENE: Record<BkgdBus, number> = {
	PGM: LAYER_SCENE_PGM,
	PVW: LAYER_SCENE_PVW,
}

const BUS_TO_STATE_KEY: Record<BkgdBus, 'programSourceId' | 'previewSourceId'> = {
	PGM: 'programSourceId',
	PVW: 'previewSourceId',
}

type LooseLayer = Record<string, unknown>

function layerIdOf(raw: LooseLayer): number | undefined {
	const id = raw.layerId ?? raw.id
	return typeof id === 'number' ? id : undefined
}

function layerTypeOf(raw: Layer | LooseLayer): number | undefined {
	const record = raw as LooseLayer
	const obj = record.layerIdObj as { type?: number } | undefined
	const type = obj?.type ?? record.type
	return typeof type === 'number' ? type : undefined
}

function sceneTypeOf(self: ModuleInstance, raw: LooseLayer): number | undefined {
	const obj = raw.layerIdObj as { sceneType?: number } | undefined
	const fromPayload = obj?.sceneType ?? raw.sceneType
	if (typeof fromPayload === 'number') return fromPayload

	const layerId = layerIdOf(raw)
	if (layerId == null) return undefined
	return self.deviceLayers.find((layer) => layer.layerId === layerId)?.layerIdObj.sceneType
}

/** PGM 或 PVW 总线上的 BKGD 图层 — LCD 每个 sceneType 保留一个 BKGD 图层。 */
export function findBkgdDeviceLayer(self: ModuleInstance, bus: BkgdBus): Layer | undefined {
	const sceneType = BUS_TO_SCENE[bus]
	return self.deviceLayers.find(
		(layer) => layer.layerIdObj.type === BKGD_LAYER_TYPE && layer.layerIdObj.sceneType === sceneType,
	)
}

/** 来自 layer list-detail 或 PutLayersSource WS 载荷的输入源 id。 */
export function readLayerSourceId(layer: Layer | LooseLayer | undefined): string | undefined {
	if (!layer) return undefined

	const general = (layer as Layer).source?.general
	if (!general || general.sourceId == null) return undefined
	if (general.sourceType != null && EMPTY_SOURCE_TYPES.has(general.sourceType)) return undefined
	return general.sourceId > 0 ? String(general.sourceId) : undefined
}

/** 从 deviceLayers 中的 BKGD 图层同步 programSourceId / previewSourceId。 */
export function syncBkgdSourceIdsFromDeviceLayers(self: ModuleInstance): boolean {
	let changed = false
	for (const bus of ['PGM', 'PVW'] as const) {
		const sourceId = readLayerSourceId(findBkgdDeviceLayer(self, bus))
		if (!sourceId) continue
		const key = BUS_TO_STATE_KEY[bus]
		if (self.state[key] !== sourceId) {
			self.state[key] = sourceId
			changed = true
		}
	}
	return changed
}

function isBkgdPush(self: ModuleInstance, raw: LooseLayer): boolean {
	if (layerTypeOf(raw) === BKGD_LAYER_TYPE) return true
	const layerId = layerIdOf(raw)
	return (
		layerId != null &&
		self.deviceLayers.some((layer) => layer.layerId === layerId && layer.layerIdObj.type === BKGD_LAYER_TYPE)
	)
}

function updateBusSource(self: ModuleInstance, sceneType: number, sourceId: string): boolean {
	if (sceneType === LAYER_SCENE_PGM && self.state.programSourceId !== sourceId) {
		self.state.programSourceId = sourceId
		return true
	}
	if (sceneType === LAYER_SCENE_PVW && self.state.previewSourceId !== sourceId) {
		self.state.previewSourceId = sourceId
		return true
	}
	return false
}

function upsertDeviceLayer(self: ModuleInstance, raw: LooseLayer): void {
	const layerId = layerIdOf(raw)
	if (layerId == null) return

	const index = self.deviceLayers.findIndex((layer) => layer.layerId === layerId)
	if (index >= 0) {
		const prev = self.deviceLayers[index]
		self.deviceLayers[index] = {
			...prev,
			...raw,
			source: (raw.source as Layer['source']) ?? prev.source,
		}
		return
	}

	if (layerTypeOf(raw) === BKGD_LAYER_TYPE) {
		self.deviceLayers.push(raw as unknown as Layer)
	}
}

/** 从 PutLayersSource WS 载荷应用 BKGD 源。 */
export function applyBkgdSourceFromPush(self: ModuleInstance, data: unknown): boolean {
	// LCD decodeLayerSource：s_LayerSourceArray [{ layerId, source }]
	let changed = false

	for (const item of asRecordList(data)) {
		const raw = item as LooseLayer
		if (!isBkgdPush(self, raw)) continue

		const sourceId = readLayerSourceId(raw)
		const sceneType = sceneTypeOf(self, raw)
		if (sourceId && sceneType != null && updateBusSource(self, sceneType, sourceId)) {
			changed = true
		}
		upsertDeviceLayer(self, raw)
	}

	return changed
}

export const BKGD_SOURCE_FEEDBACK_IDS = [
	FeedbackId.BkgdPgmSourceStyle,
	FeedbackId.InputOnProgram,
	FeedbackId.BkgdPvwSourceStyle,
	FeedbackId.InputOnPreview,
] as const

export function bkgdSourceFeedbackIds(bus: BkgdBus): [FeedbackId, FeedbackId] {
	return bus === 'PGM'
		? [FeedbackId.BkgdPgmSourceStyle, FeedbackId.InputOnProgram]
		: [FeedbackId.BkgdPvwSourceStyle, FeedbackId.InputOnPreview]
}

/** 在 PGM 或 PVW 的 BKGD 图层上执行 PUT /layers/source。 */
export async function setBkgdSource(self: ModuleInstance, bus: BkgdBus, sourceId: string): Promise<void> {
	const bkgdLayer = findBkgdDeviceLayer(self, bus)
	if (!bkgdLayer) throw new Error(`BKGD ${bus} layer not found`)

	await self.apiClient!.setBkgdLayerSource(String(bkgdLayer.layerId), sourceId, self.deviceInterfaces, self)
	self.state[BUS_TO_STATE_KEY[bus]] = sourceId
}
