export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export function asRecordList(raw: unknown): Record<string, unknown>[] {
	if (Array.isArray(raw)) {
		return raw.map(asRecord).filter((item): item is Record<string, unknown> => item != null)
	}
	const record = asRecord(raw)
	return record ? [record] : []
}

export function httpPageList(raw: unknown): unknown[] {
	const root = asRecord(raw)
	if (!root) return []
	if (Array.isArray(root.data)) return root.data
	const page = asRecord(root.data)
	return Array.isArray(page?.list) ? page.list : []
}

/** LCD WS 分页结构（`s_PresetDetailPage` 等）：payload 根部的 `list`。 */
export function wsPageList(raw: unknown): unknown[] {
	const page = asRecord(raw)
	return Array.isArray(page?.list) ? page.list : []
}

export function coerceFiniteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value)
		if (Number.isFinite(parsed)) return parsed
	}
	return undefined
}

export function pickTrimmedString(record: Record<string, unknown> | undefined, keys: string[]): string {
	if (!record) return ''
	for (const key of keys) {
		const value = record[key]
		if (typeof value === 'string' && value.trim() !== '') return value.trim()
		if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	}
	return ''
}

export function coerceId(value: unknown): string {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	return ''
}

const DEFAULT_PAYLOAD_ID_KEYS = ['id', 'layerId', 'inputId', 'interfaceId', 'presetId', 'sourceId'] as const

/** 从 WS/HTTP payload 对象或对象数组中取第一个非空 id。 */
export function pickIdFromPayload(data: unknown, keys: readonly string[] = DEFAULT_PAYLOAD_ID_KEYS): string {
	if (Array.isArray(data)) {
		for (const item of data) {
			const id = pickIdFromPayload(item, keys)
			if (id) return id
		}
		return ''
	}
	const record = asRecord(data)
	if (!record) return ''
	for (const key of keys) {
		const id = coerceId(record[key])
		if (id) return id
	}
	return ''
}

export function coerceEnable(value: unknown): boolean {
	return value === true || value === 1 || value === '1'
}
