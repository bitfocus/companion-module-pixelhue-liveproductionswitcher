import { BLACK, GREEN, PURPLE, RED } from './constants.js'
import { LAYER_SCENE_BOTH, LAYER_SCENE_PGM, LAYER_SCENE_PVW } from './stateParsers.js'

export type LayerControlMode = 'select' | 'pgm' | 'nextTransPvw'

/** 兼容旧 action 配置里的 pvw / nextTrans。 */
export function normalizeLayerControlMode(value: unknown): LayerControlMode {
	if (value === 'pgm' || value === 'nextTransPvw') return value
	if (value === 'pvw' || value === 'nextTrans') return 'nextTransPvw'
	return 'select'
}

export function layerControlModeLabel(mode: LayerControlMode): string {
	switch (mode) {
		case 'pgm':
			return 'ON'
		case 'select':
			return 'SEL'
		case 'nextTransPvw':
			return ''
	}
}

/** Button text for KEY Edit — single newline keeps the block vertically balanced. */
export function layerControlButtonText(layerLabel: string, mode: LayerControlMode): string {
	const modeLabel = layerControlModeLabel(mode)
	return modeLabel ? `${layerLabel}\n${modeLabel}` : layerLabel
}

export function layerControlBg(sceneType: number | undefined, mode: LayerControlMode): number {
	if (mode === 'pgm') return RED
	if (mode === 'nextTransPvw' || mode === 'select') return GREEN
	switch (sceneType) {
		case LAYER_SCENE_PGM:
			return RED
		case LAYER_SCENE_PVW:
			return GREEN
		case LAYER_SCENE_BOTH:
			return PURPLE
		default:
			return BLACK
	}
}
