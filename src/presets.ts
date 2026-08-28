import { type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { ActionId, FeedbackId, PresetId } from './utils/enum.js'
import {
	outputInterfaceStyle,
	outputSourceStyle,
	inputSignalTextStyle,
	inputUsedByLayerStyle,
	bkgdPgmSourceStyle,
	bkgdPvwSourceStyle,
	presetStyle,
	presetStyleFeedbackId,
	streamingButtonStyle,
	recordingButtonStyle,
} from './feedbacks.js'
import { bkgdInputStatesFromInterfaces } from './utils/sourceChoices.js'
import { allOutputSourcesFlat } from './utils/outputSource.js'
import {
	layerControlBg,
	layerControlButtonText,
	defaultConcreteLayerDropdownId,
	companionLayerChoiceId,
} from './utils/layerSelection.js'
import { isLayerControlSelected } from './utils/layerSelection.js'
import { WHITE, RED, GREEN, BLACK, STREAM_RECORD_HOLD_MS } from './utils/constants.js'
import { sortPresets } from './utils/utils.js'
import { toPresetChoiceId } from './interfaces/Preset.js'
import { buttonDisplayFromLabel } from './utils/buttonText.js'

function streamRecordHoldStep(actionId: ActionId.SetStreaming | ActionId.SetRecording) {
	return {
		down: [],
		up: [],
		[STREAM_RECORD_HOLD_MS]: {
			options: { runWhileHeld: true },
			actions: [{ actionId, options: { enable: -1 } }],
		},
	}
}

function transitionEffectPresetStyle(text: string) {
	return { text, size: 16, color: WHITE, bgcolor: BLACK }
}

export function updateCompanionPresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions = {
		[PresetId.Cut]: {
			type: 'simple',
			name: 'CUT',
			style: { text: 'CUT', size: 22, color: WHITE, bgcolor: RED },
			steps: [
				{
					down: [{ actionId: ActionId.Cut, options: {} }],
					up: [],
				},
			],
			feedbacks: [],
		},
		[PresetId.Take]: {
			type: 'simple',
			name: 'AUTO',
			style: { text: 'AUTO', size: 22, color: WHITE, bgcolor: GREEN },
			steps: [
				{
					down: [{ actionId: ActionId.Take, options: {} }],
					up: [],
				},
			],
			feedbacks: [],
		},
		[PresetId.Ftb]: {
			type: 'simple',
			name: 'FTB',
			style: { text: 'FTB', size: 22, color: WHITE, bgcolor: BLACK },
			steps: [{ down: [{ actionId: ActionId.Ftb, options: { enable: -1 } }], up: [] }],
			feedbacks: [{ feedbackId: FeedbackId.FtbActive, style: { bgcolor: RED, color: WHITE }, options: {} }],
		},
		[PresetId.TransitionMix]: {
			type: 'simple',
			name: 'MIX',
			style: transitionEffectPresetStyle('MIX'),
			steps: [{ down: [{ actionId: ActionId.SetTransitionMix, options: {} }], up: [] }],
			feedbacks: [{ feedbackId: FeedbackId.TransitionMixActive, style: { bgcolor: GREEN, color: WHITE }, options: {} }],
		},
		[PresetId.TransitionWipe]: {
			type: 'simple',
			name: 'WIPE',
			style: transitionEffectPresetStyle('WIPE'),
			steps: [{ down: [{ actionId: ActionId.SetTransitionWipe, options: {} }], up: [] }],
			feedbacks: [
				{ feedbackId: FeedbackId.TransitionWipeActive, style: { bgcolor: GREEN, color: WHITE }, options: {} },
			],
		},
		[PresetId.TransitionDip]: {
			type: 'simple',
			name: 'DIP',
			style: transitionEffectPresetStyle('DIP'),
			steps: [{ down: [{ actionId: ActionId.SetTransitionDip, options: {} }], up: [] }],
			feedbacks: [{ feedbackId: FeedbackId.TransitionDipActive, style: { bgcolor: GREEN, color: WHITE }, options: {} }],
		},
		[PresetId.TransitionDve]: {
			type: 'simple',
			name: 'DVE',
			style: transitionEffectPresetStyle('DVE'),
			steps: [{ down: [{ actionId: ActionId.SetTransitionDve, options: {} }], up: [] }],
			feedbacks: [{ feedbackId: FeedbackId.TransitionDveActive, style: { bgcolor: GREEN, color: WHITE }, options: {} }],
		},
		[PresetId.Stream]: {
			type: 'simple',
			name: 'Stream',
			style: streamingButtonStyle(self),
			steps: [streamRecordHoldStep(ActionId.SetStreaming)],
			feedbacks: [{ feedbackId: FeedbackId.StreamingStyle, options: {} }],
		},
		[PresetId.Rec]: {
			type: 'simple',
			name: 'REC',
			style: recordingButtonStyle(self),
			steps: [streamRecordHoldStep(ActionId.SetRecording)],
			feedbacks: [{ feedbackId: FeedbackId.RecordingStyle, options: {} }],
		},
	}

	const keyPresetIds: string[] = []
	for (const layer of self.state.layers) {
		const layerChoiceId = companionLayerChoiceId(layer)
		const label = layer.name ?? ''
		const presetMode = 'select'
		const selected = isLayerControlSelected(self, layerChoiceId, presetMode)
		const mode = presetMode
		const text = layerControlButtonText(label, mode)
		const id = `key_layer_${layerChoiceId}`
		keyPresetIds.push(id)

		presets[id] = {
			type: 'simple',
			name: `${label}`,
			style: {
				text,
				size: 16,
				color: WHITE,
				bgcolor: selected ? layerControlBg(layer.sceneType, mode) : BLACK,
				alignment: 'center:center',
			},
			steps: [
				{
					down: [{ actionId: ActionId.LayerControl, options: { layerId: layerChoiceId, mode: 'select' } }],
					up: [],
				},
			],
			feedbacks: [{ feedbackId: FeedbackId.LayerControlStyle, options: { layerId: layerChoiceId } }],
		}
	}

	const sourcePresetIds: string[] = []
	for (const input of self.state.inputs) {
		const label = input.name || `IN${input.id}`
		const id = `source_${input.id}`
		sourcePresetIds.push(id)
		const baseStyle = inputSignalTextStyle(input.hasSignal)
		const { text, size } = buttonDisplayFromLabel(label)
		presets[id] = {
			type: 'simple',
			name: `${label}`,
			style: { text, size, ...baseStyle },
			steps: [
				{
					down: [
						{
							actionId: ActionId.SetLayerSource,
							options: {
								useSelectedLayer: true,
								layerId: defaultConcreteLayerDropdownId(self),
								sourceId: input.id,
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: FeedbackId.InputHasSignal,
					options: { inputId: input.id },
				},
				{
					feedbackId: FeedbackId.InputUsedByLayer,
					style: inputUsedByLayerStyle(),
					options: { inputId: input.id },
				},
			],
		}
	}

	const bkgdPgmIds: string[] = []
	const bkgdPvwIds: string[] = []
	const bkgdInputs =
		self.deviceInterfaces.length > 0 ? bkgdInputStatesFromInterfaces(self.deviceInterfaces) : self.state.inputs
	for (const input of bkgdInputs) {
		const label = input.name || `IN${input.id}`
		const pgmId = `bkgd_pgm_${input.id}`
		const pvwId = `bkgd_pvw_${input.id}`
		bkgdPgmIds.push(pgmId)
		bkgdPvwIds.push(pvwId)

		presets[pgmId] = {
			type: 'simple',
			name: label,
			style: { ...bkgdPgmSourceStyle(self, input.id) },
			steps: [{ down: [{ actionId: ActionId.SetProgramSource, options: { sourceId: input.id } }], up: [] }],
			feedbacks: [
				{
					feedbackId: FeedbackId.BkgdPgmSourceStyle,
					options: { inputId: input.id },
				},
			],
		}
		presets[pvwId] = {
			type: 'simple',
			name: label,
			style: { ...bkgdPvwSourceStyle(self, input.id) },
			steps: [{ down: [{ actionId: ActionId.SetPreviewSource, options: { sourceId: input.id } }], up: [] }],
			feedbacks: [
				{
					feedbackId: FeedbackId.BkgdPvwSourceStyle,
					options: { inputId: input.id },
				},
			],
		}
	}

	const outputInterfaceIds: string[] = []
	for (const output of self.state.outputs) {
		const label = output.name
		const id = `output_iface_${output.id}`
		outputInterfaceIds.push(id)
		presets[id] = {
			type: 'simple',
			name: label,
			style: { ...outputInterfaceStyle(self, output.id) },
			steps: [{ down: [{ actionId: ActionId.SelectOutputInterface, options: { interfaceId: output.id } }], up: [] }],
			feedbacks: [{ feedbackId: FeedbackId.OutputInterfaceStyle, options: { interfaceId: output.id } }],
		}
	}

	const outputSourceIds: string[] = []
	for (const source of allOutputSourcesFlat(self)) {
		const label = source.name
		const id = `output_src_${source.id.replace(':', '_')}`
		outputSourceIds.push(id)
		presets[id] = {
			type: 'simple',
			name: label,
			style: {
				...outputSourceStyle(self, source.sourceType, source.sourceId),
			},
			steps: [{ down: [{ actionId: ActionId.SetAuxSource, options: { sourceKey: source.id } }], up: [] }],
			feedbacks: [
				{
					feedbackId: FeedbackId.OutputSourceStyle,
					options: { sourceType: String(source.sourceType), sourceId: source.sourceId },
				},
			],
		}
	}

	const scenePresetIds: string[] = []
	for (const scene of sortPresets(self.state.presets)) {
		if (!scene.saved && self.state.presets.length > 16) continue
		const label = scene.name || `S${scene.id}`
		const id = `scene_${scene.id}`
		scenePresetIds.push(id)
		const choiceId = scene.presetId != null ? toPresetChoiceId(scene.presetId) : scene.id
		presets[id] = {
			type: 'simple',
			name: label,
			style: { ...presetStyle(self, scene.id, 'PVW') },
			steps: [
				{
					down: [{ actionId: ActionId.LoadPreset, options: { presetId: choiceId, loadin: 'PVW' } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: presetStyleFeedbackId(scene.id),
					options: {},
				},
			],
		}
	}

	const structure: CompanionPresetSection[] = []

	if (keyPresetIds.length > 0) {
		structure.push({ id: 'section-key', name: 'Key', definitions: keyPresetIds })
	}
	if (sourcePresetIds.length > 0) {
		structure.push({ id: 'section-source', name: 'Source', definitions: sourcePresetIds })
	}
	if (bkgdPgmIds.length > 0) {
		structure.push({ id: 'section-bkgd-pgm', name: 'BKGD Source-PGM', definitions: bkgdPgmIds })
	}
	if (bkgdPvwIds.length > 0) {
		structure.push({ id: 'section-bkgd-pvw', name: 'BKGD Source-PVW', definitions: bkgdPvwIds })
	}
	if (outputInterfaceIds.length > 0) {
		structure.push({ id: 'section-output', name: 'OUTPUT', definitions: outputInterfaceIds })
	}
	if (outputSourceIds.length > 0) {
		structure.push({ id: 'section-output-source', name: 'OUTPUT Source', definitions: outputSourceIds })
	}
	if (scenePresetIds.length > 0) {
		structure.push({ id: 'section-presets', name: 'Presets', definitions: scenePresetIds })
	}

	structure.push(
		{
			id: 'section-display',
			name: 'Display',
			definitions: [
				PresetId.Cut,
				PresetId.Take,
				PresetId.Ftb,
				PresetId.TransitionMix,
				PresetId.TransitionWipe,
				PresetId.TransitionDve,
				PresetId.TransitionDip,
			],
		},
		{
			id: 'section-stream',
			name: 'Stream',
			definitions: [PresetId.Stream, PresetId.Rec],
		},
	)

	self.setPresetDefinitions(structure, presets)
}
