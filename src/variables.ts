import type ModuleInstance from './main.js'
import type { CompanionVariableDefinitions, CompanionVariableValues } from '@companion-module/base'
import { VariableId } from './utils/enum.js'
import { isLayerControlSelected } from './utils/layerSelection.js'
import { transitionEffectNameFromType } from './utils/transitionEffect.js'

export function updateCompanionVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions = {
		[VariableId.ConnectionStatus]: { name: 'Connection status' },
		[VariableId.WsConnected]: { name: 'WebSocket connected (true/false)' },
		[VariableId.FtbEnabled]: { name: 'FTB enabled (true/false)' },
		[VariableId.Streaming]: { name: 'Streaming active (true/false)' },
		[VariableId.Recording]: { name: 'Recording active (true/false)' },
		[VariableId.LayerCount]: { name: 'Number of layers' },
		[VariableId.InputCount]: { name: 'Number of inputs' },
		[VariableId.PresetCount]: { name: 'Number of scenes (presets)' },
		[VariableId.CurrentPgmPresetId]: { name: 'Scene ID currently loaded on PGM' },
		[VariableId.CurrentPvwPresetId]: { name: 'Scene ID currently loaded on PVW' },
		[VariableId.ActiveTransitionEffect]: { name: 'Active TAKE transition effect (MIX/WIPE/DVE/DIP)' },
	}

	for (const layer of self.state.layers) {
		definitions[`layer_${layer.id}_name`] = { name: `Layer ${layer.id}: name` }
		definitions[`layer_${layer.id}_onair`] = { name: `Layer ${layer.id}: on air (PGM)` }
		definitions[`layer_${layer.id}_preview`] = { name: `Layer ${layer.id}: in preview (PVW)` }
		definitions[`layer_${layer.id}_selected`] = { name: `Layer ${layer.id}: selected` }
		definitions[`layer_${layer.id}_transition_follow`] = { name: `Layer ${layer.id}: follows next transition` }
		definitions[`layer_${layer.id}_source`] = { name: `Layer ${layer.id}: source ID` }
	}

	for (const input of self.state.inputs) {
		definitions[`input_${input.id}_name`] = { name: `Input ${input.id}: name` }
		definitions[`input_${input.id}_has_signal`] = { name: `Input ${input.id}: has signal` }
	}

	for (const aux of self.state.auxes) {
		definitions[`aux_${aux.id}_name`] = { name: `AUX ${aux.id}: name` }
		definitions[`aux_${aux.id}_source`] = { name: `AUX ${aux.id}: source ID` }
	}

	for (const preset of self.state.presets) {
		definitions[`preset_${preset.id}_name`] = { name: `Scene ${preset.id}: name` }
		definitions[`preset_${preset.id}_saved`] = { name: `Scene ${preset.id}: saved (true/false)` }
	}

	self.setVariableDefinitions(definitions)
}

export function updateVariableValues(self: ModuleInstance): void {
	const values: CompanionVariableValues = {
		[VariableId.ConnectionStatus]: self.connectionStatus,
		[VariableId.WsConnected]: self.wsConnected ? 'true' : 'false',
		[VariableId.FtbEnabled]: self.ftbEnabled ? 'true' : 'false',
		[VariableId.Streaming]: self.state.streaming ? 'true' : 'false',
		[VariableId.Recording]: self.state.recording ? 'true' : 'false',
		[VariableId.LayerCount]: self.state.layers.length,
		[VariableId.InputCount]: self.state.inputs.length,
		[VariableId.PresetCount]: self.state.presets.length,
		[VariableId.CurrentPgmPresetId]: self.state.currentPgmPresetId ?? '',
		[VariableId.CurrentPvwPresetId]: self.state.currentPvwPresetId ?? '',
		[VariableId.ActiveTransitionEffect]: transitionEffectNameFromType(self.activeTransitionEffectType) ?? '',
	}

	for (const layer of self.state.layers) {
		values[`layer_${layer.id}_name`] = layer.name
		values[`layer_${layer.id}_onair`] = layer.onAir ? 'true' : 'false'
		values[`layer_${layer.id}_preview`] = layer.preview ? 'true' : 'false'
		values[`layer_${layer.id}_selected`] = isLayerControlSelected(self, layer.id, 'select') ? 'true' : 'false'
		values[`layer_${layer.id}_transition_follow`] = layer.transitionFollow ? 'true' : 'false'
		values[`layer_${layer.id}_source`] = layer.sourceId ?? ''
	}

	for (const input of self.state.inputs) {
		values[`input_${input.id}_name`] = input.name
		values[`input_${input.id}_has_signal`] = input.hasSignal ? 'true' : 'false'
	}

	for (const aux of self.state.auxes) {
		values[`aux_${aux.id}_name`] = aux.name
		values[`aux_${aux.id}_source`] = aux.sourceId ?? ''
	}

	for (const preset of self.state.presets) {
		values[`preset_${preset.id}_name`] = preset.name
		values[`preset_${preset.id}_saved`] = preset.saved ? 'true' : 'false'
	}

	self.setVariableValues(values)
}
