import type ModuleInstance from '../main.js'

const MAX_PAYLOAD_LOG = 2000

export function formatProtocolPayload(raw: unknown, maxLength = MAX_PAYLOAD_LOG): string {
	try {
		const text = JSON.stringify(raw)
		return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`
	} catch {
		return String(raw)
	}
}

export function logHttpResponse(self: ModuleInstance | null | undefined, label: string, response: unknown): void {
	if (!self) return
	self.log('info', `[HTTP] ${label} response: ${formatProtocolPayload(response)}`)
}

export function logWsEvent(self: ModuleInstance, tag: string, raw: unknown, detail?: string): void {
	const suffix = detail ? ` ${detail}` : ''
	self.log('info', `[WS] ${tag}${suffix} raw=${formatProtocolPayload(raw)}`)
}
