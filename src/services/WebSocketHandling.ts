import type ModuleInstance from '../main.js'
import type { WebsocketCallbackData } from '../interfaces/WebsocketCallbackData.js'
import { FeedbackId } from '../utils/enum.js'
import type { Preset } from '../interfaces/Preset.js'
import { presetStyleFeedbackId } from '../feedbacks.js'
import { logWsEvent } from '../utils/protocolLog.js'
import { filterValidPresets } from '../utils/utils.js'
import {
	asRecord,
	asRecordList,
	coerceEnable,
	coerceFiniteNumber,
	pickIdFromPayload,
	pickTrimmedString,
	wsPageList,
} from '../utils/recordCoerce.js'
import {
	parseInputs,
	parseLayerItem,
	parseFtbEnabled,
	parsePresets,
	parseRecordEnable,
	parseStreamEnable,
	upsertById,
	LAYER_SCENE_BOTH,
	LAYER_SCENE_PGM,
	LAYER_SCENE_PVW,
} from '../utils/stateParsers.js'
import { mergeInterfacesFromPush } from '../utils/sourceChoices.js'
import { applyBkgdSourceFromPush, BKGD_SOURCE_FEEDBACK_IDS } from '../utils/bkgdSource.js'
import {
	applyKeyLayerSourceFromPush,
	inferSceneTypeFromDeviceLayer,
	updateDeviceLayerEnableCache,
	applyLayerTransFollowFromDevice,
	checkLayerTransitionFollowFeedbacks,
	schedulePgmBusSyncFromDevice,
	schedulePvwBusSyncFromDevice,
	applyDeviceLayerMode,
	parseDeviceLayerMode,
	refreshUiAfterDeviceLayerModeChange,
} from '../utils/layerSelection.js'
import {
	applyOutputDisplayFromPush,
	applyOutputDisplayCatalogFromPush,
	applyOutputDisplayInfoFromInterfaces,
	applyInterfacePatchAndRefresh,
	inputSourceCatalogKey,
	interfaceCatalogKey,
	syncDeviceInterfaceList,
} from '../utils/outputSource.js'
import { parseActiveEffectType, parseSwitchEffect } from '../utils/transitionEffect.js'
import {
	TAG_NAMES,
	PutLayers,
	PutLayerSelect,
	PutLayersSource,
	PutLayersGeneral,
	PutLayerSwitch,
	PutLayerTransitionFollow,
	PutInterfaceDetail,
	PutInterfaceGeneral,
	PutInterfaceSetOutputDisplay,
	PutInterfaceOutputDisplay,
	GetInterfaceActualInfo,
	PutRecordEnable,
	PutStreamStatus,
	UnicoTagScreenFtb,
	UnicoTagScreenTake,
	PutSelectedScreenFtb,
	UnicoTagScreenCut,
	PutSwitchEffect,
	PutActiveEffectType,
	UnicoTagScreenTBar,
	GetPresetDetail,
	PutPresetCreate,
	PutPresetGeneral,
	DeletePreset,
	PutPresetPlay,
	PutNodeDeviceLayerMode,
} from '../utils/constants.js'

type Handler = (self: ModuleInstance, message: WebsocketCallbackData) => void

/** ucenter WebSocket TLV tag → 处理器；payload 结构对齐 LCD `lcdprotocolimpl`。 */
export const webSocketHandlers: Record<number, Handler> = {}

export function formatUnicoTag(tag: number): string {
	const hex = `0x${tag.toString(16).padStart(8, '0')}`
	const name = TAG_NAMES[tag]
	return name ? `${hex} ${name}` : hex
}

function on(tag: number, handler: Handler): void {
	webSocketHandlers[tag] = handler
}

function updatePresetDefinitions(self: ModuleInstance): void {
	self.updateVariableDefinitions()
	self.updateVariableValues()
	self.updateActions()
	self.updatePresets()
}

const INTERFACE_STATE_FEEDBACK_IDS = [
	FeedbackId.InputHasSignal,
	FeedbackId.BkgdPgmSourceStyle,
	FeedbackId.BkgdPvwSourceStyle,
	FeedbackId.OutputInterfaceStyle,
	FeedbackId.OutputSourceStyle,
] as const

function refreshInterfaceUi(self: ModuleInstance, variableDefinitions = false, rebuildPresets = false): void {
	if (variableDefinitions) self.updateVariableDefinitions()
	self.updateVariableValues()
	self.updateActions()
	self.checkFeedbacks(...INTERFACE_STATE_FEEDBACK_IDS)
	if (rebuildPresets) self.updatePresets()
}

function refreshInterfaceDynamicUi(self: ModuleInstance, updateActions = false): void {
	self.updateVariableValues()
	if (updateActions) self.updateActions()
	self.checkFeedbacks(...INTERFACE_STATE_FEEDBACK_IDS)
}

function applyBooleanState(
	self: ModuleInstance,
	value: boolean | undefined,
	getCurrent: () => boolean,
	apply: (value: boolean) => void,
	...feedbackIds: FeedbackId[]
): void {
	if (value === undefined || getCurrent() === value) return
	apply(value)
	self.updateVariableValues()
	for (const feedbackId of feedbackIds) {
		self.checkFeedbacks(feedbackId)
	}
}

function upsertDevicePreset(list: Preset[], preset: Preset): Preset[] {
	const id = String(preset.presetId)
	const index = list.findIndex((item) => String(item.presetId) === id)
	if (index === -1) return [...list, preset]
	const next = [...list]
	next[index] = { ...next[index], ...preset }
	return next
}

function updatePresetFromPush(self: ModuleInstance, message: WebsocketCallbackData): boolean {
	const rawPresets = filterValidPresets(wsPageList(message.data) as Preset[])
	const presets = parsePresets(message.data).filter((preset) => preset.id)

	for (const preset of rawPresets) {
		self.devicePresets = upsertDevicePreset(self.devicePresets, preset)
	}
	for (const preset of presets) {
		const existing = self.state.presets.find((item) => item.id === preset.id)
		self.state.presets = upsertById(self.state.presets, existing ? { ...existing, ...preset } : preset)
	}

	return rawPresets.length > 0 || presets.length > 0
}

function deletePresetFromPush(self: ModuleInstance, id: string): void {
	self.devicePresets = self.devicePresets.filter((preset) => String(preset.presetId) !== id)
	self.state.presets = self.state.presets.filter((preset) => preset.id !== id)
	updatePresetDefinitions(self)
}

function parseLayerSwitchPush(data: unknown): { layerId: string; enable: boolean; sceneType: number } | null {
	const record = asRecordList(data)[0]
	if (!record) return null
	const layerId = pickTrimmedString(record, ['layerId', 'id'])
	if (!layerId) return null
	const layerIdObj = asRecord(record.layerIdObj)
	const sceneType = coerceFiniteNumber(layerIdObj?.sceneType ?? record.sceneType) ?? 0
	return { layerId, enable: coerceEnable(record.enable), sceneType }
}

function parseLayerTransFollowPushes(data: unknown): Array<{ layerId: string; enable: boolean }> {
	const results: Array<{ layerId: string; enable: boolean }> = []
	for (const record of asRecordList(data)) {
		const layerId = pickTrimmedString(record, ['layerId', 'id'])
		if (!layerId) continue
		const transitionFollow = asRecord(record.transitionFollow)
		results.push({ layerId, enable: coerceEnable(transitionFollow?.enable ?? record.enable) })
	}
	return results
}

function scheduleBusSyncForSceneType(self: ModuleInstance, sceneType: number): void {
	if (!sceneType || sceneType === LAYER_SCENE_PGM || sceneType === LAYER_SCENE_BOTH) schedulePgmBusSyncFromDevice(self)
	if (!sceneType || sceneType === LAYER_SCENE_PVW || sceneType === LAYER_SCENE_BOTH) schedulePvwBusSyncFromDevice(self)
}

// 图层

on(PutLayers, (self) => {
	void self.refreshLayerThumbState()
	void self.refreshBkgdLayerSnapshot()
})

on(PutLayerSelect, (self) => {
	void self.refreshLayerThumbState()
})

on(PutLayerSwitch, (self, message) => {
	const push = parseLayerSwitchPush(message.data)
	if (!push) return
	updateDeviceLayerEnableCache(self, push.layerId, push.enable)
	const sceneType = push.sceneType || inferSceneTypeFromDeviceLayer(self, push.layerId)
	scheduleBusSyncForSceneType(self, sceneType)
})

on(PutLayerTransitionFollow, (self, message) => {
	const pushes = parseLayerTransFollowPushes(message.data)
	if (pushes.length === 0) return
	for (const push of pushes) {
		applyLayerTransFollowFromDevice(self, push.layerId, push.enable, false)
	}
	checkLayerTransitionFollowFeedbacks(self)
})

on(PutNodeDeviceLayerMode, (self, message) => {
	const mode = parseDeviceLayerMode(message.data)
	if (mode == null) return
	if (!applyDeviceLayerMode(self, mode)) return
	self.log('debug', `[WS] deviceLayerMode → ${mode === 0 ? 'switcher' : 'director'} (${mode})`)
	refreshUiAfterDeviceLayerModeChange(self)
})

on(PutLayersSource, (self, message) => {
	const bkgdChanged = applyBkgdSourceFromPush(self, message.data)
	const keyResult = applyKeyLayerSourceFromPush(self, message.data)

	if (bkgdChanged || keyResult.stateChanged) {
		if (bkgdChanged) self.checkFeedbacks(...BKGD_SOURCE_FEEDBACK_IDS)
		if (keyResult.selectedSourceChanged) self.checkFeedbacks(FeedbackId.InputUsedByLayer)
		self.updateVariableValues()
		return
	}

	void self.refreshBkgdLayerSnapshot()
})

on(PutLayersGeneral, (self, message) => {
	const item = parseLayerItem(message.data, pickIdFromPayload(message.data))
	if (!item.id) return
	const existing = self.state.layers.find((layer) => layer.id === item.id)
	self.state.layers = upsertById(self.state.layers, existing ? { ...existing, ...item } : item)
	self.updateVariableValues()
	self.updateActions()
	self.checkFeedbacks(FeedbackId.LayerControlStyle)
})

// 接口 / 输入源

on(PutInterfaceDetail, (self, message) => {
	const catalogBefore = interfaceCatalogKey(self)
	const merged = mergeInterfacesFromPush(self.deviceInterfaces, message.data)
	if (merged !== self.deviceInterfaces) {
		syncDeviceInterfaceList(self, merged)
	} else {
		for (const input of parseInputs(message.data)) {
			if (input.id) self.state.inputs = upsertById(self.state.inputs, input)
		}
	}
	refreshInterfaceUi(self, true, catalogBefore !== interfaceCatalogKey(self))
})

on(PutInterfaceSetOutputDisplay, (self, message) => {
	logWsEvent(self, formatUnicoTag(PutInterfaceSetOutputDisplay), message.data)
	const result = applyOutputDisplayFromPush(self, message.data)
	if (result.applied) {
		applyOutputDisplayInfoFromInterfaces(self)
		self.updateVariableValues()
		if (result.selectedInterfaceChanged) {
			self.checkFeedbacks(FeedbackId.OutputSourceStyle, FeedbackId.OutputInterfaceStyle)
		}
		return
	}
	self.log('warn', `[WS] ${formatUnicoTag(PutInterfaceSetOutputDisplay)} parse missed; refreshing via HTTP`)
	void self.refreshOutputDisplayLive()
})

on(PutInterfaceOutputDisplay, (self, message) => {
	logWsEvent(self, formatUnicoTag(PutInterfaceOutputDisplay), message.data)
	const inputCatalogBefore = inputSourceCatalogKey(self.state.outputDisplayGroups)
	if (!applyOutputDisplayCatalogFromPush(self, message.data)) return
	const inputCatalogChanged =
		inputCatalogBefore !== inputSourceCatalogKey(self.state.outputDisplayGroups)
	self.updateActions()
	self.updatePresets()
	self.updateVariableValues()
	self.checkFeedbacks(FeedbackId.OutputSourceStyle)
	if (inputCatalogChanged) {
		void self.refreshInterfacesFromDevice()
	}
})

on(GetInterfaceActualInfo, (self, message) => {
	if (!applyInterfacePatchAndRefresh(self, message.data)) return
	refreshInterfaceDynamicUi(self)
})

on(PutInterfaceGeneral, (self, message) => {
	if (!applyInterfacePatchAndRefresh(self, message.data)) return
	refreshInterfaceDynamicUi(self, true)
})

// 推流 / 录制

on(PutStreamStatus, (self, message) => {
	logWsEvent(self, formatUnicoTag(PutStreamStatus), message.data)
	applyBooleanState(
		self,
		parseStreamEnable(message.data),
		() => self.state.streaming,
		(value) => {
			self.state.streaming = value
		},
		FeedbackId.StreamingActive,
		FeedbackId.StreamingStyle,
	)
})

on(PutRecordEnable, (self, message) => {
	logWsEvent(self, formatUnicoTag(PutRecordEnable), message.data)
	applyBooleanState(
		self,
		parseRecordEnable(message.data),
		() => self.state.recording,
		(value) => {
			self.state.recording = value
		},
		FeedbackId.RecordingActive,
		FeedbackId.RecordingStyle,
	)
})

// FTB / 转场

const applyFtbState = (self: ModuleInstance, message: WebsocketCallbackData): void => {
	applyBooleanState(
		self,
		parseFtbEnabled(message.data),
		() => self.ftbEnabled,
		(value) => {
			self.ftbEnabled = value
		},
		FeedbackId.FtbActive,
	)
}

on(UnicoTagScreenFtb, applyFtbState)
on(PutSelectedScreenFtb, applyFtbState)

on(PutSwitchEffect, (self, message) => {
	// 仅参数推送：type 表示正在编辑的特效，非当前激活高亮项
	const timeMs = parseSwitchEffect(message.data).timeMs
	logWsEvent(self, formatUnicoTag(PutSwitchEffect), message.data, `time=${timeMs ?? '-'} (params only)`)
	if (timeMs != null && timeMs > 0) self.effectTime = timeMs
})

on(PutActiveEffectType, (self, message) => {
	const type = parseActiveEffectType(message.data)
	if (type == null) return
	self.applyActiveTransitionEffect(type)
})

on(UnicoTagScreenCut, (self) => {
	self.log('debug', '[S16] Screen CUT confirmed by device')
})

on(UnicoTagScreenTake, (self) => {
	self.log('debug', '[S16] Screen TAKE confirmed by device')
})

on(UnicoTagScreenTBar, (self) => {
	self.log('debug', '[S16] Screen TBAR position update received')
})

// 场景

on(GetPresetDetail, (self) => {
	void self.refreshPresetSnapshot('structure')
})

on(PutPresetCreate, (self, message) => {
	if (!updatePresetFromPush(self, message)) {
		self.log('warn', `[List] WS PutPresetCreate: no presetId in payload. raw=${JSON.stringify(message.data)}`)
	}
	void self.refreshPresetSnapshot('structure')
})

on(PutPresetGeneral, (self, message) => {
	const presetId = pickIdFromPayload(message.data)
	if (!updatePresetFromPush(self, message) && !presetId) return
	self.updateVariableValues()
	self.updateActions()
	self.checkFeedbacks(FeedbackId.PresetNameStyle, ...(presetId ? [presetStyleFeedbackId(presetId)] : []))
	void self.refreshPresetSnapshot('names')
})

on(DeletePreset, (self, message) => {
	const id = pickIdFromPayload(message.data)
	if (!id) {
		void self.refreshPresetSnapshot('structure')
		return
	}
	deletePresetFromPush(self, id)
	void self.refreshPresetSnapshot('structure')
})

on(PutPresetPlay, (self) => {
	void self.refreshPresetSnapshot('state')
})

export function dispatchDeviceEvent(self: ModuleInstance, message: WebsocketCallbackData): void {
	webSocketHandlers[message.tag]?.(self, message)
}
