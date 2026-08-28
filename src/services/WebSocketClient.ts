import { WebSocket } from 'ws'
import { TextDecoder } from 'util'
import type ModuleInstance from '../main.js'
import { EWebsocketCallbackType, type WebsocketCallbackData } from '../interfaces/WebsocketCallbackData.js'
import { dispatchDeviceEvent } from './WebSocketHandling.js'
import { UCENTER_WS_PATH, WS_PING_INTERVAL_MS, WS_PONG_TIMEOUT_MS } from '../utils/constants.js'

function headerSn(message: WebsocketCallbackData): string | undefined {
	const raw = (message.header?.sn ?? message.header?.SN) as string | undefined
	if (raw == null) return undefined
	const trimmed = String(raw).trim()
	return trimmed === '' ? undefined : trimmed
}

export function filterMessageForDevice(self: ModuleInstance, message: WebsocketCallbackData): boolean {
	const boundSn = self.deviceSn
	const msgSn = headerSn(message)
	return !boundSn || !msgSn || msgSn === boundSn
}

export interface TlvParseDetails {
	tlv1Length: number
	tlv1End: number
	tag: number
	errCode: number
	tlv2Length: number
	totalLength: number
	tlv2JsonLength: number
	header: Record<string, unknown>
	data: unknown
}

export class WebSocketClient {
	private instance: ModuleInstance
	private host: string
	private token: string
	private socket: WebSocket | null = null
	private pingTimer: NodeJS.Timeout | null = null
	private pongTimer: NodeJS.Timeout | null = null

	private readonly onMessage = (data: WebSocket.RawData) => this.messageReceived(data)
	private readonly onError = (err: Error) => {
		this.instance.log('warn', `WebSocket error: ${err.message}`)
	}
	private readonly onClose = () => this.instance.onWebSocketDisconnected()
	private readonly onOpen = () => {
		this.startHeartbeat()
		this.instance.onWebSocketConnected()
	}
	private readonly onPong = () => this.clearPongTimer()

	private decoder = new TextDecoder()

	constructor(instance: ModuleInstance, host: string, token: string) {
		this.instance = instance
		this.host = host
		this.token = token
	}

	static async create(instance: ModuleInstance, host: string, token: string): Promise<WebSocketClient> {
		const client = new WebSocketClient(instance, host, token)
		client.connect()
		return client
	}

	connect(): void {
		this.socket = new WebSocket(`wss://${this.host}:19998${UCENTER_WS_PATH}`, {
			headers: {
				Authorization: this.token,
			},
			rejectUnauthorized: false,
		})

		this.socket.on('open', this.onOpen)
		this.socket.on('message', this.onMessage)
		this.socket.on('error', this.onError)
		this.socket.on('close', this.onClose)
		this.socket.on('pong', this.onPong)
	}

	disconnect(): void {
		this.stopHeartbeat()
		if (this.socket) {
			this.socket.off?.('open', this.onOpen)
			this.socket.off?.('message', this.onMessage)
			this.socket.off?.('error', this.onError)
			this.socket.off?.('close', this.onClose)
			this.socket.off?.('pong', this.onPong)

			if (this.socket.readyState !== WebSocket.CLOSED) {
				this.socket.terminate()
			}
		}
		this.socket = null
	}

	private startHeartbeat(): void {
		this.stopHeartbeat()
		this.pingTimer = setInterval(() => this.sendPing(), WS_PING_INTERVAL_MS)
	}

	private stopHeartbeat(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer)
			this.pingTimer = null
		}
		this.clearPongTimer()
	}

	private clearPongTimer(): void {
		if (this.pongTimer) {
			clearTimeout(this.pongTimer)
			this.pongTimer = null
		}
	}

	private sendPing(): void {
		const socket = this.socket
		if (!socket || socket.readyState !== WebSocket.OPEN) return
		if (this.pongTimer) return

		this.pongTimer = setTimeout(() => {
			this.pongTimer = null
			this.instance.log('warn', 'WebSocket ping timeout, closing stale connection')
			socket.terminate()
		}, WS_PONG_TIMEOUT_MS)

		socket.ping()
	}

	private messageReceived(data: WebSocket.RawData): void {
		if (!(data instanceof Buffer)) {
			return
		}

		const frame = Buffer.from(data)
		let parsedMessage: WebsocketCallbackData
		try {
			;({ message: parsedMessage } = this.parseTLVBuffer(frame))
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			this.instance.log('error', `[WS] TLV parse failed (${frame.length} bytes): ${message}`)
			return
		}

		if (!filterMessageForDevice(this.instance, parsedMessage)) {
			return
		}

		dispatchDeviceEvent(this.instance, parsedMessage)
	}

	parseTLVBuffer(buffer: Buffer): { message: WebsocketCallbackData; details: TlvParseDetails } {
		const TLV1_OFFSET = 32
		const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

		const tlv1Length = dataView.getUint16(TLV1_OFFSET + 6, true)
		const tlv1Start = TLV1_OFFSET + 8
		const tlv1End = tlv1Start + tlv1Length
		const tlv1JsonStr = this.decoder.decode(buffer.subarray(tlv1Start, tlv1End))
		const header = JSON.parse(tlv1JsonStr) as Record<string, unknown>

		const tlv2Offset = tlv1End
		const tag = dataView.getUint32(tlv2Offset, true)
		const errCode = dataView.getUint16(tlv2Offset + 4, true)
		const tlv2Length = dataView.getUint16(tlv2Offset + 6, true)
		const totalLength = (errCode << 16) + tlv2Length

		const tlv2Start = tlv2Offset + 8
		const tlv2End = tlv2Start + totalLength
		const tlv2JsonStr = this.decoder.decode(buffer.subarray(tlv2Start, tlv2End))
		const data = JSON.parse(tlv2JsonStr || '{}')

		const message: WebsocketCallbackData = {
			type: EWebsocketCallbackType.report,
			tag,
			subType: 0,
			header,
			data,
		}

		return {
			message,
			details: {
				tlv1Length,
				tlv1End,
				tag,
				errCode,
				tlv2Length,
				totalLength,
				tlv2JsonLength: tlv2JsonStr.length,
				header,
				data,
			},
		}
	}
}
