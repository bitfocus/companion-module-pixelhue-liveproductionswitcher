import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { FeedbackId } from './utils/enum.js'
import { allOutputSourcesFlat, isOutputSourceUsed, OUTPUT_SOURCE_TYPE_INPUT } from './utils/outputSource.js'
import { TRANSITION_EFFECT_OPTIONS, transitionEffectNameFromType } from './utils/transitionEffect.js'
import {
	layerControlBg,
	layerControlButtonText,
	isLayerControlSelected,
	isInputUsedBySelectedLayer,
	findStateLayer,
} from './utils/layerSelection.js'
import { bkgdInputStatesFromInterfaces } from './utils/sourceChoices.js'
import { buttonDisplayFromLabel } from './utils/buttonText.js'

const WHITE = combineRgb(255, 255, 255)
const GRAY = combineRgb(146, 146, 146)
const RED = combineRgb(204, 0, 0)
const RED_TEXT = combineRgb(255, 0, 0)
const GREEN = combineRgb(0, 153, 0)
const GREEN_TEXT = combineRgb(0, 204, 0)
const BLACK = combineRgb(0, 0, 0)
const HALF_WHITE = combineRgb(128, 128, 128)
const BKGD_PGM_BG = combineRgb(25, 0, 0)
const BKGD_PVW_BG = combineRgb(0, 25, 0)

export type PresetLoadBus = 'PVW' | 'PGM'

export function bkgdBusBg(bus: PresetLoadBus): number {
	return bus === 'PGM' ? BKGD_PGM_BG : BKGD_PVW_BG
}

export type BkgdSourceButtonStyle = {
	text: string
	color: number
	bgcolor: number
	alignment: 'center:center'
	size: number
}

function bkgdSourceLabel(self: ModuleInstance, inputId: string): string {
	if (self.deviceInterfaces.length > 0) {
		const fromBkgd = bkgdInputStatesFromInterfaces(self.deviceInterfaces).find((item) => item.id === inputId)
		if (fromBkgd?.name) return fromBkgd.name
	}
	const fromState = self.state.inputs.find((item) => item.id === inputId)
	return fromState?.name || `IN${inputId}`
}

/** PGM：■ 紧贴标签（中间勿加空格，Companion 会在空格处换行把图标顶到上一行）。 */
export function formatBkgdPgmButtonText(label: string): string {
	return `■${label}`
}

/** PVW：■ 紧贴标签。 */
export function formatBkgdPvwButtonText(label: string): string {
	return `■${label}`
}

function optionToString(value: unknown, fallback = ''): string {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	return fallback
}

export function presetStyleFeedbackId(presetId: string): string {
	return `preset_style_${presetId}`
}

export function presetStyle(
	self: ModuleInstance,
	presetId: string,
	loadin: PresetLoadBus = 'PVW',
): {
	text: string
	size: number
	color: number
	bgcolor: number
} {
	const preset = self.state.presets.find((item) => item.id === presetId)
	const onPgm = self.state.currentPgmPresetId === presetId
	const onPvw = self.state.currentPvwPresetId === presetId
	const { text, size } = buttonDisplayFromLabel(preset?.name || `S${presetId}`, 14)
	if (onPgm) {
		return { text, size, color: WHITE, bgcolor: RED }
	}
	if (onPvw) {
		return { text, size, color: WHITE, bgcolor: GREEN }
	}
	return {
		text,
		size,
		color: WHITE,
		bgcolor: bkgdBusBg(loadin),
	}
}

export function updateCompanionFeedbacks(self: ModuleInstance): void {
	const perPresetStyleFeedbacks = Object.fromEntries(
		self.state.presets.map((preset) => [
			presetStyleFeedbackId(preset.id),
			{
				name: `Scene Style: ${preset.name}`,
				type: 'advanced' as const,
				options: [],
				callback: (feedback: { controlId: string }) => {
					const loadin = self.presetLoadBusByControlId.get(feedback.controlId) ?? 'PVW'
					return presetStyle(self, preset.id, loadin)
				},
			},
		]),
	)

	self.setFeedbackDefinitions({
		...perPresetStyleFeedbacks,
		[FeedbackId.FtbActive]: {
			name: 'FTB Active',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => self.ftbEnabled,
		},

		[FeedbackId.StreamingActive]: {
			name: 'Streaming Active',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => self.state.streaming,
		},

		[FeedbackId.StreamingStyle]: {
			name: 'Streaming Style',
			type: 'advanced',
			options: [],
			callback: () => streamingButtonStyle(self),
		},

		[FeedbackId.RecordingActive]: {
			name: 'Recording Active',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => self.state.recording,
		},

		[FeedbackId.RecordingStyle]: {
			name: 'Recording Style',
			type: 'advanced',
			options: [],
			callback: () => recordingButtonStyle(self),
		},

		[FeedbackId.LayerSelected]: {
			name: 'Layer Selected',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ type: 'textinput', id: 'layerId', label: 'Layer ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const layerId = optionToString(feedback.options.layerId)
				return isLayerControlSelected(self, layerId, 'select')
			},
		},

		[FeedbackId.LayerOnAir]: {
			name: 'Layer On Air (PGM)',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [{ type: 'textinput', id: 'layerId', label: 'Layer ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const layerId = optionToString(feedback.options.layerId)
				return self.state.layers.find((layer) => layer.id === layerId)?.onAir ?? false
			},
		},

		[FeedbackId.LayerPreview]: {
			name: 'Layer In Preview (PVW)',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ type: 'textinput', id: 'layerId', label: 'Layer ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const layerId = optionToString(feedback.options.layerId)
				return self.state.layers.find((layer) => layer.id === layerId)?.preview ?? false
			},
		},

		[FeedbackId.LayerTransitionFollow]: {
			name: 'Layer Follows Next Transition',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ type: 'textinput', id: 'layerId', label: 'Layer ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const layerId = optionToString(feedback.options.layerId)
				return self.state.layers.find((layer) => layer.id === layerId)?.transitionFollow ?? false
			},
		},

		[FeedbackId.LayerControlStyle]: {
			name: 'KEY Edit Style',
			type: 'advanced',
			options: [{ type: 'textinput', id: 'layerId', label: 'Layer ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const layerId = optionToString(feedback.options.layerId)
				const layer = findStateLayer(self, layerId)
				const label = layer?.name ?? ''
				const mode = self.layerControlModeByControlId.get(feedback.controlId) ?? 'select'
				const selected = isLayerControlSelected(self, layerId, mode)

				return {
					text: layerControlButtonText(label, mode),
					color: WHITE,
					bgcolor: selected ? layerControlBg(layer?.sceneType, mode) : BLACK,
					alignment: 'center:center',
				}
			},
		},

		[FeedbackId.InputHasSignal]: {
			name: 'Input Signal Style',
			type: 'advanced',
			options: [{ type: 'textinput', id: 'inputId', label: 'Input ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const inputId = optionToString(feedback.options.inputId)
				const input = self.state.inputs.find((item) => item.id === inputId)
				const hasSignal = input?.hasSignal ?? false
				const { text, size } = buttonDisplayFromLabel(input?.name || `IN${inputId}`)
				return { text, size, color: hasSignal ? WHITE : GRAY }
			},
		},

		[FeedbackId.InputUsedByLayer]: {
			name: 'Input Used By Selected Layer',
			type: 'boolean',
			defaultStyle: { color: GREEN_TEXT },
			options: [{ type: 'textinput', id: 'inputId', label: 'Input ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const inputId = optionToString(feedback.options.inputId)
				return isInputUsedBySelectedLayer(self, inputId)
			},
		},

		[FeedbackId.InputOnProgram]: {
			name: 'Input On Program (PGM)',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [{ type: 'textinput', id: 'inputId', label: 'Input ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const inputId = optionToString(feedback.options.inputId)
				return self.state.programSourceId === inputId
			},
		},

		[FeedbackId.InputOnPreview]: {
			name: 'Input On Preview (PVW)',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ type: 'textinput', id: 'inputId', label: 'Input ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const inputId = optionToString(feedback.options.inputId)
				return self.state.previewSourceId === inputId
			},
		},

		[FeedbackId.BkgdPgmSourceStyle]: {
			name: 'BKGD PGM Source Style',
			type: 'advanced',
			options: [{ type: 'textinput', id: 'inputId', label: 'Input ID', default: '1', useVariables: true }],
			callback: (feedback) => bkgdPgmSourceStyle(self, optionToString(feedback.options.inputId)),
		},

		[FeedbackId.BkgdPvwSourceStyle]: {
			name: 'BKGD PVW Source Style',
			type: 'advanced',
			options: [{ type: 'textinput', id: 'inputId', label: 'Input ID', default: '1', useVariables: true }],
			callback: (feedback) => bkgdPvwSourceStyle(self, optionToString(feedback.options.inputId)),
		},

		[FeedbackId.OutputInterfaceStyle]: {
			name: 'Output Interface Style',
			type: 'advanced',
			options: [{ type: 'textinput', id: 'interfaceId', label: 'Interface ID', default: '1', useVariables: true }],
			callback: (feedback) => outputInterfaceStyle(self, optionToString(feedback.options.interfaceId)),
		},
		[FeedbackId.OutputSourceStyle]: {
			name: 'Output Source Style',
			type: 'advanced',
			options: [
				{ type: 'textinput', id: 'sourceType', label: 'Source Type', default: '1', useVariables: true },
				{ type: 'textinput', id: 'sourceId', label: 'Source ID', default: '1', useVariables: true },
			],
			callback: (feedback) =>
				outputSourceStyle(
					self,
					Number(optionToString(feedback.options.sourceType, '1')),
					optionToString(feedback.options.sourceId, '1'),
				),
		},

		[FeedbackId.PresetNameStyle]: {
			name: 'Scene Name',
			type: 'advanced',
			options: [{ type: 'textinput', id: 'presetId', label: 'Scene ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const presetId = optionToString(feedback.options.presetId)
				const preset = self.state.presets.find((item) => item.id === presetId)
				return buttonDisplayFromLabel(preset?.name || `S${presetId}`, 14)
			},
		},

		[FeedbackId.PresetStyle]: {
			name: 'Scene Style',
			type: 'advanced',
			options: [
				{ type: 'textinput', id: 'presetId', label: 'Scene ID', default: '1', useVariables: true },
				{
					type: 'dropdown',
					id: 'bus',
					label: 'Load To',
					default: 'PVW',
					choices: [
						{ id: 'PVW', label: 'PVW' },
						{ id: 'PGM', label: 'PGM' },
					],
				},
			],
			callback: (feedback) =>
				presetStyle(self, optionToString(feedback.options.presetId), feedback.options.bus === 'PGM' ? 'PGM' : 'PVW'),
		},

		[FeedbackId.PresetActive]: {
			name: 'Scene Loaded on Bus',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{ type: 'textinput', id: 'presetId', label: 'Scene ID', default: '1', useVariables: true },
				{
					type: 'dropdown',
					id: 'bus',
					label: 'Bus',
					default: 'PVW',
					choices: [
						{ id: 'PVW', label: 'PVW' },
						{ id: 'PGM', label: 'PGM' },
					],
				},
			],
			callback: (feedback) => {
				const presetId = optionToString(feedback.options.presetId)
				const bus = feedback.options.bus === 'PGM' ? self.state.currentPgmPresetId : self.state.currentPvwPresetId
				return bus === presetId
			},
		},

		[FeedbackId.AuxPresetActive]: {
			name: 'AUX Scene Loaded',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [{ type: 'textinput', id: 'presetId', label: 'Scene ID', default: '1', useVariables: true }],
			callback: (feedback) => {
				const presetId = optionToString(feedback.options.presetId)
				return self.state.currentAuxPresetId === presetId
			},
		},

		[FeedbackId.TransitionMixActive]: {
			name: 'Transition MIX Active',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => transitionEffectNameFromType(self.activeTransitionEffectType) === 'MIX',
		},
		[FeedbackId.TransitionWipeActive]: {
			name: 'Transition WIPE Active',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => transitionEffectNameFromType(self.activeTransitionEffectType) === 'WIPE',
		},
		[FeedbackId.TransitionDveActive]: {
			name: 'Transition DVE Active',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => transitionEffectNameFromType(self.activeTransitionEffectType) === 'DVE',
		},
		[FeedbackId.TransitionDipActive]: {
			name: 'Transition DIP Active',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => transitionEffectNameFromType(self.activeTransitionEffectType) === 'DIP',
		},
		[FeedbackId.TransitionEffectActive]: {
			name: 'Transition Effect Active',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'effect',
					label: 'Effect',
					default: 'MIX',
					choices: TRANSITION_EFFECT_OPTIONS.map((item) => ({ id: item.id, label: item.label })),
				},
			],
			callback: (feedback) =>
				transitionEffectNameFromType(self.activeTransitionEffectType) ===
				optionToString(feedback.options.effect, 'MIX'),
		},
	})
}

/** Input used by a layer — green text. */
export function inputUsedByLayerStyle(): { color: number } {
	return { color: GREEN_TEXT }
}

/** Style for input buttons: white text when signal present, gray when not. */
export function inputSignalTextStyle(hasSignal: boolean): { color: number; bgcolor: number } {
	return {
		color: hasSignal ? WHITE : GRAY,
		bgcolor: BLACK,
	}
}

/** BKGD PGM source style. */
export function bkgdPgmSourceStyle(self: ModuleInstance, inputId: string): BkgdSourceButtonStyle {
	const input = self.state.inputs.find((item) => item.id === inputId)
	const hasSignal = input?.hasSignal ?? false
	const used = self.state.programSourceId === inputId
	const label = bkgdSourceLabel(self, inputId)
	const { text, size } = buttonDisplayFromLabel(`■${label}`)
	return {
		text,
		size,
		color: used ? RED_TEXT : hasSignal ? WHITE : GRAY,
		bgcolor: BKGD_PGM_BG,
		alignment: 'center:center',
	}
}

/** Stream 预设：推流中红底，否则黑底。 */
export function streamingButtonStyle(self: ModuleInstance): {
	text: string
	size: number
	color: number
	bgcolor: number
} {
	return {
		text: 'Stream',
		size: 16,
		color: WHITE,
		bgcolor: self.state.streaming ? RED : BLACK,
	}
}

/** REC 预设：录制中红底，否则黑底。 */
export function recordingButtonStyle(self: ModuleInstance): {
	text: string
	size: number
	color: number
	bgcolor: number
} {
	return {
		text: 'REC',
		size: 18,
		color: WHITE,
		bgcolor: self.state.recording ? RED : BLACK,
	}
}

export function bkgdPvwSourceStyle(self: ModuleInstance, inputId: string): BkgdSourceButtonStyle {
	const input = self.state.inputs.find((item) => item.id === inputId)
	const hasSignal = input?.hasSignal ?? false
	const used = self.state.previewSourceId === inputId
	const label = bkgdSourceLabel(self, inputId)
	const { text, size } = buttonDisplayFromLabel(`■${label}`)
	return {
		text,
		size,
		color: used ? GREEN_TEXT : hasSignal ? WHITE : HALF_WHITE,
		bgcolor: BKGD_PVW_BG,
		alignment: 'center:center',
	}
}

/** OUTPUT interface: selected = green text, otherwise white. */
export function outputInterfaceStyle(
	self: ModuleInstance,
	interfaceId: string,
): { text: string; color: number; bgcolor: number; size: number } {
	const selected = self.state.selectedOutputInterfaceId === interfaceId
	const output = self.state.outputs.find((item) => item.id === interfaceId)
	const { text, size } = buttonDisplayFromLabel(output?.name || `Output${interfaceId}`, 14)
	return {
		text,
		size,
		color: selected ? GREEN_TEXT : WHITE,
		bgcolor: BLACK,
	}
}

/** OUTPUT Source: used = green text; signal white/gray for input sources. */
export function outputSourceStyle(
	self: ModuleInstance,
	sourceType: number,
	sourceId: string,
): { text: string; color: number; bgcolor: number; size: number } {
	const source = allOutputSourcesFlat(self).find(
		(item) => item.sourceType === sourceType && String(item.sourceId) === String(sourceId),
	)
	const { text, size } = buttonDisplayFromLabel(source?.name || `Source ${sourceId}`, 14)
	const used = isOutputSourceUsed(self, sourceType, sourceId)
	if (used) return { text, size, color: GREEN_TEXT, bgcolor: BLACK }

	if (sourceType === OUTPUT_SOURCE_TYPE_INPUT) {
		const iface = self.deviceInterfaces.find((item) => String(item.interfaceId) === sourceId)
		const hasSignal = iface?.state === 1
		return { text, size, color: hasSignal ? WHITE : GRAY, bgcolor: BLACK }
	}
	return { text, size, color: WHITE, bgcolor: BLACK }
}
