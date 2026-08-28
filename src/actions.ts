import type ModuleInstance from './main.js'
import type { DropdownChoice } from '@companion-module/base'
import { ActionId, FeedbackId } from './utils/enum.js'
import { FTB_DEFAULT_TIME_MS } from './utils/constants.js'
import { SWITCH_EFFECT_CUT, TRANSITION_EFFECT_OPTIONS, transitionEffectTypeFromName } from './utils/transitionEffect.js'
import { parseRecordEnable } from './utils/stateParsers.js'
import { getPresetName, LoadIn, parsePresetChoiceId, toPresetChoiceId } from './interfaces/Preset.js'
import { changedPresetStyleFeedbackIds, sortPresets } from './utils/utils.js'
import { presetStyleFeedbackId } from './feedbacks.js'
import {
	resolveDeviceLayerId,
	applyLayerSelection,
	refreshKeyLayerFromDevice,
	getSceneLayerDeviceInfo,
	syncLayerControlSelectionFromDevice,
	syncNextTransSelectionFromDevice,
	layerDropdownChoices,
	layerSetSourceDropdownChoices,
	defaultConcreteLayerDropdownId,
	selectedConcreteLayerId,
	selectedLayerChoiceId,
	deviceLayerIdsForSelectedScreens,
	resolveLayerIdForAction,
	findStateLayer,
	companionLayerChoiceId,
	normalizeLayerChoiceId,
	isFollowCutLayerMode,
} from './utils/layerSelection.js'
import { normalizeLayerControlMode, type LayerControlMode } from './utils/layerSelectionStyles.js'
import { sourceChoicesFromInterfaces, bkgdSourceChoicesFromInterfaces } from './utils/sourceChoices.js'
import {
	allOutputSourcesFlat,
	canRouteOutputSourceToSelected,
	parseOutputSourceKey,
	selectedOutputInterface,
} from './utils/outputSource.js'
import { bkgdSourceFeedbackIds, setBkgdSource } from './utils/bkgdSource.js'
import { asRecord } from './utils/recordCoerce.js'

function transitionEffectChoices(): DropdownChoice[] {
	return TRANSITION_EFFECT_OPTIONS.map((item) => ({ id: item.id, label: item.label }))
}

function resolveToggleEnableDisable(current: boolean, optionEnable: unknown): boolean {
	if (optionEnable === 1 || optionEnable === '1') return true
	if (optionEnable === 0 || optionEnable === '0') return false
	return !current
}

function presetLoadBusFromOption(loadin: unknown): 'PVW' | 'PGM' {
	return loadin === 'PGM' ? 'PGM' : 'PVW'
}

function refreshPresetStyleForLoadAction(
	self: ModuleInstance,
	action: { controlId: string; options: Record<string, unknown> },
): void {
	const presetId = parsePresetChoiceId(optionToString(action.options.presetId, defaultPresetChoiceId(self)))
	if (presetId) {
		self.checkFeedbacks(presetStyleFeedbackId(presetId))
	}
}

function toggleEnableDisableOptions(label: string) {
	return [
		{
			type: 'dropdown' as const,
			id: 'enable',
			label,
			default: -1,
			choices: [
				{ id: -1, label: 'Toggle' },
				{ id: 1, label: 'Enable' },
				{ id: 0, label: 'Disable' },
			],
		},
	]
}

function optionToString(value: unknown, fallback = ''): string {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	return fallback
}
async function runHttpAction(self: ModuleInstance, label: string, fn: () => Promise<unknown>): Promise<void> {
	try {
		await fn()
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error)
		self.log('error', `${label} failed: ${message}`)
	}
}

function isUnicoOk(response: unknown): boolean {
	const code = asRecord(response)?.code
	return code === 0 || code === '0'
}

function unicoErrorDetail(response: unknown): string {
	const rec = asRecord(response)
	const code = rec?.code
	const message = typeof rec?.message === 'string' ? rec.message.trim() : ''
	return `code=${String(code)} ${message || 'unknown device error'}`
}

function layerChoices(self: ModuleInstance): DropdownChoice[] {
	return layerDropdownChoices(self)
}

function layerSetSourceChoices(self: ModuleInstance): DropdownChoice[] {
	return layerSetSourceDropdownChoices(self)
}

function layerControlModeChoices(): DropdownChoice[] {
	return [
		{ id: 'select', label: 'Select' },
		{ id: 'pgm', label: 'ON AIR/PGM' },
		{ id: 'nextTransPvw', label: 'NEXT TRANS/PVW' },
	]
}

/** KEY Edit / Select / toggle — concrete layers only; no allowCustom so Companion shows labels. */
function layerSelectOption(self: ModuleInstance) {
	return {
		type: 'dropdown' as const,
		id: 'layerId',
		label: 'Layer',
		default: defaultConcreteLayerDropdownId(self),
		choices: layerChoices(self),
	}
}

function inputChoices(self: ModuleInstance): DropdownChoice[] {
	if (self.deviceInterfaces.length > 0) {
		return sourceChoicesFromInterfaces(self.deviceInterfaces)
	}
	if (self.state.inputs.length > 0) {
		return self.state.inputs.map((input) => ({
			id: input.id,
			label: input.name || `Input ${input.id}`,
		}))
	}
	return Array.from({ length: 16 }, (_, index): DropdownChoice => ({
		id: String(index + 1),
		label: `Input ${index + 1}`,
	}))
}

function outputSourceChoices(self: ModuleInstance): DropdownChoice[] {
	return allOutputSourcesFlat(self).map((source) => ({
		id: source.id,
		label: source.name,
	}))
}

function defaultOutputSourceKey(self: ModuleInstance): string {
	return outputSourceChoices(self)[0]?.id?.toString() ?? '1:1'
}

function outputInterfaceChoices(self: ModuleInstance): DropdownChoice[] {
	return self.state.outputs.map((output) => ({ id: output.id, label: output.name }))
}

function defaultOutputInterfaceId(self: ModuleInstance): string {
	return self.state.selectedOutputInterfaceId || outputInterfaceChoices(self)[0]?.id?.toString() || '1'
}

function bkgdInputChoices(self: ModuleInstance): DropdownChoice[] {
	if (self.deviceInterfaces.length > 0) {
		return bkgdSourceChoicesFromInterfaces(self.deviceInterfaces)
	}
	return inputChoices(self)
}

function defaultBkgdInputId(self: ModuleInstance): string {
	return bkgdInputChoices(self)[0]?.id?.toString() ?? '1'
}

function defaultInputId(self: ModuleInstance): string {
	return inputChoices(self)[0]?.id?.toString() ?? '1'
}

function layerControlMode(value: unknown): LayerControlMode {
	return normalizeLayerControlMode(value)
}

function presetChoices(self: ModuleInstance): DropdownChoice[] {
	if (self.devicePresets.length > 0) {
		return sortPresets(self.devicePresets).map((preset) => ({
			id: toPresetChoiceId(preset.presetId!),
			label: getPresetName(preset) || `Scene ${preset.presetId}`,
		}))
	}
	return Array.from({ length: 8 }, (_, index): DropdownChoice => ({
		id: toPresetChoiceId(index + 1),
		label: `Scene ${index + 1}`,
	}))
}

function defaultPresetChoiceId(self: ModuleInstance): string {
	const first = sortPresets(self.devicePresets)[0]
	return first?.presetId != null ? toPresetChoiceId(first.presetId) : toPresetChoiceId(1)
}

function ftbTimeMs(self: ModuleInstance): number {
	const screen = self.screens.find((s) => s.select === 1)
	const time = screen?.ftb?.time
	if (typeof time === 'number' && Number.isFinite(time) && time > 0) return time
	return FTB_DEFAULT_TIME_MS
}

/**
 * LCD CUT/TAKE path: refresh list-detail, then only screens with select==1.
 * Empty selection → do not send (LCD returns without HTTP).
 */
async function selectedScreensForCutTake(self: ModuleInstance) {
	const client = self.apiClient
	if (!client) return []
	try {
		const response = await client.getScreens()
		self.screens = response.data.list
	} catch (err) {
		self.log('warn', `Screen list-detail refresh failed: ${err instanceof Error ? err.message : err}`)
	}
	return self.screens.filter((screen) => screen.select === 1)
}

async function applyCut(self: ModuleInstance): Promise<void> {
	const screens = await selectedScreensForCutTake(self)
	if (screens.length === 0) {
		self.log('warn', 'CUT skipped: no selected screens (select==1)')
		return
	}
	await runHttpAction(self, 'CUT', async () => self.apiClient!.cut(screens, 0, self))
}

async function applyTake(self: ModuleInstance): Promise<void> {
	if (self.activeTransitionEffectType === SWITCH_EFFECT_CUT) {
		await applyCut(self)
		return
	}
	const screens = await selectedScreensForCutTake(self)
	if (screens.length === 0) {
		self.log('warn', 'AUTO skipped: no selected screens (select==1)')
		return
	}
	await runHttpAction(self, 'AUTO', async () => self.apiClient!.take(screens, self.effectTime, self))
}

async function applyTransitionEffect(self: ModuleInstance, effectName: string): Promise<void> {
	const type = transitionEffectTypeFromName(effectName)
	await runHttpAction(self, `Set Active Effect ${effectName}`, async () =>
		self.apiClient!.setActiveEffectType(type, self),
	)
	self.applyActiveTransitionEffect(type)
}

async function applyFtb(self: ModuleInstance, enable: boolean): Promise<void> {
	const time = ftbTimeMs(self)
	const label = enable ? 'FTB' : 'unFTB'
	await runHttpAction(self, label, async () => {
		await self.apiClient!.ftbSelected(enable, time, self)
	})
	self.ftbEnabled = enable
	self.updateVariableValues()
	self.checkFeedbacks(FeedbackId.FtbActive)
}

async function selectLayer(self: ModuleInstance, layerId: string): Promise<void> {
	await refreshKeyLayerFromDevice(self, layerId)
	applyLayerSelection(self, layerId)
}

async function setLayerOnAir(self: ModuleInstance, layerId: string, status?: boolean): Promise<void> {
	await refreshKeyLayerFromDevice(self, layerId)
	const info = getSceneLayerDeviceInfo(self, layerId)
	const pgmLayerId = info.pgmLayerId ?? resolveDeviceLayerId(self, layerId)
	if (pgmLayerId == null) return

	const nextEnable = status !== undefined ? status : !(info.pgmEnable ?? false)
	await runHttpAction(self, 'Layer On Air', async () => {
		await self.apiClient!.setLayerSwitch(pgmLayerId, nextEnable, self)
	})
	await refreshKeyLayerFromDevice(self, layerId)
	self.updateVariableValues()
	self.checkFeedbacks(
		FeedbackId.LayerOnAir,
		FeedbackId.LayerPreview,
		FeedbackId.LayerTransitionFollow,
		FeedbackId.LayerControlStyle,
	)
	self.updatePresets()
}

async function setLayerPreview(self: ModuleInstance, layerId: string, status?: boolean): Promise<void> {
	await refreshKeyLayerFromDevice(self, layerId)
	const info = getSceneLayerDeviceInfo(self, layerId)
	const pvwLayerId = info.pvwLayerId ?? resolveDeviceLayerId(self, layerId)
	if (pvwLayerId == null) return

	const nextEnable = status !== undefined ? status : !(info.pvwEnable ?? false)
	await runHttpAction(self, 'Layer Preview', async () => {
		await self.apiClient!.setLayerSwitch(pvwLayerId, nextEnable, self)
	})
	await refreshKeyLayerFromDevice(self, layerId)
	self.updateVariableValues()
	self.checkFeedbacks(
		FeedbackId.LayerOnAir,
		FeedbackId.LayerPreview,
		FeedbackId.LayerTransitionFollow,
		FeedbackId.LayerControlStyle,
	)
	self.updatePresets()
}

async function setLayerTransitionFollow(self: ModuleInstance, layerId: string, follow?: boolean): Promise<void> {
	await refreshKeyLayerFromDevice(self, layerId)
	const info = getSceneLayerDeviceInfo(self, layerId)
	const layer = self.state.layers.find((item) => item.id === layerId)
	const nextFollow = follow !== undefined ? follow : !layer?.transitionFollow
	const deviceLayerId = info.pvwLayerId ?? resolveDeviceLayerId(self, layerId)
	if (deviceLayerId == null) return

	await runHttpAction(self, 'Layer Transition Follow', async () =>
		self.apiClient!.setLayerTransitionFollow(deviceLayerId, nextFollow),
	)
	await syncNextTransSelectionFromDevice(self)
	self.updateVariableValues()
	self.checkFeedbacks(
		FeedbackId.LayerOnAir,
		FeedbackId.LayerPreview,
		FeedbackId.LayerTransitionFollow,
		FeedbackId.LayerControlStyle,
	)
}

async function setLayerNextTransPvw(self: ModuleInstance, layerId: string): Promise<void> {
	if (isFollowCutLayerMode(self)) {
		await setLayerTransitionFollow(self, layerId)
		return
	}
	await setLayerPreview(self, layerId)
}

function findPreset(self: ModuleInstance, presetId: string) {
	const normalized = parsePresetChoiceId(presetId)
	return self.devicePresets.find(
		(preset) => String(preset.presetId) === normalized || getPresetName(preset) === normalized,
	)
}

export function updateCompanionActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		[ActionId.Cut]: {
			name: 'CUT',
			description: 'Instant cut PVW to PGM on selected screen.',
			options: [],
			callback: async () => {
				await applyCut(self)
			},
		},
		[ActionId.Take]: {
			name: 'AUTO',
			description: 'Fade PVW to PGM on selected screen (device default 500ms FADE).',
			options: [],
			callback: async () => {
				await applyTake(self)
			},
		},
		[ActionId.Ftb]: {
			name: 'FTB',
			description: 'Fade selected screen(s) to black (FTB) or restore picture (unFTB).',
			options: toggleEnableDisableOptions('FTB'),
			callback: async (event) => {
				const enable = resolveToggleEnableDisable(self.ftbEnabled, event.options.enable)
				await applyFtb(self, enable)
			},
		},
		[ActionId.SetTransitionMix]: {
			name: 'MIX',
			description: 'Select MIX as active TAKE transition effect.',
			options: [],
			callback: async () => {
				await applyTransitionEffect(self, 'MIX')
			},
		},
		[ActionId.SetTransitionWipe]: {
			name: 'WIPE',
			description: 'Select WIPE as active TAKE transition effect.',
			options: [],
			callback: async () => {
				await applyTransitionEffect(self, 'WIPE')
			},
		},
		[ActionId.SetTransitionDve]: {
			name: 'DVE',
			description: 'Select DVE as active TAKE transition effect.',
			options: [],
			callback: async () => {
				await applyTransitionEffect(self, 'DVE')
			},
		},
		[ActionId.SetTransitionDip]: {
			name: 'DIP',
			description: 'Select DIP as active TAKE transition effect.',
			options: [],
			callback: async () => {
				await applyTransitionEffect(self, 'DIP')
			},
		},
		[ActionId.SetTransitionEffect]: {
			name: 'Set Transition Effect',
			description: 'Select active TAKE transition effect (MIX / WIPE / DVE / DIP).',
			options: [
				{
					type: 'dropdown',
					id: 'effect',
					label: 'Effect',
					default: 'MIX',
					choices: transitionEffectChoices(),
				},
			],
			callback: async (event) => {
				const effect = optionToString(event.options.effect, 'MIX')
				await applyTransitionEffect(self, effect)
			},
		},
		[ActionId.SetProgramSource]: {
			name: 'Set BKGD-PGM Source',
			description: 'Set input source on BKGD PGM layer.',
			options: [
				{
					type: 'dropdown',
					id: 'sourceId',
					label: 'Source',
					default: defaultBkgdInputId(self),
					choices: bkgdInputChoices(self),
				},
			],
			callback: async (event) => {
				const sourceId = optionToString(event.options.sourceId)
				if (!sourceId) return
				await runHttpAction(self, 'Set BKGD-PGM Source', async () => setBkgdSource(self, 'PGM', sourceId))
				self.checkFeedbacks(...bkgdSourceFeedbackIds('PGM'))
				self.updatePresets()
			},
		},
		[ActionId.SetPreviewSource]: {
			name: 'Set BKGD-PVW Source',
			description: 'Set input source on BKGD PVW layer.',
			options: [
				{
					type: 'dropdown',
					id: 'sourceId',
					label: 'Source',
					default: defaultBkgdInputId(self),
					choices: bkgdInputChoices(self),
				},
			],
			callback: async (event) => {
				const sourceId = optionToString(event.options.sourceId)
				if (!sourceId) return
				await runHttpAction(self, 'Set BKGD-PVW Source', async () => setBkgdSource(self, 'PVW', sourceId))
				self.checkFeedbacks(...bkgdSourceFeedbackIds('PVW'))
				self.updatePresets()
			},
		},
		[ActionId.LayerControl]: {
			name: 'KEY Edit',
			description:
				'KEY/DSK layer control: Select (local highlight), ON AIR/PGM toggle, or NEXT TRANS/PVW (PVW switch in switcher mode, transition-follow in director mode).',
			optionsToMonitorForSubscribe: ['mode', 'layerId'],
			skipUnsubscribeOnOptionsChange: true,
			subscribe: (action) => {
				const mode = layerControlMode(action.options.mode)
				self.layerControlModeByControlId.set(action.controlId, mode)
				void syncLayerControlSelectionFromDevice(self, mode)
					.catch((err) => {
						self.log('warn', `KEY Edit selection sync failed: ${err instanceof Error ? err.message : String(err)}`)
					})
					.finally(() => {
						self.checkFeedbacks(FeedbackId.LayerControlStyle)
					})
			},
			unsubscribe: (action) => {
				self.layerControlModeByControlId.delete(action.controlId)
				self.checkFeedbacks(FeedbackId.LayerControlStyle)
			},
			options: [
				layerSelectOption(self),
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Press Action',
					default: 'select',
					choices: layerControlModeChoices(),
				},
			],
			callback: async (event) => {
				const layerId = normalizeLayerChoiceId(self, resolveLayerIdForAction(self, event.options.layerId))
				if (!layerId) return

				switch (layerControlMode(event.options.mode)) {
					case 'pgm':
						await setLayerOnAir(self, layerId)
						break
					case 'nextTransPvw':
						await setLayerNextTransPvw(self, layerId)
						break
					case 'select':
						await selectLayer(self, layerId)
						break
				}
			},
		},
		[ActionId.SetLayerSource]: {
			name: 'Set Input on Layer',
			options: [
				{
					type: 'dropdown',
					id: 'sourceId',
					label: 'Input',
					default: defaultInputId(self),
					choices: inputChoices(self),
				},
				{
					type: 'checkbox',
					id: 'useSelectedLayer',
					label: 'Use global selected layer',
					default: true,
					disableAutoExpression: true,
				},
				{
					type: 'dropdown',
					id: 'layerId',
					label: 'Layer',
					default: defaultConcreteLayerDropdownId(self),
					choices: layerSetSourceChoices(self),
					isVisibleExpression: '!$(options:useSelectedLayer)',
				},
			],
			learn: async () => {
				const layerId = selectedConcreteLayerId(self)
				return layerId ? { useSelectedLayer: false, layerId } : { useSelectedLayer: true }
			},
			callback: async (event) => {
				const layerId = event.options.useSelectedLayer
					? selectedLayerChoiceId(self)
					: resolveLayerIdForAction(self, event.options.layerId)
				const sourceId = optionToString(event.options.sourceId)
				if (!layerId || !sourceId) return
				const selectedLayer = findStateLayer(self, layerId)
				const sourceLayerIds = selectedLayer ? deviceLayerIdsForSelectedScreens(self, selectedLayer) : [layerId]
				await runHttpAction(self, 'Set Layer Source', async () =>
					self.apiClient!.setLayerSource(layerId, sourceId, self.deviceLayers, self.deviceInterfaces, sourceLayerIds),
				)
				if (selectedLayer) {
					const stateId = companionLayerChoiceId(selectedLayer)
					self.state.layers = self.state.layers.map((layer) =>
						companionLayerChoiceId(layer) === stateId ? { ...layer, sourceId } : layer,
					)
				}
				self.updateVariableValues()
				if (layerId === selectedLayerChoiceId(self)) {
					self.checkFeedbacks(FeedbackId.InputUsedByLayer)
				}
				self.updateActions()
			},
		},
		[ActionId.LoadPreset]: {
			name: 'Load Preset',
			description: 'Load a scene preset to PVW or PGM.',
			optionsToMonitorForSubscribe: ['loadin'],
			skipUnsubscribeOnOptionsChange: true,
			subscribe: (action) => {
				self.presetLoadBusByControlId.set(action.controlId, presetLoadBusFromOption(action.options.loadin))
				refreshPresetStyleForLoadAction(self, action)
			},
			unsubscribe: (action) => {
				self.presetLoadBusByControlId.delete(action.controlId)
				refreshPresetStyleForLoadAction(self, action)
			},
			options: [
				{
					type: 'dropdown',
					id: 'presetId',
					label: 'Preset',
					default: defaultPresetChoiceId(self),
					choices: presetChoices(self),
				},
				{
					type: 'dropdown',
					id: 'loadin',
					label: 'Load To',
					default: 'PVW',
					choices: [
						{ id: 'PVW', label: 'PVW' },
						{ id: 'PGM', label: 'PGM' },
					],
				},
			],
			callback: async (event) => {
				const presetId = parsePresetChoiceId(optionToString(event.options.presetId, defaultPresetChoiceId(self)))
				const targetBus = (event.options.loadin as 'PVW' | 'PGM' | 'AUX') ?? 'PVW'
				if (targetBus === 'PVW' || targetBus === 'PGM') {
					self.presetLoadBusByControlId.set(event.controlId, targetBus)
				}
				const preset = findPreset(self, presetId)
				if (!preset) {
					self.log('warn', `Load Preset: preset not found: ${presetId}`)
					return
				}
				const targetRegion = targetBus === 'PGM' || targetBus === 'AUX' ? LoadIn.program : LoadIn.preview
				if (targetBus === 'AUX') {
					await runHttpAction(self, 'Load AUX Preset', async () => self.apiClient!.loadPreset(preset, LoadIn.program))
					self.state.currentAuxPresetId = presetId
					self.checkFeedbacks(FeedbackId.AuxPresetActive)
					return
				}
				await runHttpAction(self, 'Load Preset', async () => self.apiClient!.loadPreset(preset, targetRegion))
				const previousPresetId = targetBus === 'PGM' ? self.state.currentPgmPresetId : self.state.currentPvwPresetId
				if (previousPresetId !== presetId) {
					if (targetBus === 'PGM') self.state.currentPgmPresetId = presetId
					else self.state.currentPvwPresetId = presetId
					self.updateVariableValues()
					self.checkFeedbacks(FeedbackId.PresetActive, ...changedPresetStyleFeedbackIds(previousPresetId, presetId))
				}
				void self.refreshPresetSnapshot()
			},
		},
		[ActionId.SelectOutputInterface]: {
			name: 'Select Output Interface',
			description: 'Select the active output interface for OUTPUT Source routing.',
			options: [
				{
					type: 'dropdown',
					id: 'interfaceId',
					label: 'Output',
					default: defaultOutputInterfaceId(self),
					choices: outputInterfaceChoices(self),
				},
			],
			callback: async (event) => {
				const interfaceId = optionToString(event.options.interfaceId)
				if (!interfaceId) return
				self.state.selectedOutputInterfaceId = interfaceId
				self.checkFeedbacks(FeedbackId.OutputInterfaceStyle, FeedbackId.OutputSourceStyle)
				self.updateActions()
				self.updatePresets()
			},
		},
		[ActionId.SetAuxSource]: {
			name: 'Set Output Source',
			description: 'Route a source to the selected output interface (POST /interface/output-display).',
			options: [
				{
					type: 'dropdown',
					id: 'sourceKey',
					label: 'Source',
					default: defaultOutputSourceKey(self),
					choices: outputSourceChoices(self),
				},
			],
			callback: async (event) => {
				const sourceKey = optionToString(event.options.sourceKey)
				const parsed = parseOutputSourceKey(sourceKey)
				if (!parsed) return
				const output = selectedOutputInterface(self)
				if (!output) {
					self.log('warn', 'Set Output Source: no output interface selected')
					return
				}
				if (!canRouteOutputSourceToSelected(self, sourceKey)) {
					self.log(
						'warn',
						`Set Output Source: source ${sourceKey} is not allowed for ${output.name} (interfaceType=${output.interfaceType})`,
					)
					return
				}
				const source = allOutputSourcesFlat(self).find((item) => item.id === sourceKey)
				const sourceName = source?.name ?? `Source ${parsed.sourceId}`
				await runHttpAction(self, 'Set Output Source', async () => {
					const response = await self.apiClient!.setAuxSource(
						output.id,
						parsed.sourceType,
						parsed.sourceId,
						sourceName,
						self,
					)
					if (!isUnicoOk(response)) {
						throw new Error(unicoErrorDetail(response))
					}
					self.state.outputs = self.state.outputs.map((item) =>
						item.id === output.id
							? {
									...item,
									displaySourceType: parsed.sourceType,
									displaySourceId: parsed.sourceId,
									displaySourceName: sourceName,
								}
							: item,
					)
					self.checkFeedbacks(FeedbackId.OutputSourceStyle)
					self.updatePresets()
				})
			},
		},
		[ActionId.SetStreaming]: {
			name: 'Stream',
			description: 'Live streaming on/off. Stream presets hold 1.5s before sending.',
			options: toggleEnableDisableOptions('Stream'),
			callback: (event) => {
				const start = resolveToggleEnableDisable(self.state.streaming, event.options.enable)
				// Do not highlight until the device accepts the request. Companion action timeout is ~5s,
				// so wait for the slow /stream/status call in the background.
				void runHttpAction(self, 'Stream Toggle', async () => {
					const response = await self.apiClient!.setStreaming(start, self)
					if (!isUnicoOk(response)) {
						throw new Error(unicoErrorDetail(response))
					}
					self.state.streaming = start
					self.updateVariableValues()
					self.checkFeedbacks(FeedbackId.StreamingActive, FeedbackId.StreamingStyle)
				})
			},
		},
		[ActionId.SetRecording]: {
			name: 'REC',
			description: 'Recording on/off. REC presets hold 1.5s before sending.',
			options: toggleEnableDisableOptions('REC'),
			callback: async (event) => {
				const start = resolveToggleEnableDisable(self.state.recording, event.options.enable)
				await runHttpAction(self, 'Record Toggle', async () => {
					const response = await self.apiClient!.setRecording(start, self)
					if (!isUnicoOk(response)) {
						throw new Error(unicoErrorDetail(response))
					}
					// Response is often {data:{status:1}} (result code). LCD switch field is `enable`.
					self.state.recording = parseRecordEnable(response) ?? start
					self.updateVariableValues()
					self.checkFeedbacks(FeedbackId.RecordingActive, FeedbackId.RecordingStyle)
				})
			},
		},
	})
}
