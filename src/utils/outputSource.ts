import type ModuleInstance from '../main.js'
import type {
	OutputDisplayGroup,
	S16OutputDisplaySourceState,
	S16OutputInterfaceState,
} from '../interfaces/DeviceState.js'
import type { Interface } from '../interfaces/Interface.js'
import { CONNECTOR_TYPE_EXTENDED_SOURCE } from './interfaceTypes.js'
import {
	asRecord,
	asRecordList,
	coerceFiniteNumber as pickNumber,
	pickTrimmedString as pickString,
} from './recordCoerce.js'
import {
	applyInterfacePatchFromPush,
	formatOutputInterfaceDisplayName,
	INTERFACE_TYPE_INPUT,
	INTERFACE_WORK_MODE_ENABLE,
	inputStatesFromInterfaces,
} from './sourceChoices.js'

export { CONNECTOR_TYPE_EXTENDED_SOURCE, CONNECTOR_TYPE_MEDIA_PLAYER, CONNECTOR_TYPE_MOSAIC } from './interfaceTypes.js'

/** LCD InterfaceType::NormalOutput (1 << 2). */
export const INTERFACE_TYPE_NORMAL_OUTPUT = 4
/** LCD InterfaceType::AUXOutput (1 << 3). */
export const INTERFACE_TYPE_AUX_OUTPUT = 8
/** LCD InterfaceType::MainOutput (1 << 6). */
export const INTERFACE_TYPE_MAIN_OUTPUT = 64
/** LCD ConnectorType::Stream — 排除在输出接口列表之外。 */
export const CONNECTOR_TYPE_STREAM = 59
/** LCD OutputSourceType::InputSource */
export const OUTPUT_SOURCE_TYPE_INPUT = 1
export const OUTPUT_SOURCE_TYPE_PVW = 2
export const OUTPUT_SOURCE_TYPE_PGM = 3
export const OUTPUT_SOURCE_TYPE_CLEAN_FEED = 4
/** GET catalog sourceType 5 — 内置源 (InterSource). */
export const OUTPUT_SOURCE_TYPE_BUILTIN = 5
/** GET catalog sourceType 6 — 图片源 / Media. */
export const OUTPUT_SOURCE_TYPE_MEDIA = 6
/** GET catalog sourceType 7 — 拼接源 (SuperSource)，仅 AUX。 */
export const OUTPUT_SOURCE_TYPE_SUPER_SOURCE = 7
/** @deprecated 请使用 OUTPUT_SOURCE_TYPE_BUILTIN */
export const OUTPUT_SOURCE_TYPE_PIC = OUTPUT_SOURCE_TYPE_BUILTIN
/** @deprecated 请使用 OUTPUT_SOURCE_TYPE_MEDIA */
export const OUTPUT_SOURCE_TYPE_MVR = OUTPUT_SOURCE_TYPE_MEDIA

const OUTPUT_TYPE_MASK = INTERFACE_TYPE_NORMAL_OUTPUT | INTERFACE_TYPE_AUX_OUTPUT | INTERFACE_TYPE_MAIN_OUTPUT

/** LCD outputdisplaygetter：Main/Normal 仅暴露 PVW、PGM、CleanFeed。 */
const MAIN_NORMAL_SOURCE_TYPES = new Set([
	OUTPUT_SOURCE_TYPE_PVW,
	OUTPUT_SOURCE_TYPE_PGM,
	OUTPUT_SOURCE_TYPE_CLEAN_FEED,
])

export function outputSourceKey(sourceType: number, sourceId: number | string): string {
	return `${sourceType}:${sourceId}`
}

export function parseOutputSourceKey(key: string): { sourceType: number; sourceId: string } | null {
	const idx = key.indexOf(':')
	if (idx <= 0) return null
	const sourceType = Number(key.slice(0, idx))
	const sourceId = key.slice(idx + 1)
	if (!Number.isFinite(sourceType) || !sourceId) return null
	return { sourceType, sourceId }
}

export function isOutputInterface(iface: Interface): boolean {
	const connector = iface.auxiliaryInfo.connectorInfo
	const interfaceType = connector.interfaceType
	const connectorType = connector.type
	// LCD interfacebiz::notifyOutputsChanged + keyboardcommandsubcommandoutput::slotOutputInterfaceChanged
	if (connector.workMode !== INTERFACE_WORK_MODE_ENABLE) return false
	if (connectorType === CONNECTOR_TYPE_STREAM) return false
	if (connectorType === CONNECTOR_TYPE_EXTENDED_SOURCE) return false
	return (interfaceType & OUTPUT_TYPE_MASK) !== 0
}

function outputInterfaceSortValue(iface: Interface): number {
	const type = iface.auxiliaryInfo.connectorInfo.interfaceType
	if (type === INTERFACE_TYPE_MAIN_OUTPUT) return 0
	if (type === INTERFACE_TYPE_NORMAL_OUTPUT) return 1
	if (type === INTERFACE_TYPE_AUX_OUTPUT) return 2
	return 3
}

/** LCD 丝印顺序回退：同类型内按 alias 尾部数字排序（AUX1…AUX12、Output1…）。 */
function outputAliasOrderKey(iface: Interface): number {
	const alias = iface.auxiliaryInfo.alias?.trim() ?? ''
	const match = /(\d+)\s*$/.exec(alias)
	if (match) return Number(match[1])
	return 1_000_000 + iface.interfaceId
}

function compareOutputInterfaces(a: Interface, b: Interface): number {
	const typeDelta = outputInterfaceSortValue(a) - outputInterfaceSortValue(b)
	if (typeDelta !== 0) return typeDelta
	const aliasDelta = outputAliasOrderKey(a) - outputAliasOrderKey(b)
	if (aliasDelta !== 0) return aliasDelta
	return a.interfaceId - b.interfaceId
}

export function formatOutputInterfaceLabel(iface: Interface): string {
	return formatOutputInterfaceDisplayName(iface)
}

function readDisplayInfo(iface: Interface | Record<string, unknown>): {
	sourceType?: number
	sourceId?: string
	sourceName?: string
} {
	const record = asRecord(iface) ?? (iface as Interface)
	const displayInfo = asRecord(record.displayInfo)
	if (!displayInfo) return {}
	const sourceType = pickNumber(displayInfo.sourceType)
	const sourceId = pickString(displayInfo, ['sourceId'])
	const sourceName = pickString(displayInfo, ['sourceName'])
	return {
		sourceType,
		sourceId: sourceId || undefined,
		sourceName: sourceName || undefined,
	}
}

export function outputInterfaceStatesFromInterfaces(interfaces: Interface[]): S16OutputInterfaceState[] {
	return interfaces
		.filter(isOutputInterface)
		.sort(compareOutputInterfaces)
		.map((iface) => {
			const display = readDisplayInfo(iface)
			return {
				id: String(iface.interfaceId),
				name: formatOutputInterfaceLabel(iface),
				interfaceType: iface.auxiliaryInfo.connectorInfo.interfaceType,
				online: iface.state === 1,
				displaySourceType: display.sourceType,
				displaySourceId: display.sourceId,
				displaySourceName: display.sourceName,
				raw: iface,
			}
		})
}

export function selectedOutputInterface(self: ModuleInstance): S16OutputInterfaceState | undefined {
	const id = self.state.selectedOutputInterfaceId
	if (!id) return self.state.outputs[0]
	return self.state.outputs.find((item) => item.id === id) ?? self.state.outputs[0]
}

export function ensureSelectedOutputInterface(self: ModuleInstance): void {
	if (self.state.outputs.length === 0) {
		self.state.selectedOutputInterfaceId = undefined
		return
	}
	const current = self.state.selectedOutputInterfaceId
	if (current && self.state.outputs.some((item) => item.id === current)) return
	const main = self.state.outputs.find((item) => item.interfaceType === INTERFACE_TYPE_MAIN_OUTPUT)
	self.state.selectedOutputInterfaceId = main?.id ?? self.state.outputs[0]?.id
}

export function parseOutputDisplayGroups(raw: unknown): OutputDisplayGroup[] {
	// LCD GET /interface/output-display → s_Response<s_DisplayInfos> `{ data: { displayInfos } }`
	const root = asRecord(raw)
	const data = asRecord(root?.data) ?? root
	const displayInfos = Array.isArray(data?.displayInfos)
		? data.displayInfos
		: Array.isArray(root?.data)
			? root.data
			: Array.isArray(raw)
				? raw
				: []
	const groups: OutputDisplayGroup[] = []
	for (const item of displayInfos) {
		const group = asRecord(item)
		if (!group) continue
		const sourceType = pickNumber(group.sourceType)
		if (sourceType == null) continue
		const sourceInfo: Array<{ sourceId: number; sourceName: string }> = []
		const sources = Array.isArray(group.sourceInfo) ? group.sourceInfo : []
		for (const src of sources) {
			const srcRecord = asRecord(src)
			if (!srcRecord) continue
			const sourceId = pickNumber(srcRecord.sourceId)
			if (sourceId == null) continue
			sourceInfo.push({
				sourceId,
				sourceName: pickString(srcRecord, ['sourceName']) || pickString(srcRecord, ['name']) || String(sourceId),
			})
		}
		groups.push({ sourceType, sourceInfo })
	}
	return groups.sort((a, b) => a.sourceType - b.sourceType)
}

function isEnabledInputInterface(iface: Interface): boolean {
	return (
		iface.auxiliaryInfo.connectorInfo.workMode === INTERFACE_WORK_MODE_ENABLE &&
		iface.auxiliaryInfo.connectorInfo.interfaceType === INTERFACE_TYPE_INPUT
	)
}

function sortAuxInputSources(groups: OutputDisplayGroup[], interfaces: Interface[]): OutputDisplayGroup[] {
	const inputOrder = interfaces.filter(isEnabledInputInterface).map((iface) => iface.interfaceId)
	return groups.map((group) => {
		if (group.sourceType !== OUTPUT_SOURCE_TYPE_INPUT) return group
		const sourceMap = new Map(group.sourceInfo.map((src) => [src.sourceId, src]))
		const ordered: Array<{ sourceId: number; sourceName: string }> = []
		for (const interfaceId of inputOrder) {
			const src = sourceMap.get(interfaceId)
			if (src) ordered.push(src)
		}
		for (const src of group.sourceInfo) {
			if (!ordered.some((item) => item.sourceId === src.sourceId)) {
				ordered.push(src)
			}
		}
		return { ...group, sourceInfo: ordered }
	})
}

function isExtendedSourceInterface(interfaces: Interface[], sourceId: number): boolean {
	return interfaces.some(
		(iface) =>
			iface.interfaceId === sourceId && iface.auxiliaryInfo.connectorInfo.type === CONNECTOR_TYPE_EXTENDED_SOURCE,
	)
}

function filterGroupsForInterfaceType(
	groups: OutputDisplayGroup[],
	interfaceType: number,
	interfaces: Interface[],
): OutputDisplayGroup[] {
	const isMainOrNormal = interfaceType === INTERFACE_TYPE_MAIN_OUTPUT || interfaceType === INTERFACE_TYPE_NORMAL_OUTPUT
	let filtered = isMainOrNormal ? groups.filter((group) => MAIN_NORMAL_SOURCE_TYPES.has(group.sourceType)) : groups

	filtered = filtered.map((group) => {
		if (interfaceType !== INTERFACE_TYPE_AUX_OUTPUT || group.sourceType !== OUTPUT_SOURCE_TYPE_INPUT) {
			return group
		}
		return {
			...group,
			sourceInfo: group.sourceInfo.filter((src) => !isExtendedSourceInterface(interfaces, src.sourceId)),
		}
	})

	if (interfaceType === INTERFACE_TYPE_AUX_OUTPUT) {
		filtered = sortAuxInputSources(filtered, interfaces)
	}

	return filtered
}

export function flattenOutputDisplaySources(
	groups: OutputDisplayGroup[],
	interfaces: Interface[],
	interfaceType: number,
): S16OutputDisplaySourceState[] {
	const filtered = filterGroupsForInterfaceType(groups, interfaceType, interfaces)
	const results: S16OutputDisplaySourceState[] = []
	for (const group of filtered) {
		for (const src of group.sourceInfo) {
			const inputIface = interfaces.find((iface) => iface.interfaceId === src.sourceId)
			const hasSignal = group.sourceType === OUTPUT_SOURCE_TYPE_INPUT ? inputIface?.state === 1 : true
			results.push({
				id: outputSourceKey(group.sourceType, src.sourceId),
				name: src.sourceName,
				sourceType: group.sourceType,
				sourceId: String(src.sourceId),
				hasSignal,
				raw: src,
			})
		}
	}
	return results
}

export function syncOutputDisplayGroups(self: ModuleInstance, raw: unknown): boolean {
	const groups = parseOutputDisplayGroups(raw)
	const changed = JSON.stringify(groups) !== JSON.stringify(self.state.outputDisplayGroups)
	self.state.outputDisplayGroups = groups
	return changed
}

/** sourceType=1 输入源目录指纹 — 输出接口类型变更时 sourceId 可能变化（如 13→14）。 */
export function inputSourceCatalogKey(groups: OutputDisplayGroup[]): string {
	const group = groups.find((item) => item.sourceType === OUTPUT_SOURCE_TYPE_INPUT)
	if (!group) return ''
	return group.sourceInfo.map((src) => `${src.sourceId}:${src.sourceName}`).join('|')
}

export function applyOutputDisplayCatalogFromPush(self: ModuleInstance, data: unknown): boolean {
	return syncOutputDisplayGroups(self, data)
}

export function outputSourcesForSelectedInterface(self: ModuleInstance): S16OutputDisplaySourceState[] {
	const selected = selectedOutputInterface(self)
	if (!selected || self.state.outputDisplayGroups.length === 0) return []
	return flattenOutputDisplaySources(self.state.outputDisplayGroups, self.deviceInterfaces, selected.interfaceType)
}

/** Main/Normal（Output1/2）+ AUX 源合并，供 preset/action 下拉框使用。 */
export function allOutputSourcesFlat(self: ModuleInstance): S16OutputDisplaySourceState[] {
	const groups = self.state.outputDisplayGroups
	if (groups.length === 0) return []

	const mainNormal = flattenOutputDisplaySources(groups, self.deviceInterfaces, INTERFACE_TYPE_MAIN_OUTPUT)
	const aux = flattenOutputDisplaySources(groups, self.deviceInterfaces, INTERFACE_TYPE_AUX_OUTPUT)

	const byId = new Map<string, S16OutputDisplaySourceState>()
	for (const source of mainNormal) byId.set(source.id, source)
	// 仅 AUX 类型（SuperSource=7 等）来自 aux 列表 — 与 LCD keyboard AUX 目录一致。
	for (const source of aux) byId.set(source.id, source)
	return Array.from(byId.values())
}

export function isOutputSourceAllowedForInterface(
	self: ModuleInstance,
	sourceType: number,
	sourceId: string,
	interfaceType: number,
): boolean {
	if (self.state.outputDisplayGroups.length === 0) return false
	const allowed = flattenOutputDisplaySources(self.state.outputDisplayGroups, self.deviceInterfaces, interfaceType)
	return allowed.some(
		(item) => item.sourceType === sourceType && String(item.sourceId) === String(sourceId),
	)
}

/** 判断 sourceKey 是否可路由到当前选中的输出接口。 */
export function canRouteOutputSourceToSelected(self: ModuleInstance, sourceKey: string): boolean {
	const parsed = parseOutputSourceKey(sourceKey)
	const output = selectedOutputInterface(self)
	if (!parsed || !output) return false
	return isOutputSourceAllowedForInterface(self, parsed.sourceType, parsed.sourceId, output.interfaceType)
}

/** 输入/输出接口 id 列表指纹 — 结构变化时需重建 presets/variables。 */
export function interfaceCatalogKey(self: ModuleInstance): string {
	return `${self.state.inputs.map((input) => input.id).join(',')}|${self.state.outputs.map((output) => output.id).join(',')}`
}

/** HTTP list-detail 全量替换 deviceInterfaces，并刷新 inputs/outputs 派生状态。 */
export function syncDeviceInterfaceList(self: ModuleInstance, interfaces: Interface[]): void {
	self.deviceInterfaces = interfaces
	self.state.inputs = inputStatesFromInterfaces(interfaces)
	syncOutputInterfacesFromDevice(self)
	applyOutputDisplayInfoFromInterfaces(self)
}

export function syncOutputInterfacesFromDevice(self: ModuleInstance): boolean {
	const outputs = outputInterfaceStatesFromInterfaces(self.deviceInterfaces)
	const changed = JSON.stringify(outputs) !== JSON.stringify(self.state.outputs)
	self.state.outputs = outputs
	ensureSelectedOutputInterface(self)
	return changed
}

function updateInterfaceDisplayInfo(
	interfaces: Interface[],
	interfaceId: string,
	sourceType: number,
	sourceId: string,
	sourceName?: string,
): Interface[] {
	return interfaces.map((iface) => {
		if (String(iface.interfaceId) !== interfaceId) return iface
		return {
			...iface,
			displayInfo: {
				...(iface.displayInfo ?? {}),
				sourceType,
				sourceId: Number(sourceId),
				sourceName: sourceName ?? iface.displayInfo?.sourceName ?? '',
			},
		}
	})
}

/** LCD WS PutInterfaceSetOutputDisplay：s_SetOutputDisplayArray。 */
function normalizeOutputDisplayPushRecords(data: unknown): Record<string, unknown>[] {
	return asRecordList(data).map((record) => {
		const nested = asRecord(record.displayInfo)
		if (nested && (nested.sourceType != null || nested.sourceId != null)) {
			return {
				interfaceId: record.interfaceId ?? record.id,
				sourceType: nested.sourceType,
				sourceId: nested.sourceId,
				sourceName: nested.sourceName,
			}
		}
		return record
	})
}

export type OutputDisplayPushResult = {
	applied: boolean
	/** Selected output interface routing changed (drives OUTPUT Source list green). */
	selectedInterfaceChanged: boolean
}

export function applyOutputDisplayFromPush(self: ModuleInstance, data: unknown): OutputDisplayPushResult {
	const records = normalizeOutputDisplayPushRecords(data)
	const selectedId = self.state.selectedOutputInterfaceId ?? selectedOutputInterface(self)?.id
	let applied = false
	let selectedInterfaceChanged = false

	for (const record of records) {
		const interfaceId = pickString(record, ['interfaceId']) || String(pickNumber(record.interfaceId) ?? '')
		const sourceType = pickNumber(record.sourceType)
		const sourceIdRaw = pickString(record, ['sourceId'])
		const sourceId =
			sourceIdRaw ||
			(pickNumber(record.sourceId) != null ? String(pickNumber(record.sourceId)) : '')
		const sourceName = pickString(record, ['sourceName'])
		// sourceId 可能为 0（PGM/PVW/CleanFeed）；仅在完全缺失时跳过。
		if (!interfaceId || sourceType == null || sourceId === '') continue

		const previous = self.state.outputs.find((output) => output.id === interfaceId)
		applied = true
		self.state.outputs = self.state.outputs.map((output) => {
			if (output.id !== interfaceId) return output
			return {
				...output,
				displaySourceType: sourceType,
				displaySourceId: sourceId,
				displaySourceName: sourceName || output.displaySourceName,
			}
		})

		self.deviceInterfaces = updateInterfaceDisplayInfo(
			self.deviceInterfaces,
			interfaceId,
			sourceType,
			sourceId,
			sourceName || undefined,
		)

		if (
			interfaceId === selectedId &&
			(Number(previous?.displaySourceType) !== sourceType ||
				String(previous?.displaySourceId ?? '') !== sourceId)
		) {
			selectedInterfaceChanged = true
		}
	}

	return { applied, selectedInterfaceChanged }
}

export function applyOutputDisplayInfoFromInterfaces(self: ModuleInstance): boolean {
	let changed = false
	self.state.outputs = self.state.outputs.map((output) => {
		const iface = self.deviceInterfaces.find((item) => String(item.interfaceId) === output.id)
		if (!iface) return output
		const display = readDisplayInfo(iface)
		const next = {
			...output,
			online: iface.state === 1,
			displaySourceType: display.sourceType,
			displaySourceId: display.sourceId,
			displaySourceName: display.sourceName,
		}
		if (
			next.displaySourceId !== output.displaySourceId ||
			next.displaySourceType !== output.displaySourceType ||
			next.online !== output.online
		) {
			changed = true
		}
		return next
	})
	return changed
}

/** OUTPUT Source 绿色高亮：仅 Companion 当前选中的输出接口正在路由此源。 */
export function isOutputSourceUsed(self: ModuleInstance, sourceType: number, sourceId: string): boolean {
	const output = selectedOutputInterface(self)
	if (!output) return false
	const targetType = Number(sourceType)
	const targetId = String(sourceId)
	if (!Number.isFinite(targetType) || targetId === '') return false
	return (
		Number(output.displaySourceType) === targetType &&
		output.displaySourceId != null &&
		String(output.displaySourceId) === targetId
	)
}

/** WS 重命名或信号 patch 后，从 deviceInterfaces 重建 inputs/outputs。 */
export function refreshInterfaceDerivedState(self: ModuleInstance): boolean {
	let changed = false
	const inputs = inputStatesFromInterfaces(self.deviceInterfaces)
	if (JSON.stringify(inputs) !== JSON.stringify(self.state.inputs)) {
		self.state.inputs = inputs
		changed = true
	}
	if (syncOutputInterfacesFromDevice(self)) changed = true
	return changed
}

/** 合并 WS 接口 patch（general.name / alias / state）并刷新派生 UI 状态。 */
export function applyInterfacePatchAndRefresh(self: ModuleInstance, data: unknown): boolean {
	const next = applyInterfacePatchFromPush(self.deviceInterfaces, data)
	if (next === self.deviceInterfaces) return false
	self.deviceInterfaces = next
	refreshInterfaceDerivedState(self)
	return true
}
