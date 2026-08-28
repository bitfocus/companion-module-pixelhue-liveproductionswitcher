import jwt from 'jsonwebtoken'

import type ModuleInstance from '../main.js'
import { getPresetName, syncPresetLoadState, type Preset } from '../interfaces/Preset.js'
import { presetStyleFeedbackId } from '../feedbacks.js'
import { FeedbackId } from './enum.js'

function isNonEmptyTrimmedString(value: unknown): boolean {
	return typeof value === 'string' && value.trim() !== ''
}

function isValidPreset(preset: Preset): boolean {
	return preset.presetId != null && isNonEmptyTrimmedString(getPresetName(preset))
}

export function filterValidPresets(list: Preset[]): Preset[] {
	return list.filter(isValidPreset).map((preset) => ({
		...preset,
		screens: preset.screens,
	}))
}

export function applyPresetLoadState(self: ModuleInstance, presets?: Preset[]): void {
	const previousPgmPresetId = self.state.currentPgmPresetId
	const previousPvwPresetId = self.state.currentPvwPresetId
	const loadState = syncPresetLoadState(presets ?? self.devicePresets)
	// 乐观 action 更新、HTTP 快照与设备 push 都会汇聚于此；
	// 在状态未变时重绘会导致所有场景按钮闪烁。
	if (previousPgmPresetId === loadState.currentPgmPresetId && previousPvwPresetId === loadState.currentPvwPresetId) {
		return
	}
	self.state.currentPgmPresetId = loadState.currentPgmPresetId
	self.state.currentPvwPresetId = loadState.currentPvwPresetId
	self.updateVariableValues()
	self.checkFeedbacks(
		FeedbackId.PresetActive,
		...changedPresetStyleFeedbackIds(
			previousPgmPresetId,
			previousPvwPresetId,
			loadState.currentPgmPresetId,
			loadState.currentPvwPresetId,
		),
	)
}

/** 仅离开或进入总线的场景需要重绘。 */
export function changedPresetStyleFeedbackIds(...presetIds: (string | undefined)[]): string[] {
	return [...new Set(presetIds.filter((presetId): presetId is string => Boolean(presetId)))].map(presetStyleFeedbackId)
}
export function generateToken(sn: string, secret: string): string {
	return jwt.sign(
		{
			SN: sn,
		},
		secret,
		{
			algorithm: 'HS256',
			noTimestamp: true,
		},
	)
}

function getPresetSortId(preset: { presetIdObj?: { id?: number }; sortIndex?: number }): number {
	return preset.sortIndex ?? preset.presetIdObj?.id ?? Number.MAX_SAFE_INTEGER
}

export function sortPresets<T extends { presetIdObj?: { id?: number }; sortIndex?: number }>(list: T[]): T[] {
	return [...list].sort((a, b) => getPresetSortId(a) - getPresetSortId(b))
}
