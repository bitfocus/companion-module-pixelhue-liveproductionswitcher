export interface WebsocketCallbackData {
	type: EWebsocketCallbackType
	tag: number
	subType?: number
	header: Record<string, unknown>
	data: unknown
}

export enum EWebsocketCallbackType {
	/** Normal business report */
	report,

	/** Console panel button report */
	panel,
}

/** @deprecated Use WebsocketCallbackData for ucenter TLV frames. */
export interface DeviceEvent {
	event: string
	sequence?: number
	data: unknown
	raw: string
}
