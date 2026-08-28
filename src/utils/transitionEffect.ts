import { asRecord, coerceFiniteNumber } from './recordCoerce.js'

/** LCD SwitchEffect::Cut */
export const SWITCH_EFFECT_CUT = 0

export type TransitionEffectName = 'MIX' | 'WIPE' | 'DVE' | 'DIP'

/**
 * LCD SwitchEffect：Cut=0、Fade=1、Dip=2、Wipe=3、Stinger=4、Dve=5。
 */
export const TRANSITION_EFFECT_OPTIONS: ReadonlyArray<{ id: TransitionEffectName; label: string; type: number }> = [
	{ id: 'MIX', label: 'MIX', type: 1 },
	{ id: 'DIP', label: 'DIP', type: 2 },
	{ id: 'WIPE', label: 'WIPE', type: 3 },
	{ id: 'DVE', label: 'DVE', type: 5 },
]

const NAME_BY_TYPE = new Map(TRANSITION_EFFECT_OPTIONS.map((item) => [item.type, item.id]))
const TYPE_BY_NAME = new Map(TRANSITION_EFFECT_OPTIONS.map((item) => [item.id, item.type]))

export function transitionEffectNameFromType(type: number): TransitionEffectName | null {
	return NAME_BY_TYPE.get(type) ?? null
}

export function transitionEffectTypeFromName(name: string): number {
	return TYPE_BY_NAME.get(name as TransitionEffectName) ?? TRANSITION_EFFECT_OPTIONS[0].type
}

/** GET/WS active-effect (0x71209)：`s_SetActiveEffect.type`。 */
export function parseActiveEffectType(data: unknown): number | undefined {
	const root = asRecord(data)
	const payload = asRecord(root?.data) ?? root
	return coerceFiniteNumber(payload?.type)
}

export function parseSwitchEffect(data: unknown): { type?: number; timeMs?: number } {
	const root = asRecord(data)
	if (!root) return {}
	const switchEffect = asRecord(root.switchEffect) ?? asRecord(asRecord(root.data)?.switchEffect)
	if (!switchEffect) return {}

	const time = coerceFiniteNumber(switchEffect.time)
	return {
		type: coerceFiniteNumber(switchEffect.type),
		timeMs: time != null && time > 0 ? time : undefined,
	}
}
