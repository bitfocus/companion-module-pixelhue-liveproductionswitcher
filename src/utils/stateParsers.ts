import type { S16InputState, S16LayerState, S16PresetState } from '../interfaces/DeviceState.js'
import { getPresetName, getPresetPlayType, type Preset } from '../interfaces/Preset.js'
import { KEY_TYPE_BKGD, KEY_TYPE_DOWNSTREAM, KEY_TYPE_UPSTREAM } from './constants.js'
import { asRecord, coerceFiniteNumber, httpPageList, pickTrimmedString, wsPageList } from './recordCoerce.js'
import { formatInterfaceLabelFromPush, hasInterfaceSignal } from './sourceChoices.js'

/** Companion KEY 预设：上游 KEY (1024) + 下游 DSK (2048)。 */
export const COMPANION_KEY_LAYER_TYPES = new Set([KEY_TYPE_UPSTREAM, KEY_TYPE_DOWNSTREAM])
/** Key 列表展示：KEY + DSK。 */
export const COMPANION_KEY_LIST_LAYER_TYPES = new Set([KEY_TYPE_UPSTREAM, KEY_TYPE_DOWNSTREAM])

/** sceneType：无总线（查询用）。 */
export const LAYER_SCENE_NONE = 1
/** sceneType：PGM 总线。 */
export const LAYER_SCENE_PGM = 2
/** sceneType：PVW 总线。 */
export const LAYER_SCENE_PVW = 4
/** sceneType：PGM + PVW 双总线。 */
export const LAYER_SCENE_BOTH = 8
/** list-detail 查询 sceneType 参数（对齐 layeridprotometa / 液晶 layerlistbiz）。 */
export const LAYER_SCENE_QUERY_TYPES = [LAYER_SCENE_NONE, LAYER_SCENE_PGM, LAYER_SCENE_PVW, LAYER_SCENE_BOTH] as const

/**
 * 从 HTTP 或 WS 响应中提取 preset 列表项。
 * HTTP：`s_Response<s_PresetDetailPage>.data.list`；WS：`s_PresetDetailPage.list`。
 */
export function presetPayloadList(raw: unknown): unknown[] {
	const fromHttp = httpPageList(raw)
	if (fromHttp.length > 0) return fromHttp
	return wsPageList(raw)
}

/** 将协议中的 enable 字段（0/1/true/false）转为 boolean，无法识别时返回 undefined。 */
function enableFlag(value: unknown): boolean | undefined {
	if (typeof value === 'boolean') return value
	if (value === 1 || value === '1') return true
	if (value === 0 || value === '0') return false
	return undefined
}

/** KEY/DSK 显示名：仅使用接口 general.name / record.name。 */
function resolveKeyLayerDisplayName(
	_general: Record<string, unknown> | undefined,
	record: Record<string, unknown> | undefined,
): string {
	return pickTrimmedString(_general, ['name']) || pickTrimmedString(record, ['name']) || ''
}

function preferMergedLayerName(target: S16LayerState, item: S16LayerState): string {
	return target.name || item.name || ''
}

/** 将 layerIdObj.type 映射为 Companion 槽位种类 upstream / downstream / bkgd。 */
function keyLayerKind(type: number | undefined): 'upstream' | 'downstream' | 'bkgd' | undefined {
	if (type === KEY_TYPE_UPSTREAM) return 'upstream'
	if (type === KEY_TYPE_DOWNSTREAM) return 'downstream'
	if (type === KEY_TYPE_BKGD) return 'bkgd'
	return undefined
}

/** 从单条图层记录读取 layerIdObj.type 或顶层 type。 */
function layerTypeOf(raw: unknown): number | undefined {
	const record = asRecord(raw)
	const layerIdObj = asRecord(record?.layerIdObj)
	return coerceFiniteNumber(layerIdObj?.type) ?? coerceFiniteNumber(record?.type)
}

/** 判断是否为 Companion 管理的 KEY/DSK 图层（type 1024 或 2048）。 */
export function isCompanionKeyLayerRecord(raw: unknown): boolean {
	const type = layerTypeOf(raw)
	return type != null && COMPANION_KEY_LAYER_TYPES.has(type)
}

/** 判断是否为 Key 列表图层（KEY / DSK）。 */
export function isCompanionKeyListLayerRecord(raw: unknown): boolean {
	return isCompanionKeyLayerRecord(raw)
}

/** 生成 KEY/DSK 槽位键 `${type}:${keyIndex}`，用于合并同槽多总线记录。 */
export function keyLayerSlotKey(raw: unknown): string | null {
	const record = asRecord(raw)
	const layerIdObj = asRecord(record?.layerIdObj)
	const layerType = coerceFiniteNumber(layerIdObj?.type) ?? coerceFiniteNumber(record?.type)
	if (layerType === KEY_TYPE_BKGD) return `${KEY_TYPE_BKGD}:0`
	const keyIndex = coerceFiniteNumber(layerIdObj?.id)
	if (layerType == null || keyIndex == null) return null
	return `${layerType}:${keyIndex}`
}

/** 图层下拉框 / 变量定义的稳定键 — 仅在图层槽位变化时改变。 */
export function layerListKey(layers: S16LayerState[]): string {
	return layers.map((layer) => `${layer.id}:${layer.keyType ?? ''}:${layer.keyIndex ?? ''}`).join('|')
}

/** KEY/DSK/BKGD 排序权重：KEY → DSK → BKGD（末位）。 */
function keyLayerSortValue(layer: S16LayerState): number {
	if (layer.keyType === 'bkgd') return 200
	const typeOffset = layer.keyType === 'downstream' ? 100 : 0
	return typeOffset + (layer.keyIndex ?? Number.MAX_SAFE_INTEGER)
}

/**
 * 解析单条图层 detail / brief / WS 推送项为 S16LayerState。
 * 字段对齐液晶：layerId、layerIdObj、enable、general.name、source.general、transitionFollow、selected。
 */
export function parseLayerItem(raw: unknown, fallbackId?: string): S16LayerState {
	const record = asRecord(raw)
	const general = asRecord(record?.general)
	const sourceGeneral = asRecord(asRecord(record?.source)?.general)
	const transitionFollow = asRecord(record?.transitionFollow)
	const layerIdObj = asRecord(record?.layerIdObj)
	const layerType = coerceFiniteNumber(layerIdObj?.type) ?? coerceFiniteNumber(record?.type)
	const keyIndex = coerceFiniteNumber(layerIdObj?.id)
	const sceneType =
		coerceFiniteNumber(layerIdObj?.sceneType) ?? coerceFiniteNumber(record?.sceneType) ?? LAYER_SCENE_NONE
	const slotKey = keyLayerSlotKey(raw)
	const enable = enableFlag(record?.enable) ?? false
	const onPgmBus = sceneType === LAYER_SCENE_PGM || sceneType === LAYER_SCENE_BOTH
	const onPvwBus = sceneType === LAYER_SCENE_PVW || sceneType === LAYER_SCENE_BOTH
	const deviceLayerId = pickTrimmedString(record, ['layerId']) || pickTrimmedString(record, ['id'])
	const isBkgdKey = layerType === KEY_TYPE_BKGD
	const isKeyLayer = isCompanionKeyLayerRecord(raw) || isBkgdKey
	const id = isKeyLayer && slotKey ? slotKey : deviceLayerId || slotKey || fallbackId || ''
	const sourceLayerIds = deviceLayerId ? [deviceLayerId] : id ? [id] : []
	const transitionFromPvw = onPvwBus ? (enableFlag(transitionFollow?.enable) ?? false) : false

	return {
		id,
		name: resolveKeyLayerDisplayName(general, record),
		selected: enableFlag(record?.selected) ?? false,
		onAir: isBkgdKey ? false : onPgmBus && enable,
		preview: isBkgdKey ? false : onPvwBus && enable,
		// LCD：Next Trans 读 PVW 总线 layer brief 的 transitionFollow.enable
		transitionFollow: isBkgdKey ? transitionFromPvw : transitionFromPvw,
		sceneType,
		keyType: keyLayerKind(layerType),
		keyIndex,
		sourceLayerIds,
		sourceId: pickTrimmedString(sourceGeneral, ['sourceId']) || undefined,
		raw,
	}
}

/**
 * 合并同一 KEY/DSK 槽位在 PGM/PVW 上的两条记录（onAir/preview/TRANS 取或合并）。
 */
export function mergeKeyLayer(target: S16LayerState, item: S16LayerState): S16LayerState {
	if (target.keyType === 'bkgd' || item.keyType === 'bkgd') {
		const bkgd = target.keyType === 'bkgd' ? target : item
		const other = target.keyType === 'bkgd' ? item : target
		return {
			...bkgd,
			transitionFollow: bkgd.transitionFollow || other.transitionFollow,
			onAir: false,
			preview: false,
			sceneType: bkgd.sceneType ?? other.sceneType,
			sourceLayerIds: Array.from(new Set([...(bkgd.sourceLayerIds ?? []), ...(other.sourceLayerIds ?? [])])),
			sourceId: bkgd.sourceId ?? other.sourceId,
			raw: bkgd.raw ?? other.raw,
		}
	}

	const onAir = target.onAir || item.onAir
	const preview = target.preview || item.preview
	const sceneType =
		onAir && preview ? LAYER_SCENE_BOTH : onAir ? LAYER_SCENE_PGM : preview ? LAYER_SCENE_PVW : LAYER_SCENE_NONE
	return {
		...target,
		name: preferMergedLayerName(target, item),
		selected: target.selected || item.selected,
		onAir,
		preview,
		transitionFollow: target.transitionFollow || item.transitionFollow,
		sceneType,
		sourceLayerIds: Array.from(new Set([...(target.sourceLayerIds ?? []), ...(item.sourceLayerIds ?? [])])),
		sourceId: target.sourceId ?? item.sourceId,
		raw: target.raw ?? item.raw,
	}
}

/** 从已解析的 S16LayerState 反推槽位键 `${type}:${keyIndex}`。 */
export function layerSlotKeyFromState(layer: S16LayerState): string | null {
	if (layer.keyType === 'bkgd') return `${KEY_TYPE_BKGD}:0`
	if (layer.keyIndex == null) return null
	const type = layer.keyType === 'downstream' ? KEY_TYPE_DOWNSTREAM : KEY_TYPE_UPSTREAM
	return `${type}:${layer.keyIndex}`
}

/**
 * 将多条 list-detail 记录按槽位键合并为一条 KEY/DSK 图层状态。
 * 用于总线全量查询后写入 state.layers。
 */
export function buildMergedKeyLayerFromRecords(items: unknown[], slotKey: string): S16LayerState | null {
	let merged: S16LayerState | null = null
	for (const raw of items) {
		if (!isCompanionKeyListLayerRecord(raw)) continue
		if (keyLayerSlotKey(raw) !== slotKey) continue
		const item = parseLayerItem(raw)
		merged = merged ? mergeKeyLayer(merged, item) : item
	}
	return merged
}

/**
 * 解析 GET /unico/v1/layers/list-thumb 响应。
 * 保留 KEY + DSK；同槽位按 PGM/PVW 合并。
 */
export function parseLayerThumbs(rawResponse: unknown): S16LayerState[] {
	const grouped = new Map<string, S16LayerState>()
	const items = Array.isArray(rawResponse) ? rawResponse : httpPageList(rawResponse)
	for (const [index, raw] of items.filter(isCompanionKeyLayerRecord).entries()) {
		const slotKey = keyLayerSlotKey(raw)
		if (!slotKey) continue
		const item = parseLayerItem(raw, String(index + 1))
		const existing = grouped.get(slotKey)
		grouped.set(slotKey, existing ? mergeKeyLayer(existing, item) : item)
	}

	return Array.from(grouped.values()).sort((a, b) => keyLayerSortValue(a) - keyLayerSortValue(b))
}

/** 解析单条接口/输入源记录为 S16InputState（含信号、分辨率、显示名）。 */
export function parseInputItem(raw: unknown, fallbackId?: string): S16InputState {
	const record = asRecord(raw)
	return {
		id: pickTrimmedString(record, ['interfaceId', 'inputId', 'sourceId', 'id']) || fallbackId || '',
		name: formatInterfaceLabelFromPush(raw, fallbackId),
		hasSignal: hasInterfaceSignal(coerceFiniteNumber(record?.state)),
		resolution: pickTrimmedString(record, ['resolution', 'format']) || undefined,
		raw,
	}
}

/**
 * 解析接口列表响应为输入源数组。
 * HTTP：`s_InterfaceDetailPage.data.list`；WS：`s_InterfaceDetailArray`。
 */
export function parseInputs(rawResponse: unknown): S16InputState[] {
	const items = Array.isArray(rawResponse) ? rawResponse : httpPageList(rawResponse)
	return items.map((item, index) => parseInputItem(item, String(index + 1)))
}

/** 解析单条 preset 记录为 S16PresetState（名称、保存态、加载总线等）。 */
export function parsePresetItem(raw: unknown, fallbackId?: string): S16PresetState {
	const record = asRecord(raw)
	const preset = raw as Preset
	const general = asRecord(record?.general)
	const lastLoadedBus = pickTrimmedString(record, ['lastLoadedBus', 'targetBus']) as 'PVW' | 'PGM' | ''
	const presetId = preset.presetId
	const hasScenePayload = general != null || record?.screens != null || record?.audioSources != null
	return {
		id: presetId != null ? String(presetId) : fallbackId || '',
		name: getPresetName(preset) || pickTrimmedString(record, ['name', 'presetName']),
		presetId,
		playType: getPresetPlayType(preset),
		sortIndex: preset.presetIdObj?.id,
		saved: enableFlag(record?.saved) ?? (hasScenePayload || !(enableFlag(record?.empty) ?? false)),
		lastLoadedBus: lastLoadedBus || undefined,
		raw,
	}
}

/**
 * 从 FTB 相关 WS/HTTP payload 解析淡入黑场开关。
 * 支持嵌套 ftb.enable/status/on 或顶层 status/enable。
 */
export function parseFtbEnabled(raw: unknown): boolean | undefined {
	const fromFtb = (ftb: Record<string, unknown> | undefined): boolean | undefined => {
		if (!ftb) return undefined
		return enableFlag(ftb.enable) ?? enableFlag(ftb.status) ?? enableFlag(ftb.on)
	}

	if (Array.isArray(raw)) {
		for (const item of raw) {
			const enabled = fromFtb(asRecord(asRecord(item)?.ftb))
			if (enabled !== undefined) return enabled
		}
		return undefined
	}

	const record = asRecord(raw)
	if (!record) return undefined
	return fromFtb(asRecord(record.ftb)) ?? enableFlag(record.status) ?? enableFlag(record.enable)
}

/** 从响应根或 data 子对象读取指定 key 的 enable 布尔值。 */
function parseEnableFlag(raw: unknown, key: string): boolean | undefined {
	const root = asRecord(raw)
	const data = asRecord(root?.data) ?? root
	return enableFlag(data?.[key])
}

/**
 * 解析推流开关。
 * GET `/stream/detail` `s_PushStreamDetail` / WS `s_PushStreamStatus` → `streamEnable`。
 */
export function parseStreamEnable(raw: unknown): boolean | undefined {
	return parseEnableFlag(raw, 'streamEnable')
}

/**
 * 解析录制开关。
 * GET `/stream/record/info` `s_StoragePathDetail.enable` / WS `s_RecodeSwitchStatus.enable`。
 * 注意：POST 返回的 `data.status` 是结果码，不是开关态。
 */
export function parseRecordEnable(raw: unknown): boolean | undefined {
	return parseEnableFlag(raw, 'enable')
}

/** 将 preset 列表响应批量解析为 S16PresetState 数组。 */
export function parsePresets(rawResponse: unknown): S16PresetState[] {
	return presetPayloadList(rawResponse).map((item, index) => parsePresetItem(item, String(index + 1)))
}

/** 按 id 更新或插入列表项，存在则浅合并字段。 */
export function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
	const index = list.findIndex((existing) => existing.id === item.id)
	if (index === -1) return [...list, item]
	const next = [...list]
	next[index] = { ...next[index], ...item }
	return next
}
