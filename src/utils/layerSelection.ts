/**
 * =============================================================================
 * layerSelection.ts — 图层选中态、设备同步、KEY Edit 按键样式
 * =============================================================================
 * 【两套状态，勿混用】
 * 1. state.layers — 图层业务字段（onAir / preview / transitionFollow / name …）
 * 2. layerControlSelection — 按键高亮专用（LayerControlStyle feedback 读这里）
 *    - selectId：Select 模式单选（仅 Companion 本地，不跟设备选中 WS）
 *    - pgmIds / pvwIds / nextTransIds：PGM / PVW / TRANS 模式多选 Set
 *
 * 【三种 Press Action 与数据来源】
 * | 模式           | 高亮依据                              | 是否查设备同步 |
 * |----------------|---------------------------------------|----------------|
 * | select         | selectId（Companion）                 | 否             |
 * | pgm            | pgmIds                                | 是（sceneType=2）|
 * | nextTransPvw   | 直控→pvwIds；跟切→nextTransIds        | 是             |
 */

import type { Layer } from '../interfaces/Layer.js'
import { readLayerSourceId } from './bkgdSource.js'
import { KEY_TYPE_UPSTREAM, KEY_TYPE_DOWNSTREAM, BUS_SYNC_DEBOUNCE_MS } from './constants.js'
import { createKeyedDebouncer } from './debounce.js'
import type { DropdownChoice } from '@companion-module/base'
import type ModuleInstance from '../main.js'
import type { S16LayerState } from '../interfaces/DeviceState.js'
import { FeedbackId } from './enum.js'
import type { LayerControlMode } from './layerSelectionStyles.js'
import { asRecordList, coerceFiniteNumber, coerceId, httpPageList } from './recordCoerce.js'
import {
	buildMergedKeyLayerFromRecords,
	isCompanionKeyLayerRecord,
	keyLayerSlotKey,
	LAYER_SCENE_BOTH,
	LAYER_SCENE_PGM,
	LAYER_SCENE_PVW,
	LAYER_SCENE_QUERY_TYPES,
	layerSlotKeyFromState,
	upsertById,
} from './stateParsers.js'

export {
	layerControlBg,
	layerControlModeLabel,
	layerControlButtonText,
	type LayerControlMode,
} from './layerSelectionStyles.js'

/** WS 总线同步防抖（PGM / PVW / TRANS 分 key） */
const busSyncDebouncer = createKeyedDebouncer<ModuleInstance>(BUS_SYNC_DEBOUNCE_MS)

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------
/**
 * Companion 按键高亮状态容器（main.ts layerControlSelection）。
 *
 * 使用场景：
 * - feedbacks LayerControlStyle 通过 isLayerControlSelected 读对应 Set/selectId
 * - 与 state.layers.onAir 等字段并行：多选模式以 Set 为准，避免单条 WS 映射错误
 */
export type LayerControlSelection = {
	/** Select 模式当前选中的 Companion 槽位 id（如 "1"） */
	selectId: string | null
	/** PGM/ON AIR 模式下亮绿灯的槽位 id 集合 */
	pgmIds: Set<string>
	/** TRANS 模式下亮绿灯的槽位 id 集合 */
	nextTransIds: Set<string>
	/** PVW 模式下亮绿灯的槽位 id 集合 */
	pvwIds: Set<string>
}

/**
 * 单个 Companion 槽位在设备上的 PGM/PVW layerId 及开关态缓存。
 * 存于 main.layerSceneDeviceInfo，发 HTTP 开关前用于取正确的设备 layerId。
 */
export type SceneLayerDeviceInfo = {
	pgmLayerId?: number
	pvwLayerId?: number
	pgmEnable?: boolean
	pvwEnable?: boolean
}

/**
 * 使用场景：ModuleInstance 构造时初始化 layerControlSelection。
 */
export function createLayerControlSelection(): LayerControlSelection {
	return {
		selectId: null,
		pgmIds: new Set<string>(),
		nextTransIds: new Set<string>(),
		pvwIds: new Set<string>(),
	}
}

// ---------------------------------------------------------------------------
// 设备图层模式（直控 / 跟切）
// ---------------------------------------------------------------------------

/** 切换器模式（直控）：NEXT TRANS/PVW 下发 PVW switch。 */
export const DEVICE_LAYER_MODE_SWITCHER = 0
/** 导播台模式（跟切）：NEXT TRANS/PVW 下发 transition-follow。 */
export const DEVICE_LAYER_MODE_DIRECTOR = 1

export function isDirectControlLayerMode(self: ModuleInstance): boolean {
	return self.deviceLayerMode === DEVICE_LAYER_MODE_SWITCHER
}

export function isFollowCutLayerMode(self: ModuleInstance): boolean {
	return self.deviceLayerMode === DEVICE_LAYER_MODE_DIRECTOR
}

/** GET /node/detail 或 WS s_DeviceLayerModeBody → mode 字段。 */
export function parseDeviceLayerMode(raw: unknown): number | undefined {
	const root = asRecord(raw)
	const data = asRecord(root?.data) ?? root
	const nested = asRecord(data?.deviceLayerMode)
	const mode = coerceFiniteNumber(nested?.mode) ?? coerceFiniteNumber(data?.mode)
	if (mode === DEVICE_LAYER_MODE_SWITCHER || mode === DEVICE_LAYER_MODE_DIRECTOR) return mode
	return undefined
}

export function applyDeviceLayerMode(self: ModuleInstance, mode: number | undefined): boolean {
	if (mode !== DEVICE_LAYER_MODE_SWITCHER && mode !== DEVICE_LAYER_MODE_DIRECTOR) return false
	if (self.deviceLayerMode === mode) return false
	self.deviceLayerMode = mode
	return true
}

/** WS / HTTP 更新 deviceLayerMode 后，刷新 NEXT TRANS/PVW 高亮与按键样式。 */
export function refreshUiAfterDeviceLayerModeChange(self: ModuleInstance): void {
	const needsNextTransPvwSync = [...self.layerControlModeByControlId.values()].some((mode) => mode === 'nextTransPvw')
	if (needsNextTransPvwSync) {
		void syncLayerControlSelectionFromDevice(self, 'nextTransPvw')
			.catch((err) => {
				self.log(
					'warn',
					`deviceLayerMode sync failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			})
			.finally(() => {
				self.checkFeedbacks(
					FeedbackId.LayerPreview,
					FeedbackId.LayerTransitionFollow,
					FeedbackId.LayerControlStyle,
				)
			})
		return
	}
	self.checkFeedbacks(FeedbackId.LayerControlStyle)
}

/** KEY 1 slot — used when no layer list is available yet. */
const DEFAULT_KEY_LAYER_SLOT_ID = `${KEY_TYPE_UPSTREAM}:0`

/**
 * Stable id for layer dropdowns / action options — never undefined.
 * Prefers state.layers.id, then slot key (1024:0), then key index.
 */
export function companionLayerChoiceId(layer: S16LayerState): string {
	const slot = layerSlotKeyFromState(layer)
	if (slot) return slot
	const id = layer.id?.trim()
	if (id) return id
	return String(layer.keyIndex ?? 0)
}

function keyLayerSlotsFromDeviceLayers(deviceLayers: Layer[]): Array<{ id: string; name: string }> {
	const slots = new Map<string, { type: number; index: number; name: string }>()
	for (const layer of deviceLayers) {
		const type = layer.layerIdObj?.type
		const index = layer.layerIdObj?.id
		if (type !== KEY_TYPE_UPSTREAM && type !== KEY_TYPE_DOWNSTREAM) continue
		if (index == null) continue
		const id = `${type}:${index}`
		if (!slots.has(id)) slots.set(id, { type, index, name: layer.general?.name?.trim() ?? '' })
	}
	return Array.from(slots.values())
		.sort((a, b) => {
			const typeOrder = (t: number) => (t === KEY_TYPE_UPSTREAM ? 0 : 100)
			return typeOrder(a.type) - typeOrder(b.type) || a.index - b.index
		})
		.map((slot) => ({ id: `${slot.type}:${slot.index}`, name: slot.name }))
}

function layerChoicesFromDeviceLayers(deviceLayers: Layer[]): DropdownChoice[] {
	return keyLayerSlotsFromDeviceLayers(deviceLayers).map((slot) => ({ id: slot.id, label: slot.name }))
}

function withKeyLayerNamesFromDevice(layers: S16LayerState[], deviceLayers: Layer[]): S16LayerState[] {
	const names = new Map(keyLayerSlotsFromDeviceLayers(deviceLayers).map((slot) => [slot.id, slot.name]))
	return layers.map((layer) => {
		const slotKey = layerSlotKeyFromState(layer)
		if (!slotKey) return layer
		return { ...layer, name: names.get(slotKey) ?? '' }
	})
}

/** Layers whose current source matches the given input interface id. */
export function layersUsingSource(self: ModuleInstance, sourceId: string): S16LayerState[] {
	const normalized = sourceId.trim()
	if (!normalized) return []
	return self.state.layers.filter((layer) => layer.keyType !== 'bkgd' && layer.sourceId === normalized)
}

/** Source list green: only the Companion Select-highlighted KEY/DSK layer. */
export function isInputUsedBySelectedLayer(self: ModuleInstance, inputId: string): boolean {
	const normalized = inputId.trim()
	if (!normalized) return false
	const layer = findStateLayer(self, selectedLayerChoiceId(self))
	if (!layer || layer.keyType === 'bkgd') return false
	return layer.sourceId === normalized
}

export type KeyLayerSourcePushResult = {
	/** Any KEY/DSK layer sourceId updated in state. */
	stateChanged: boolean
	/** Selected Companion layer's source changed (drives Source list green). */
	selectedSourceChanged: boolean
}

/** Layer currently highlighted by KEY Edit Select, or undefined when nothing is selected. */
export function selectedConcreteLayerId(self: ModuleInstance): string | undefined {
	const selectId = self.layerControlSelection.selectId?.trim()
	if (!selectId) return undefined
	const selected = findStateLayer(self, selectId)
	return selected ? companionLayerChoiceId(selected) : undefined
}

/** Device layer ids to PUT /layers/source — scoped to selected screens when multi-screen. */
export function deviceLayerIdsForSelectedScreens(self: ModuleInstance, stateLayer: S16LayerState): string[] {
	const deviceId = resolveDeviceLayerId(self, stateLayer.id)
	const candidates =
		stateLayer.sourceLayerIds && stateLayer.sourceLayerIds.length > 0
			? stateLayer.sourceLayerIds
			: deviceId != null
				? [String(deviceId)]
				: [stateLayer.id]

	const selectedScreenIds = new Set(
		self.screens.filter((screen) => screen.select === 1).map((screen) => screen.screenId),
	)
	if (selectedScreenIds.size === 0) return candidates

	const filtered = candidates.filter((id) => {
		const deviceLayer = self.deviceLayers.find((layer) => String(layer.layerId) === id)
		return deviceLayer != null && selectedScreenIds.has(deviceLayer.layerIdObj.attachScreenId)
	})
	return filtered.length > 0 ? filtered : candidates
}

function concreteLayerDropdownChoices(self: ModuleInstance): DropdownChoice[] {
	if (self.state.layers.length > 0) {
		return self.state.layers
			.filter((layer) => layer.keyType !== 'bkgd')
			.map((layer) => {
				const id = companionLayerChoiceId(layer)
				return { id, label: layer.name ?? '' }
			})
	}

	const fromDevice = layerChoicesFromDeviceLayers(self.deviceLayers)
	if (fromDevice.length > 0) return fromDevice

	return Array.from({ length: 8 }, (_, index): DropdownChoice => ({
		id: String(index + 1),
		label: '',
	}))
}

/** Layer dropdown for Set Source — KEY/DSK only。 */
export function layerSetSourceDropdownChoices(self: ModuleInstance): DropdownChoice[] {
	return concreteLayerDropdownChoices(self)
}

/** Layer dropdown for KEY Edit / toggles — KEY/DSK only。 */
export function layerDropdownChoices(self: ModuleInstance): DropdownChoice[] {
	return concreteLayerDropdownChoices(self)
}

/** Default for KEY Edit / Select / toggle layer option — first KEY/DSK. */
export function defaultConcreteLayerDropdownId(self: ModuleInstance): string {
	return (
		defaultKeyLayerChoiceId(self) ?? concreteLayerDropdownChoices(self)[0]?.id?.toString() ?? DEFAULT_KEY_LAYER_SLOT_ID
	)
}

/** Resolve action layer option to a concrete Companion layer id. */
export function resolveLayerIdForAction(self: ModuleInstance, layerIdOption: unknown): string {
	const pick =
		typeof layerIdOption === 'string'
			? layerIdOption.trim()
			: typeof layerIdOption === 'number'
				? String(layerIdOption)
				: ''
	if (!pick || pick === 'undefined') return selectedLayerChoiceId(self)
	return normalizeLayerChoiceId(self, pick)
}

/** Map legacy index / device id options to canonical slot id for dropdown match. */
export function normalizeLayerChoiceId(self: ModuleInstance, layerId: string): string {
	const direct = findStateLayer(self, layerId)
	if (direct) return companionLayerChoiceId(direct)
	const asNum = Number(layerId)
	if (Number.isFinite(asNum) && asNum > 0) {
		const byIndex = self.state.layers.find((layer) => layer.keyIndex === asNum - 1)
		if (byIndex) return companionLayerChoiceId(byIndex)
		const byOrder = self.state.layers[asNum - 1]
		if (byOrder) return companionLayerChoiceId(byOrder)
	}
	return layerId
}

export function findStateLayer(self: ModuleInstance, layerId: string): S16LayerState | undefined {
	return self.state.layers.find(
		(layer) =>
			companionLayerChoiceId(layer) === layerId || layer.id === layerId || layerMatchesSelection(layer, layerId),
	)
}

/** Prefer KEY1: first upstream KEY / first entry in sorted state.layers. */
export function defaultKeyLayerChoiceId(self: ModuleInstance): string | null {
	const first = self.state.layers[0]
	if (first) return companionLayerChoiceId(first)
	const deviceChoice = layerChoicesFromDeviceLayers(self.deviceLayers)[0]
	if (deviceChoice) return String(deviceChoice.id)
	return null
}

/**
 * Current Select highlight; if none, default to KEY1 and keep that selection.
 * Source cut must always target a selected layer.
 */
export function selectedLayerChoiceId(self: ModuleInstance): string {
	const selectId = self.layerControlSelection.selectId?.trim()
	if (selectId) {
		const matched = findStateLayer(self, selectId)
		if (matched) return companionLayerChoiceId(matched)
	}
	const fallback = defaultKeyLayerChoiceId(self) ?? DEFAULT_KEY_LAYER_SLOT_ID
	if (findStateLayer(self, fallback)) {
		applyLayerSelection(self, fallback)
	} else {
		self.layerControlSelection.selectId = fallback
	}
	return fallback
}

// ---------------------------------------------------------------------------
// 内部工具：协议字段解析、防抖
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function pickNumber(record: Record<string, unknown> | undefined, keys: string[]): number | undefined {
	if (!record) return undefined
	for (const key of keys) {
		const value = record[key]
		if (typeof value === 'number' && Number.isFinite(value)) return value
		if (typeof value === 'string' && value.trim() !== '') {
			const parsed = Number(value)
			if (Number.isFinite(parsed)) return parsed
		}
	}
	return undefined
}

/** 读 list-detail 行的 enable 字段（PGM/PVW 开关） */
function readEnable(raw: unknown): boolean {
	const record = asRecord(raw)
	return record?.enable === 1 || record?.enable === true
}

/** 读 PVW 总线 transitionFollow.enable（TRANS 状态，对齐液晶 brief） */
function readTransitionFollow(raw: unknown): boolean {
	const record = asRecord(raw)
	const tf = asRecord(record?.transitionFollow)
	if (tf?.enable === 1 || tf?.enable === true) return true
	return record?.transitionFollow === 1 || record?.transitionFollow === true
}

/** 调度总线全量同步（内部，见 schedulePgm/Pvw/NextTransBusSyncFromDevice） */
function scheduleBusSyncFromDevice(self: ModuleInstance, key: string, fn: () => void): void {
	busSyncDebouncer.schedule(self, key, fn)
}

// ---------------------------------------------------------------------------
// 图层 id 映射（设备全局 layerId ↔ Companion 槽位 id）
// ---------------------------------------------------------------------------

/**
 * 判断合并图层是否匹配某个 id（槽位 id 或 sourceLayerIds 中的设备 layerId）。
 *
 * 使用场景：syncSelectedLayerControlFromLayers、applyRefreshedLayer 保留选中态。
 */
export function layerMatchesSelection(layer: S16LayerState, selectedId: string): boolean {
	return layer.id === selectedId || (layer.sourceLayerIds?.includes(selectedId) ?? false)
}

/** Apply KEY layer source from PutLayersSource WS payload (nested source.general.sourceId). */
export function applyKeyLayerSourceFromPush(self: ModuleInstance, data: unknown): KeyLayerSourcePushResult {
	// LCD decodeLayerSource: s_LayerSourceArray [{ layerId, source }]
	const selectedId = self.layerControlSelection.selectId?.trim()
	let stateChanged = false
	let selectedSourceChanged = false

	for (const record of asRecordList(data)) {
		const deviceLayerId = coerceId(record.layerId ?? record.id)
		if (!deviceLayerId) continue

		const sourceId = readLayerSourceId(record)
		if (!sourceId) continue

		const companionId = resolveCompanionLayerId(self, deviceLayerId)
		if (!companionId) continue

		const existing = self.state.layers.find(
			(layer) => layer.id === companionId || layer.sourceLayerIds?.includes(deviceLayerId),
		)
		if (!existing || existing.sourceId === sourceId) continue

		self.state.layers = upsertById(self.state.layers, { ...existing, sourceId })
		stateChanged = true
		if (
			selectedId &&
			(existing.id === selectedId || layerMatchesSelection(existing, selectedId) || companionId === selectedId)
		) {
			selectedSourceChanged = true
		}
	}

	return { stateChanged, selectedSourceChanged }
}

/**
 * 设备全局 layerId → Companion 合并槽位 id（如 "1"）。
 *
 * 映射顺序：
 * 1. state.layers.id 或 sourceLayerIds 直接匹配
 * 2. deviceLayers.layerIdObj.type:id 匹配 keyType + keyIndex
 *
 * 使用场景：
 * - WS 推送只有 deviceLayerId 时定位 KEY 按键
 * - collectKeyLayerFlags 将总线查询结果写入对应槽位
 */
export function resolveCompanionLayerId(self: ModuleInstance, deviceLayerId: string): string | undefined {
	const byState = self.state.layers.find(
		(layer) => layer.id === deviceLayerId || layer.sourceLayerIds?.includes(deviceLayerId),
	)
	if (byState) return byState.id

	const deviceLayer = self.deviceLayers.find((layer) => String(layer.layerId) === deviceLayerId)
	if (!deviceLayer?.layerIdObj) return undefined

	const type = deviceLayer.layerIdObj.type
	const slotIndex = deviceLayer.layerIdObj.id
	if (type == null || slotIndex == null) return undefined

	const slotKey = `${type}:${slotIndex}`
	const keyType = type === KEY_TYPE_DOWNSTREAM ? KEY_TYPE_DOWNSTREAM : KEY_TYPE_UPSTREAM
	return self.state.layers.find((layer) => layer.keyIndex != null && `${keyType}:${layer.keyIndex}` === slotKey)?.id
}

/**
 * 映射失败时回退为原始 id（避免丢事件）。
 */
export function resolveStateLayerId(self: ModuleInstance, deviceLayerId: string): string {
	return resolveCompanionLayerId(self, deviceLayerId) ?? deviceLayerId
}

/**
 * 从 deviceLayers 缓存推断 WS 开关所属总线 sceneType。
 *
 * 使用场景：PutLayerSwitch 无 sceneType 时决定 schedule PGM 还是 PVW 总线同步。
 */
export function inferSceneTypeFromDeviceLayer(self: ModuleInstance, deviceLayerId: string): number {
	const deviceLayer = self.deviceLayers.find((layer) => String(layer.layerId) === deviceLayerId)
	return deviceLayer?.layerIdObj?.sceneType ?? 0
}

/**
 * WS 开关推送后更新 deviceLayers 本地 enable 缓存。
 *
 * 使用场景：PutLayerSwitch 在 schedule 全量查询前的即时缓存补丁。
 */
export function updateDeviceLayerEnableCache(self: ModuleInstance, deviceLayerId: string, enable: boolean): void {
	self.deviceLayers = self.deviceLayers.map((layer) =>
		String(layer.layerId) === deviceLayerId ? { ...layer, enable: enable ? 1 : 0 } : layer,
	)
}

/**
 * Companion 槽位 id → 设备数字 layerId（发 HTTP 用）。
 *
 * 使用场景：PGM/PVW/TRANS 等需要设备 layerId 的 HTTP 动作前解析 layerId。
 * 优先 sourceLayerIds，否则尝试把槽位 id 当数字解析。
 */
export function resolveDeviceLayerId(self: ModuleInstance, layerId: string): number | undefined {
	const stateLayer = self.state.layers.find((layer) => layer.id === layerId)
	const candidateIds = stateLayer?.sourceLayerIds ?? [layerId]
	for (const id of candidateIds) {
		const deviceLayer = self.deviceLayers.find((layer) => String(layer.layerId) === id)
		if (deviceLayer) return deviceLayer.layerId
	}
	const numeric = Number(layerId)
	return Number.isFinite(numeric) ? numeric : undefined
}

/** list-detail 单行记录 → Companion 槽位 id（内部，总线全量查询用） */
function companionIdFromDeviceRecord(self: ModuleInstance, raw: unknown): string | undefined {
	const record = asRecord(raw)
	const deviceLayerId = pickNumber(record, ['layerId'])
	if (deviceLayerId != null) {
		const byDevice = resolveCompanionLayerId(self, String(deviceLayerId))
		if (byDevice) return byDevice
	}
	const slotKey = keyLayerSlotKey(raw)
	if (!slotKey) return undefined
	return self.state.layers.find((item) => layerSlotKeyFromState(item) === slotKey)?.id
}

// ---------------------------------------------------------------------------
// 选中高亮：读取与写入
// ---------------------------------------------------------------------------

/** WS / HTTP 更新 TRANS 后刷新按键高亮（含 BKGD TRANS 预设）。 */
export function checkLayerTransitionFollowFeedbacks(self: ModuleInstance): void {
	self.checkFeedbacks(FeedbackId.LayerTransitionFollow, FeedbackId.LayerControlStyle)
}

function multiSelectSet(self: ModuleInstance, mode: LayerControlMode): Set<string> | null {
	switch (mode) {
		case 'pgm':
			return self.layerControlSelection.pgmIds
		case 'nextTransPvw':
			return isFollowCutLayerMode(self) ? self.layerControlSelection.nextTransIds : self.layerControlSelection.pvwIds
		default:
			return null
	}
}

/**
 * 判断某槽位在当前模式下是否应高亮。
 *
 * 使用场景：
 * - feedbacks LayerControlStyle / L ? self.layerControlSelection.nextTransIds  presets 生成时判断初始 bgcolor（select 模式）
 */
export function isLayerControlSelected(self: ModuleInstance, layerId: string, mode: LayerControlMode): boolean {
	if (mode === 'select') return self.layerControlSelection.selectId === layerId
	const set = multiSelectSet(self, mode)
	return set?.has(layerId) ?? false
}

/**
 * 更新某一 Press Action 模式的高亮。
 *
 * - select：单选，写 selectId + state.layers.selected + deviceLayers.selected
 * - pgm / nextTransPvw：多选 Set 增删成员（不直接改 state 开关字段，由总线 sync 负责）
 *
 * 使用场景：markLayerControlSelection 内部；一般由 applyLayerSelection 调用。
 */
export function markLayerControlSelection(
	self: ModuleInstance,
	layerId: string,
	mode: LayerControlMode,
	selected: boolean,
): void {
	const stateLayerId = resolveStateLayerId(self, layerId)

	if (mode === 'select') {
		self.layerControlSelection.selectId = selected ? stateLayerId : null
		self.state.layers = self.state.layers.map((layer) => ({
			...layer,
			selected: selected && (layer.id === stateLayerId || layerMatchesSelection(layer, layerId)),
		}))
		self.deviceLayers = self.deviceLayers.map((layer) => ({
			...layer,
			selected: selected && String(layer.layerId) === layerId ? 1 : 0,
		}))
	} else {
		const set = multiSelectSet(self, mode)
		if (!set) return
		if (selected) set.add(stateLayerId)
		else set.delete(stateLayerId)
	}

	self.checkFeedbacks(FeedbackId.LayerSelected, FeedbackId.LayerControlStyle)
	if (mode === 'select') {
		self.checkFeedbacks(FeedbackId.InputUsedByLayer)
		self.updateActions()
	}
}

/**
 * Select 模式：Companion 本地选中某一槽位。
 *
 * 使用场景：
 * - KEY Edit（Press Action = Select）本地高亮
 * - Set Layer Source 等依赖 Companion 当前选中槽位
 *
 * 注意：不下发 PUT /layers/select；设备液晶改选中不会通过 WS 改 Companion Select 高亮。
 */
export function applyLayerSelection(self: ModuleInstance, selectedId: string): void {
	markLayerControlSelection(self, selectedId, 'select', true)
}

/** 按 Companion selectId 写 state.layers[].selected（内部） */
function layersWithSelect(layers: S16LayerState[], selectId: string | null): S16LayerState[] {
	if (!selectId) return layers.map((layer) => ({ ...layer, selected: false }))
	return layers.map((layer) => ({
		...layer,
		selected: layer.id === selectId || layerMatchesSelection(layer, selectId),
	}))
}

/** Rebuild PGM/PVW/TRANS highlight Sets from state.layers flags (no HTTP). */
function syncLayerControlSetsFromStateLayers(self: ModuleInstance): void {
	const pgmIds = new Set<string>()
	const pvwIds = new Set<string>()
	const nextTransIds = new Set<string>()
	for (const layer of self.state.layers) {
		const id = companionLayerChoiceId(layer)
		if (layer.onAir) pgmIds.add(id)
		if (layer.preview) pvwIds.add(id)
		if (layer.transitionFollow) nextTransIds.add(id)
	}
	self.layerControlSelection.pgmIds = pgmIds
	self.layerControlSelection.pvwIds = pvwIds
	self.layerControlSelection.nextTransIds = nextTransIds
}

/**
 * 将 list-thumb 解析结果合并进 state.layers，并处理 Select / 多选高亮。
 *
 * 规则（Select 仅用 Companion 本地）：
 * - 保留仍在新列表中的 layerControlSelection.selectId
 * - 不读取设备返回的 layers[].selected
 * - 槽位从列表中消失则清空 selectId
 * - PGM/PVW/TRANS Sets 直接取自 thumb 里的 onAir / preview / transitionFollow
 * - 名称取自 list-detail（deviceLayers.general.name）
 *
 * 使用场景：
 * - main.refreshInitialSnapshot → getLayerThumbs 后
 * - main.applyLayerThumbFromDevice → getLayerThumbs 后
 * - WS PutLayerSelect / PutLayers 触发的 thumb 刷新链
 */
export function syncSelectedLayerControlFromLayers(self: ModuleInstance, layers: S16LayerState[]): void {
	const named = withKeyLayerNamesFromDevice(layers, self.deviceLayers)
	const preserved = self.layerControlSelection.selectId
	const preservedStillValid =
		preserved != null && named.some((layer) => layer.id === preserved || layerMatchesSelection(layer, preserved))

	// No selection → default KEY1 (first sorted KEY/DSK slot), so Source always has a target layer.
	const selectId = preservedStillValid ? preserved : named[0] ? companionLayerChoiceId(named[0]) : null
	const selectionChanged = selectId !== preserved
	self.layerControlSelection.selectId = selectId
	self.state.layers = layersWithSelect(named, selectId)
	syncLayerControlSetsFromStateLayers(self)
	if (selectionChanged) self.checkFeedbacks(FeedbackId.InputUsedByLayer)
}

/**
 * 用单条 state.layers 的开关字段，同步该槽位在三路多选 Set 中的成员关系。
 *
 * 使用场景：refreshKeyLayerFromDevice 单槽查询合并后，对齐 pgmIds/pvwIds/nextTransIds。
 * 仅改 Set，不发起 HTTP。
 */
export function syncLayerControlHighlightSetsFromLayer(self: ModuleInstance, layerId: string): void {
	const layer = self.state.layers.find((item) => item.id === layerId)
	if (!layer) return
	if (layer.onAir) self.layerControlSelection.pgmIds.add(layerId)
	else self.layerControlSelection.pgmIds.delete(layerId)
	if (layer.preview) self.layerControlSelection.pvwIds.add(layerId)
	else self.layerControlSelection.pvwIds.delete(layerId)
	if (layer.transitionFollow) self.layerControlSelection.nextTransIds.add(layerId)
	else self.layerControlSelection.nextTransIds.delete(layerId)
}

// ---------------------------------------------------------------------------
// PGM/PVW 设备 layerId 缓存（发 HTTP 前）
// ---------------------------------------------------------------------------

/**
 * 从 list-detail 多 sceneType 查询结果提取 pgmLayerId / pvwLayerId。
 *
 * 使用场景：refreshKeyLayerFromDevice 写入 layerSceneDeviceInfo。
 */
export function extractSceneLayerDeviceInfo(items: unknown[]): SceneLayerDeviceInfo {
	const info: SceneLayerDeviceInfo = {}
	for (const raw of items) {
		const record = asRecord(raw)
		const layerIdObj = asRecord(record?.layerIdObj)
		const sceneType = pickNumber(layerIdObj, ['sceneType']) ?? pickNumber(record, ['sceneType'])
		const layerId = pickNumber(record, ['layerId'])
		if (layerId == null || sceneType == null) continue
		const enable = record?.enable === 1 || record?.enable === true
		if (sceneType === LAYER_SCENE_PGM) {
			info.pgmLayerId = layerId
			info.pgmEnable = enable
		} else if (sceneType === LAYER_SCENE_PVW) {
			info.pvwLayerId = layerId
			info.pvwEnable = enable
		} else if (sceneType === LAYER_SCENE_BOTH) {
			info.pgmLayerId = layerId
			info.pvwLayerId = layerId
			info.pgmEnable = enable
			info.pvwEnable = enable
		}
	}
	return info
}

/**
 * 获取某槽位发 HTTP 用的 PGM/PVW layerId 与当前 enable。
 *
 * 使用场景：
 * - setLayerOnAir / setLayerPreview / setLayerTransitionFollow 发请求前
 * 优先读 layerSceneDeviceInfo 缓存，否则从 deviceLayers 推断。
 */
export function getSceneLayerDeviceInfo(self: ModuleInstance, layerId: string): SceneLayerDeviceInfo {
	const cached = self.layerSceneDeviceInfo.get(layerId)
	if (cached) return cached

	const stateLayer = self.state.layers.find((layer) => layer.id === layerId)
	if (!stateLayer) return {}

	const info: SceneLayerDeviceInfo = {}
	for (const deviceId of stateLayer.sourceLayerIds ?? [stateLayer.id]) {
		const deviceLayer = self.deviceLayers.find((layer) => String(layer.layerId) === deviceId)
		if (!deviceLayer) continue
		const raw = deviceLayer as unknown as Record<string, unknown>
		const layerIdObj = asRecord(raw.layerIdObj)
		const sceneType = pickNumber(layerIdObj, ['sceneType'])
		const numericId = pickNumber(raw, ['layerId'])
		if (numericId == null || sceneType == null) continue
		const enable = raw.enable === 1 || raw.enable === true
		if (sceneType === LAYER_SCENE_PGM) {
			info.pgmLayerId = numericId
			info.pgmEnable = enable
		} else if (sceneType === LAYER_SCENE_PVW) {
			info.pvwLayerId = numericId
			info.pvwEnable = enable
		}
	}

	if (info.pgmLayerId == null && stateLayer.onAir) info.pgmEnable = stateLayer.onAir
	if (info.pvwLayerId == null && stateLayer.preview) info.pvwEnable = stateLayer.preview
	return info
}

/** 单槽合并结果写回 state.layers，并尽量保留 Companion selectId（内部） */
function applyRefreshedLayer(
	self: ModuleInstance,
	layerId: string,
	refreshed: S16LayerState,
	preserveSelection: boolean,
): void {
	const preservedSelectId = self.layerControlSelection.selectId
	const selected =
		preserveSelection &&
		preservedSelectId != null &&
		(refreshed.id === preservedSelectId || layerMatchesSelection(refreshed, preservedSelectId))
	self.state.layers = self.state.layers.map((layer) => {
		if (layer.id !== layerId) return layer
		const merged: S16LayerState = {
			...refreshed,
			id: layer.id,
			selected: selected || refreshed.selected,
		}
		return withKeyLayerNamesFromDevice([merged], self.deviceLayers)[0] ?? merged
	})
}

// ---------------------------------------------------------------------------
// 单槽位深度查询（sceneType 1/2/4/8）
// ---------------------------------------------------------------------------

/**
 * 对单个 KEY/DSK 槽位按 sceneType 1/2/4/8 查询 list-detail 并合并。
 *
 * 使用场景：
 * - 用户按 KEY Edit 前刷新该槽位真实 PGM/PVW/TRANS 状态
 * - setLayerOnAir / setLayerPreview / setLayerTransitionFollow 发 HTTP 前
 *
 * 副作用：更新 layerSceneDeviceInfo、state.layers 一条、三路多选 Set、变量与 feedback。
 */
export async function refreshKeyLayerFromDevice(
	self: ModuleInstance,
	layerId: string,
): Promise<S16LayerState | undefined> {
	const stateLayer = self.state.layers.find((layer) => layer.id === layerId)
	if (!stateLayer || !self.apiClient) return stateLayer

	const slotKey = layerSlotKeyFromState(stateLayer)
	if (!slotKey) return stateLayer

	const type = stateLayer.keyType === 'downstream' ? KEY_TYPE_DOWNSTREAM : KEY_TYPE_UPSTREAM
	const id = stateLayer.keyIndex
	if (id == null) return stateLayer

	const collected: unknown[] = []
	for (const sceneType of LAYER_SCENE_QUERY_TYPES) {
		const response = await self.apiClient.getLayerDetails({ type, id, sceneType })
		collected.push(...httpPageList(response))
	}

	const refreshed = buildMergedKeyLayerFromRecords(collected, slotKey)
	if (!refreshed) return stateLayer

	self.layerSceneDeviceInfo.set(layerId, extractSceneLayerDeviceInfo(collected))
	applyRefreshedLayer(self, layerId, refreshed, true)
	syncLayerControlHighlightSetsFromLayer(self, layerId)
	self.updateVariableValues()
	self.checkFeedbacks(
		FeedbackId.LayerOnAir,
		FeedbackId.LayerPreview,
		FeedbackId.LayerTransitionFollow,
		FeedbackId.LayerControlStyle,
	)
	return self.state.layers.find((layer) => layer.id === layerId)
}

// ---------------------------------------------------------------------------
// 总线全量同步（PGM / PVW / TRANS）
// ---------------------------------------------------------------------------

/**
 * 按 sceneType 全量查 list-detail，收集每个 KEY/DSK 槽位的布尔标志（内部）。
 */
async function collectKeyLayerFlags(
	self: ModuleInstance,
	sceneType: number,
	readFlag: (raw: unknown) => boolean,
): Promise<Map<string, boolean>> {
	const flagsByCompanionId = new Map<string, boolean>()
	if (!self.apiClient) return flagsByCompanionId

	const response = await self.apiClient.getLayerDetails({ sceneType })
	for (const raw of httpPageList(response)) {
		if (!isCompanionKeyLayerRecord(raw)) continue
		const companionId = companionIdFromDeviceRecord(self, raw)
		if (!companionId) continue
		flagsByCompanionId.set(companionId, readFlag(raw))
	}
	return flagsByCompanionId
}

/** 从 Map 中提取值为 true 的槽位 id 集合（内部） */
function enabledIds(flags: Map<string, boolean>): Set<string> {
	return new Set([...flags.entries()].filter(([, on]) => on).map(([id]) => id))
}

/**
 * 全量同步 PGM 总线：重置 pgmIds 与 state.layers.onAir。
 *
 * 使用场景：
 * - syncLayerControlSelectionFromDevice('pgm')（切到 ON AIR/PGM Press Action）
 * - schedulePgmBusSyncFromDevice（WS PutLayerSwitch 防抖后）
 */
export async function syncPgmBusFromDevice(self: ModuleInstance): Promise<void> {
	const enableById = await collectKeyLayerFlags(self, LAYER_SCENE_PGM, readEnable)
	self.layerControlSelection.pgmIds = enabledIds(enableById)
	self.state.layers = self.state.layers.map((layer) => ({
		...layer,
		onAir: enableById.get(layer.id) ?? false,
	}))
	self.checkFeedbacks(FeedbackId.LayerOnAir, FeedbackId.LayerControlStyle)
}

/**
 * 全量同步 PVW 总线：重置 pvwIds 与 state.layers.preview。
 *
 * 使用场景：同 syncPgmBusFromDevice，对应 PVW 模式与 WS PVW 开关。
 */
export async function syncPvwBusFromDevice(self: ModuleInstance): Promise<void> {
	const enableById = await collectKeyLayerFlags(self, LAYER_SCENE_PVW, readEnable)
	self.layerControlSelection.pvwIds = enabledIds(enableById)
	self.state.layers = self.state.layers.map((layer) => ({
		...layer,
		preview: enableById.get(layer.id) ?? false,
	}))
	self.checkFeedbacks(FeedbackId.LayerPreview, FeedbackId.LayerControlStyle)
}

/**
 * 全量同步 TRANS：从 PVW 总线读 transitionFollow，重置 nextTransIds。
 *
 * 使用场景：
 * - setLayerTransitionFollow HTTP 成功后
 * - syncAll / syncLayerControlSelectionFromDevice('nextTrans')
 * - scheduleNextTransSyncFromDevice（WS 0x8112f 防抖后）
 */
export async function syncNextTransSelectionFromDevice(self: ModuleInstance): Promise<void> {
	const followById = await collectKeyLayerFlags(self, LAYER_SCENE_PVW, readTransitionFollow)
	self.layerControlSelection.nextTransIds = enabledIds(followById)
	self.state.layers = self.state.layers.map((layer) => {
		const choiceId = companionLayerChoiceId(layer)
		return {
			...layer,
			transitionFollow: followById.get(choiceId) ?? followById.get(layer.id) ?? false,
		}
	})
	checkLayerTransitionFollowFeedbacks(self)
}

/**
 * WS/本地即时更新单槽 TRANS 高亮（不查 HTTP）。
 *
 * 使用场景：PutLayerTransitionFollow 解析后立即刷新。
 */
export function applyLayerTransFollowFromDevice(
	self: ModuleInstance,
	deviceLayerId: string,
	enable: boolean,
	refreshFeedbacks = true,
): void {
	const stateLayerId = resolveCompanionLayerId(self, deviceLayerId)
	if (!stateLayerId) {
		self.log('debug', `[TRANS] unmapped deviceLayerId=${deviceLayerId}`)
		return
	}
	const layer = self.state.layers.find((item) => item.id === stateLayerId)
	if (!layer) {
		self.log('debug', `[TRANS] no state.layers id=${stateLayerId} deviceLayerId=${deviceLayerId}`)
		return
	}
	const highlightId = companionLayerChoiceId(layer)
	self.state.layers = self.state.layers.map((item) =>
		item.id === stateLayerId ? { ...item, transitionFollow: enable } : item,
	)
	if (enable) self.layerControlSelection.nextTransIds.add(highlightId)
	else self.layerControlSelection.nextTransIds.delete(highlightId)
	if (refreshFeedbacks) checkLayerTransitionFollowFeedbacks(self)
}

/**
 * 防抖调度 PGM 总线全量同步（200ms）。
 *
 * 使用场景：WebSocketHandling PutLayerSwitch 判定为 PGM 总线或 sceneType 未知。
 */
export function schedulePgmBusSyncFromDevice(self: ModuleInstance): void {
	scheduleBusSyncFromDevice(self, 'pgm', () => void syncPgmBusFromDevice(self))
}

/**
 * 防抖调度 PVW 总线全量同步（200ms）。
 *
 * 使用场景：WebSocketHandling PutLayerSwitch 判定为 PVW 总线或 sceneType 未知。
 */
export function schedulePvwBusSyncFromDevice(self: ModuleInstance): void {
	scheduleBusSyncFromDevice(self, 'pvw', () => void syncPvwBusFromDevice(self))
}

/**
 * 防抖调度 TRANS 全量同步（200ms）。
 *
 * 使用场景：WebSocketHandling PutLayerTransitionFollow 推送后 reconcile。
 */
export function scheduleNextTransSyncFromDevice(self: ModuleInstance): void {
	scheduleBusSyncFromDevice(self, 'nextTrans', () => void syncNextTransSelectionFromDevice(self))
}

/**
 * 切换 KEY Edit 的 Press Action 时，按模式从设备拉取对应高亮。
 *
 * 使用场景：actions LayerControl.subscribe（optionsToMonitorForSubscribe: mode）
 *
 * - select：仅刷新 feedback/preset，不查设备（Companion 本地 selectId）
 * - pgm：HTTP 全量查 PGM 总线并重写 Set
 * - nextTransPvw：直控查 PVW 总线；跟切查 transitionFollow
 */
export async function syncLayerControlSelectionFromDevice(self: ModuleInstance, mode: LayerControlMode): Promise<void> {
	if (!self.apiClient) return

	if (mode === 'select') {
		self.checkFeedbacks(FeedbackId.LayerSelected, FeedbackId.LayerControlStyle)
		return
	}

	if (mode === 'pgm') await syncPgmBusFromDevice(self)
	else if (mode === 'nextTransPvw') {
		if (isFollowCutLayerMode(self)) await syncNextTransSelectionFromDevice(self)
		else await syncPvwBusFromDevice(self)
	}

	self.checkFeedbacks(
		FeedbackId.LayerSelected,
		FeedbackId.LayerOnAir,
		FeedbackId.LayerPreview,
		FeedbackId.LayerTransitionFollow,
		FeedbackId.LayerControlStyle,
	)
}
