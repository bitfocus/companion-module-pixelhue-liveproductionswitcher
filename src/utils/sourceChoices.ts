import type { DropdownChoice } from '@companion-module/base'
import type { S16InputState } from '../interfaces/DeviceState.js'
import type { Interface } from '../interfaces/Interface.js'
import { CONNECTOR_TYPE_EXTENDED_SOURCE } from './interfaceTypes.js'
import { asRecord, asRecordList, coerceFiniteNumber, pickTrimmedString } from './recordCoerce.js'

/** LCD ConnectorState::DisConnect — state 不等于此值时表示 hasSignal。 */
const CONNECTOR_STATE_DISCONNECT = 0

/** LCD InterfaceType::Input (1 << 1). */
export const INTERFACE_TYPE_INPUT = 2
/** LCD InterfaceWorkMode::Enable. */
export const INTERFACE_WORK_MODE_ENABLE = 0

/** NormalOutput | AUXOutput | MainOutput — 用于 WS 标签路由。 */
const OUTPUT_INTERFACE_TYPE_MASK = 4 | 8 | 64

export function hasInterfaceSignal(state: number | undefined): boolean {
	return state != null && state !== CONNECTOR_STATE_DISCONNECT
}

/** 直接使用 API sourceName，不做 alias 映射。 */
function readInterfaceSourceName(iface: Interface): string {
	return iface.displayInfo?.sourceName?.trim() ?? ''
}

/** OUTPUT 接口列表 — 直接用 list-detail 的 general.name / alias，不做翻译。 */
export function formatOutputInterfaceDisplayName(iface: Interface): string {
	const general = iface.general.name?.trim()
	if (general) return general
	const alias = iface.auxiliaryInfo.alias?.trim()
	if (alias) return alias
	return `Output${iface.interfaceId}`
}

/** 输入源 / BKGD / Source 预设标签 — 优先 displayInfo.sourceName。 */
export function formatInterfaceSourceLabel(iface: Interface): string {
	const sourceName = readInterfaceSourceName(iface)
	if (sourceName) return sourceName
	const general = iface.general.name?.trim()
	if (general) return general
	const alias = iface.auxiliaryInfo.alias?.trim()
	if (alias) return alias
	return `Input ${iface.interfaceId}`
}

/** OUTPUT Source 目录项 — 直接使用 GET output-display 的 sourceName。 */
export function formatOutputCatalogSourceName(_sourceType: number, apiSourceName: string, _iface?: Interface): string {
	return apiSourceName.trim()
}

function patchConnector(
	existing: Interface['auxiliaryInfo']['connectorInfo'],
	connectorInfo: Record<string, unknown> | undefined,
): Interface['auxiliaryInfo']['connectorInfo'] {
	if (!connectorInfo) return existing
	return {
		interfaceType: coerceFiniteNumber(connectorInfo.interfaceType) ?? existing.interfaceType,
		type: coerceFiniteNumber(connectorInfo.type) ?? existing.type,
		workMode: coerceFiniteNumber(connectorInfo.workMode) ?? existing.workMode,
	}
}

function patchDisplayInfo(
	existing: Interface['displayInfo'],
	displayInfo: Record<string, unknown>,
): Interface['displayInfo'] {
	const sourceType = coerceFiniteNumber(displayInfo.sourceType)
	const sourceId =
		coerceFiniteNumber(displayInfo.sourceId) ??
		(pickTrimmedString(displayInfo, ['sourceId']) ? Number(pickTrimmedString(displayInfo, ['sourceId'])) : undefined)
	const sourceName = pickTrimmedString(displayInfo, ['sourceName'])
	return {
		...existing,
		...(sourceType != null ? { sourceType } : {}),
		...(sourceId != null && Number.isFinite(sourceId) ? { sourceId } : {}),
		...(sourceName ? { sourceName } : {}),
	}
}

/** 将 WS 接口 general/alias/state 合并到 deviceInterfaces（重命名，无需 HTTP）。 */
export function applyInterfacePatchFromPush(interfaces: Interface[], data: unknown): Interface[] {
	const items = Array.isArray(data) ? data : data != null ? [data] : []
	if (items.length === 0) return interfaces

	let next = interfaces
	for (const item of items) {
		const record = asRecord(item)
		if (!record) continue
		const interfaceId = coerceFiniteNumber(record.interfaceId) ?? coerceFiniteNumber(record.id)
		if (interfaceId == null) continue

		const index = next.findIndex((iface) => iface.interfaceId === interfaceId)
		if (index < 0) continue

		const existing = next[index]
		const general = asRecord(record.general)
		const auxiliary = asRecord(record.auxiliaryInfo)
		const connectorInfo = asRecord(auxiliary?.connectorInfo)
		const linkInfo = asRecord(record.linkInfo)
		const displayInfo = asRecord(record.displayInfo)
		const alias = pickTrimmedString(auxiliary, ['alias'])

		const patched: Interface = {
			...existing,
			state: coerceFiniteNumber(record.state) ?? existing.state,
			general: {
				...existing.general,
				...(general?.name != null ? { name: String(general.name) } : {}),
			},
			auxiliaryInfo: {
				...existing.auxiliaryInfo,
				...(alias ? { alias } : {}),
				connectorInfo: patchConnector(existing.auxiliaryInfo.connectorInfo, connectorInfo),
			},
			linkInfo:
				linkInfo?.isLink != null
					? {
							...existing.linkInfo,
							isLink: linkInfo.isLink === 1 || linkInfo.isLink === '1' ? 1 : 0,
						}
					: existing.linkInfo,
			displayInfo: displayInfo ? patchDisplayInfo(existing.displayInfo, displayInfo) : existing.displayInfo,
		}

		next = [...next.slice(0, index), patched, ...next.slice(index + 1)]
	}

	return next
}

function mergeInterfaceItem(existing: Interface, incoming: unknown): Interface {
	const record = asRecord(incoming)
	if (!record) return existing
	if (coerceFiniteNumber(record.interfaceId) == null && coerceFiniteNumber(record.id) == null) {
		return applyInterfacePatchFromPush([existing], incoming)[0] ?? existing
	}

	const inc = incoming as Interface
	return {
		...existing,
		...inc,
		general: { ...existing.general, ...inc.general },
		auxiliaryInfo: {
			...existing.auxiliaryInfo,
			...inc.auxiliaryInfo,
			connectorInfo: {
				...existing.auxiliaryInfo.connectorInfo,
				...inc.auxiliaryInfo.connectorInfo,
			},
		},
		linkInfo: { ...existing.linkInfo, ...inc.linkInfo },
		displayInfo: inc.displayInfo ? { ...existing.displayInfo, ...inc.displayInfo } : existing.displayInfo,
	}
}

/** 将 WS 接口详情 upsert 到缓存 — 绝不用单条 push 项替换完整列表。 */
export function mergeInterfacesFromPush(interfaces: Interface[], data: unknown): Interface[] {
	const pushes = asRecordList(data)
	if (pushes.length === 0) return interfaces

	let next = interfaces
	for (const item of pushes) {
		const interfaceId = coerceFiniteNumber(item.interfaceId) ?? coerceFiniteNumber(item.id)
		if (interfaceId == null) continue

		const index = next.findIndex((iface) => iface.interfaceId === interfaceId)
		if (index >= 0) {
			next = [...next.slice(0, index), mergeInterfaceItem(next[index], item), ...next.slice(index + 1)]
			continue
		}

		const coerced = coerceInterfaceFromPush(item, String(interfaceId))
		if (coerced) next = [...next, coerced]
	}

	return next
}

/** WS push 载荷 → 用于命名的 Interface 壳。 */
function coerceInterfaceFromPush(raw: unknown, fallbackId?: string): Interface | undefined {
	const record = asRecord(raw)
	if (!record) return undefined
	const auxiliary = asRecord(record.auxiliaryInfo)
	const connectorInfo = asRecord(auxiliary?.connectorInfo)
	const general = asRecord(record.general)
	const linkInfo = asRecord(record.linkInfo)
	const displayInfo = asRecord(record.displayInfo)
	const id =
		coerceFiniteNumber(record.interfaceId) ??
		coerceFiniteNumber(record.id) ??
		(fallbackId ? Number(fallbackId) : undefined)
	if (id == null || !Number.isFinite(id)) return undefined

	return {
		interfaceId: id,
		state: coerceFiniteNumber(record.state) ?? 0,
		general: { name: pickTrimmedString(general, ['name']) || pickTrimmedString(record, ['name', 'inputName']) },
		auxiliaryInfo: {
			alias: pickTrimmedString(auxiliary, ['alias']),
			connectorInfo: {
				interfaceType: coerceFiniteNumber(connectorInfo?.interfaceType) ?? INTERFACE_TYPE_INPUT,
				type: coerceFiniteNumber(connectorInfo?.type) ?? 0,
				workMode: coerceFiniteNumber(connectorInfo?.workMode) ?? INTERFACE_WORK_MODE_ENABLE,
			},
		},
		linkInfo: {
			isLink: linkInfo?.isLink === 1 || linkInfo?.isLink === '1' ? 1 : 0,
		},
		displayInfo: displayInfo ? patchDisplayInfo(undefined, displayInfo) : undefined,
	}
}

/** 来自 WS 的输入/输出接口标签。 */
export function formatInterfaceLabelFromPush(raw: unknown, fallbackId?: string): string {
	const iface = coerceInterfaceFromPush(raw, fallbackId)
	if (!iface) return fallbackId ? `Input ${fallbackId}` : 'Input'
	if ((iface.auxiliaryInfo.connectorInfo.interfaceType & OUTPUT_INTERFACE_TYPE_MASK) !== 0) {
		return formatOutputInterfaceDisplayName(iface)
	}
	return formatInterfaceSourceLabel(iface)
}

/** 已启用的输入接口（排除 ExtendedSource）。 */
export function isLayerSourceInput(iface: Interface): boolean {
	const connector = iface.auxiliaryInfo.connectorInfo
	return (
		connector.type !== CONNECTOR_TYPE_EXTENDED_SOURCE &&
		connector.workMode === INTERFACE_WORK_MODE_ENABLE &&
		connector.interfaceType === INTERFACE_TYPE_INPUT
	)
}

export function layerSourceInterfaces(interfaces: Interface[]): Interface[] {
	return interfaces.filter(isLayerSourceInput)
}

export function bkgdSourceInterfaces(interfaces: Interface[]): Interface[] {
	return layerSourceInterfaces(interfaces)
}

function sourceChoice(iface: Interface): DropdownChoice {
	return { id: String(iface.interfaceId), label: formatInterfaceSourceLabel(iface) }
}

function inputState(iface: Interface): S16InputState {
	return {
		id: String(iface.interfaceId),
		name: formatInterfaceSourceLabel(iface),
		hasSignal: hasInterfaceSignal(iface.state),
		raw: iface,
	}
}

export function sourceChoicesFromInterfaces(interfaces: Interface[]): DropdownChoice[] {
	return layerSourceInterfaces(interfaces).map(sourceChoice)
}

export function bkgdSourceChoicesFromInterfaces(interfaces: Interface[]): DropdownChoice[] {
	return bkgdSourceInterfaces(interfaces).map(sourceChoice)
}

export function inputStatesFromInterfaces(interfaces: Interface[]): S16InputState[] {
	return layerSourceInterfaces(interfaces).map(inputState)
}

export function bkgdInputStatesFromInterfaces(interfaces: Interface[]): S16InputState[] {
	return bkgdSourceInterfaces(interfaces).map(inputState)
}

export function findLayerSourceInterface(interfaces: Interface[], sourceId: string): Interface | undefined {
	return layerSourceInterfaces(interfaces).find((item) => String(item.interfaceId) === sourceId)
}

export function findBkgdSourceInterface(interfaces: Interface[], sourceId: string): Interface | undefined {
	return findLayerSourceInterface(interfaces, sourceId)
}
