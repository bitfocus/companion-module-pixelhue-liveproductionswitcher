import type { Screen } from './Screen.js'

export interface PresetListDetailData {
	totalCount: number
	list: Preset[]
	currentPresetId?: string
}

export interface PresetIdObj {
	id: number
	sceneType: number
	playType?: number
}

export interface PresetGeneral {
	name: string
}

export interface Preset {
	presetId?: number
	presetIdObj?: PresetIdObj
	general?: PresetGeneral
	keyPosition?: number[]
	/** Legacy switcher-protocol fields. */
	guid?: string
	name?: string
	currentRegion?: number
	sourceRegion?: number
	serial?: number
	screens: Screen[]
}

export function getPresetId(preset: Preset): string {
	return preset.presetId != null ? String(preset.presetId) : ''
}

export function getPresetName(preset: Preset): string {
	return preset.general?.name ?? preset.name ?? ''
}

/** Companion 下拉框用非纯数字 id，避免选中后显示原始值而非 label */
const PRESET_CHOICE_PREFIX = 'pid:'

export function toPresetChoiceId(presetId: number): string {
	return `${PRESET_CHOICE_PREFIX}${presetId}`
}

export function parsePresetChoiceId(value: string): string {
	return value.startsWith(PRESET_CHOICE_PREFIX) ? value.slice(PRESET_CHOICE_PREFIX.length) : value
}

export const LoadIn = {
	preview: 4,
	program: 2,
}

/** presetIdObj.playType：1=未加载 2=PGM 4=PVW 6=PGM+PVW */
export const PresetPlayType = {
	NotLoaded: 1,
	Pgm: 2,
	Pvw: 4,
	Both: 6,
} as const

export function getPresetPlayType(preset: Pick<Preset, 'presetIdObj'> & { playType?: number }): number {
	return preset.playType ?? preset.presetIdObj?.playType ?? PresetPlayType.NotLoaded
}

export function isPresetOnPgm(playType: number): boolean {
	return playType === PresetPlayType.Pgm || playType === PresetPlayType.Both
}

export function isPresetOnPvw(playType: number): boolean {
	return playType === PresetPlayType.Pvw || playType === PresetPlayType.Both
}

export function syncPresetLoadState(presets: Preset[]): {
	currentPgmPresetId?: string
	currentPvwPresetId?: string
} {
	let currentPgmPresetId: string | undefined
	let currentPvwPresetId: string | undefined

	for (const preset of presets) {
		const id = getPresetId(preset)
		if (!id) continue
		const playType = getPresetPlayType(preset)
		if (isPresetOnPgm(playType)) currentPgmPresetId = id
		if (isPresetOnPvw(playType)) currentPvwPresetId = id
	}

	return { currentPgmPresetId, currentPvwPresetId }
}
