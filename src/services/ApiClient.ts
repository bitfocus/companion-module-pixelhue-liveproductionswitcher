import got from 'got'
import { filterValidPresets } from '../utils/utils.js'
import { generateToken } from '../utils/utils.js'
import { CONNECTION_TIMEOUT_MS } from '../utils/constants.js'
import type ModuleInstance from '../main.js'
import type { Screen, ScreenListDetailData } from '../interfaces/Screen.js'
import { getPresetName, type Preset, type PresetListDetailData } from '../interfaces/Preset.js'
import type { Response } from '../interfaces/Response.js'
import type { Layer, LayerBounds, LayerListDetailData, LayerUMD } from '../interfaces/Layer.js'
import { HttpClient } from './HttpClient.js'
import type { Interface, InterfacesListDetailData } from '../interfaces/Interface.js'
import { MACHINE_CONFIG, type MachineConfig } from '../config/machineConfig.js'
import { logHttpResponse } from '../utils/protocolLog.js'
import { findLayerSourceInterface, findBkgdSourceInterface } from '../utils/sourceChoices.js'
import { asRecord, httpPageList } from '../utils/recordCoerce.js'

/** 为调用方保留 `response.data.list`；LCD GET list-detail 为 `s_XxxPage.list`。 */
function withPageList<T>(res: Response<unknown>, list: T[]): Response<{ list: T[]; totalCount: number }> {
	const page = asRecord(res.data) ?? {}
	return {
		...res,
		data: { ...page, list, totalCount: typeof page.totalCount === 'number' ? page.totalCount : list.length },
	}
}

type CreateOptions = {
	targetSn?: string
	includeClientType?: boolean
}

/**
 * 与 `companion-module-pixelhue-switcher` 协议对齐的 REST 客户端：
 * device-list → open-detail → JWT，随后由 MachineConfig 驱动端点。
 */
export class ApiClient {
	http: HttpClient | null = null
	host: string | null = null
	apiPort: number | null = null
	unicoPort = 19998

	token: string | null = null
	private cfg!: MachineConfig
	private connected = false

	private constructor() {}

	static async create(instance: ModuleInstance, host: string, opts: CreateOptions = {}): Promise<ApiClient> {
		const client = new ApiClient()
		client.host = host
		await client.setup(instance, opts)
		return client
	}

	async setup(instance: ModuleInstance, opts: CreateOptions = {}): Promise<void> {
		const discovery = (await this._getDeviceList(opts.includeClientType ?? false)) as {
			data?: { list?: Array<{ SN: string; modelId?: number; protocols?: Array<{ linkType: string; port?: number }> }> }
		}
		const list = discovery?.data?.list ?? []

		if (list.length === 0) {
			throw new Error('No device found at the configured IP address.')
		}

		const device = opts.targetSn ? list.find((d) => d.SN === opts.targetSn) : list[0]
		if (!device) throw new Error('Target device not found in discovery response.')

		const httpProto = device.protocols?.find((p: { linkType: string }) => p.linkType === 'http')
		if (!httpProto?.port) throw new Error('HTTP protocol/port not found in discovery response.')

		this.apiPort = httpProto.port
		this.cfg = MACHINE_CONFIG

		this.unicoPort = this.cfg.discovery.port
		this.http = new HttpClient(this.host!, this.apiPort)
		instance.log('debug', `Using config: ${JSON.stringify(this.cfg)}`)

		const openDetail = await this._getDeviceOpenDetail()
		const serialNumber = openDetail.data.sn
		const startTime = openDetail.data.startTime
		instance.deviceSn = serialNumber
		this.token = generateToken(serialNumber, String(startTime))
		this.http.setToken(this.token)
		this.connected = true
	}

	async _getDeviceList(includeClientType: boolean = false): Promise<unknown> {
		const url = includeClientType
			? `https://${this.host}:${this.unicoPort}/unico/v1/ucenter/device-list?clientType=8`
			: `https://${this.host}:${this.unicoPort}/unico/v1/ucenter/device-list`
		return got
			.get(url, {
				https: {
					rejectUnauthorized: false,
				},
				timeout: { request: CONNECTION_TIMEOUT_MS },
			})
			.json()
	}

	async _getDeviceOpenDetail(): Promise<{ data: { sn: string; startTime: number } }> {
		return got
			.get(`http://${this.host}:${this.apiPort}/unico/v1/node/open-detail`, {
				timeout: { request: CONNECTION_TIMEOUT_MS },
			})
			.json()
	}

	isConnected(): boolean {
		return this.connected
	}

	markConnected(connected: boolean): void {
		this.connected = connected
	}

	buildHttpUrl(path: string): string {
		return `http://${this.host}:${this.apiPort}${path}`
	}

	// -------------------------------------------------------------------------------------
	// 屏幕切换（companion-module-pixelhue-switcher 协议）
	// -------------------------------------------------------------------------------------

	/**
	 * PUT /unico/v1/screen/take — LCD keyboard 路径（显式 screenId 数组）。
	 * effectSelect=0 使用设备全局激活特效；协议要求提供 switchEffect 字段。
	 */
	async take(screens: Screen[], effectTimeMs: number = 500, instance?: ModuleInstance): Promise<unknown> {
		const body = screens.map((screen) => ({
			screenId: screen.screenId,
			direction: 0,
			effectSelect: 0,
			switchEffect: {
				time: effectTimeMs > 0 ? effectTimeMs : 500,
				type: 1,
			},
			screenName: screen.general?.name ?? '',
		}))
		const path = this.cfg.endpoints.screen.take
		const response = await this.http!.put(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	/** PUT /unico/v1/screen/cut — LCD keyboard 路径（显式 screenId 数组）。 */
	async cut(screens: Screen[], direction: number = 0, instance?: ModuleInstance): Promise<unknown> {
		const body = screens.map((screen) => ({
			screenId: screen.screenId,
			direction: +direction || 0,
			screenName: screen.general?.name ?? '',
		}))
		const path = this.cfg.endpoints.screen.cut
		const response = await this.http!.put(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async ftb(screens: Screen[], enable: boolean, time: number, instance?: ModuleInstance): Promise<unknown> {
		const body = screens.map((screen) => ({
			screenId: screen.screenId,
			ftb: {
				enable: enable ? 1 : 0,
				time,
			},
		}))
		const path = this.cfg.endpoints.screen.ftb
		const response = await this.http!.put(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	/** PUT /unico/v1/screen/selected/ftb  */
	async ftbSelected(enable: boolean, time: number, instance?: ModuleInstance): Promise<unknown> {
		const body = { ftb: { enable: enable ? 1 : 0, time } }
		const path = this.cfg.endpoints.screen.selectedFtb
		const response = await this.http!.put(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async freeze(screens: Screen[], enable: boolean | null): Promise<unknown> {
		const body = screens.map((screen) => {
			const freeze = enable !== null ? (enable ? 1 : 0) : screen.freeze === 1 ? 0 : 1

			return {
				screenId: screen.screenId,
				freeze,
			}
		})

		return this.http!.put(this.cfg.endpoints.screen.freeze, body)
	}

	async selectScreens(screens: Screen[]): Promise<unknown> {
		const body = screens.map((screen) => ({
			screenId: screen.screenId,
			select: screen.select,
			screenName: screen.general.name,
		}))
		return this.http!.put(this.cfg.endpoints.screen.select, body)
	}

	// -------------------------------------------------------------------------------------
	// Preset（场景）
	// -------------------------------------------------------------------------------------

	async loadPreset(preset: Preset, sceneType: number): Promise<unknown> {
		const body: Record<string, unknown> = { sceneType }
		if (preset.presetId != null) body.presetId = preset.presetId
		if (preset.presetIdObj?.id != null) body.id = preset.presetIdObj.id
		const presetName = getPresetName(preset)
		if (presetName) body.presetName = presetName

		const path = this.cfg.endpoints.preset.apply
		return this.http!.put(path, body)
	}

	// -------------------------------------------------------------------------------------
	// 图层
	// -------------------------------------------------------------------------------------

	async selectLayer(layerId: number, instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.layers.select
		const body = [{ layerId, selected: 1 }]
		const response = await this.http!.put(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async bringSelectedTo(layerId: number, to: number): Promise<unknown> {
		const body = [{ layerId, zorder: { type: 1, para: to } }]
		return this.http!.put(this.cfg.endpoints.layers.zorder, body)
	}

	async applyLayerBounds(layerId: number, bounds: LayerBounds): Promise<unknown> {
		const body = [{ layerId, window: bounds }]
		return this.http!.put(this.cfg.endpoints.layers.window, body)
	}

	async applyUMD(layerId: number, umd: LayerUMD[]): Promise<unknown> {
		const body = [{ layerId, UMD: umd }]
		return this.http!.put(this.cfg.endpoints.layers.umd, body)
	}

	async setInputOnLayer(layer: Layer, input: Interface): Promise<unknown> {
		const body = [
			{
				layerId: layer.layerId,
				source: {
					general: {
						sourceId: input.interfaceId,
						sourceType: input.auxiliaryInfo.connectorInfo.interfaceType,
						connectorType: input.auxiliaryInfo.connectorInfo.type,
					},
				},
			},
		]

		return this.http!.put(this.cfg.endpoints.layers.source, body)
	}

	/** S16 actions 使用的便捷封装。 */
	async setLayerSource(
		layerId: string,
		sourceId: string,
		layers: Layer[],
		interfaces: Interface[],
		layerIds: string[] = [layerId],
		instance?: ModuleInstance,
	): Promise<unknown> {
		const input = findLayerSourceInterface(interfaces, sourceId)
		if (!input) throw new Error(`Input not found: ${sourceId}`)

		const ids = Array.from(new Set(layerIds.length > 0 ? layerIds : [layerId]))
		const targetLayers = ids.map((id) => layers.find((item) => String(item.layerId) === id))
		const missingId = ids.find((_, index) => !targetLayers[index])
		if (missingId) throw new Error(`Layer not found: ${missingId}`)

		const body = targetLayers.map((layer) => ({
			layerId: layer!.layerId,
			source: {
				general: {
					sourceId: input.interfaceId,
					sourceType: input.auxiliaryInfo.connectorInfo.interfaceType,
					connectorType: input.auxiliaryInfo.connectorInfo.type,
				},
			},
		}))

		const path = this.cfg.endpoints.layers.source
		const response = await this.http!.put(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	/** BKGD PGM/PVW 源切换 — 仅视频输入接口。 */
	async setBkgdLayerSource(
		layerId: string,
		sourceId: string,
		interfaces: Interface[],
		instance?: ModuleInstance,
	): Promise<unknown> {
		const input = findBkgdSourceInterface(interfaces, sourceId)
		if (!input) throw new Error(`BKGD source not found: ${sourceId}`)

		// LCD setLayerSource：s_LayerSourceArray
		const body = [
			{
				layerId: Number(layerId),
				source: {
					general: {
						sourceId: input.interfaceId,
						sourceType: input.auxiliaryInfo.connectorInfo.interfaceType,
						connectorType: input.auxiliaryInfo.connectorInfo.type,
					},
				},
			},
		]

		const path = this.cfg.endpoints.layers.source
		const response = await this.http!.put(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	// -------------------------------------------------------------------------------------
	// 列表查询
	// -------------------------------------------------------------------------------------

	async getScreens(): Promise<Response<ScreenListDetailData>> {
		const res = await this.http!.get<Response<ScreenListDetailData>>(this.cfg.endpoints.screen.listDetail)
		return withPageList(res, httpPageList(res) as Screen[])
	}

	async getPresets(
		opts: { pushStreamMode?: 1 | 2; sceneType?: 2 | 4; page?: number; limit?: number } = {},
	): Promise<Response<PresetListDetailData>> {
		const params = new URLSearchParams()
		if (opts.pushStreamMode != null) params.set('pushStreamMode', String(opts.pushStreamMode))
		if (opts.sceneType != null) params.set('sceneType', String(opts.sceneType))
		if (opts.page != null) params.set('page', String(opts.page))
		if (opts.limit != null) params.set('limit', String(opts.limit))
		const query = params.toString()
		const path = query ? `${this.cfg.endpoints.preset.list}?${query}` : this.cfg.endpoints.preset.list

		const res = await this.http!.get<Response<PresetListDetailData>>(path)
		return withPageList(res, filterValidPresets(httpPageList(res) as Preset[]))
	}

	async getLayers(): Promise<Response<LayerListDetailData>> {
		const res = await this.http!.get<Response<LayerListDetailData>>(this.cfg.endpoints.layers.listDetail)
		return withPageList(res, httpPageList(res) as Layer[])
	}

	async getLayerDetails(
		params: { layerId?: number | string; type?: number; id?: number; sceneType?: number } = {},
	): Promise<Response<LayerListDetailData>> {
		const search = new URLSearchParams()
		if (params.layerId != null) search.set('layerId', String(params.layerId))
		if (params.type != null) search.set('type', String(params.type))
		if (params.id != null) search.set('id', String(params.id))
		if (params.sceneType != null) search.set('sceneType', String(params.sceneType))
		const query = search.toString()
		const path = query ? `${this.cfg.endpoints.layers.listDetail}?${query}` : this.cfg.endpoints.layers.listDetail
		const res = await this.http!.get<Response<LayerListDetailData>>(path)
		return withPageList(res, httpPageList(res) as Layer[])
	}

	async getLayerThumbs(): Promise<Response<LayerListDetailData>> {
		const res = await this.http!.get<Response<LayerListDetailData>>(this.cfg.endpoints.layers.listThumb)
		return withPageList(res, httpPageList(res) as Layer[])
	}

	async getInterfaces(): Promise<Response<InterfacesListDetailData>> {
		const res = await this.http!.get<Response<InterfacesListDetailData>>(this.cfg.endpoints.layers.interfaces)
		return withPageList(res, httpPageList(res) as Interface[])
	}

	async setLayerStatus(
		layerId: number | string,
		options: { bus?: 'PGM' | 'PVW'; status?: boolean; sceneType?: number },
	): Promise<unknown> {
		return this.http!.put(this.cfg.endpoints.layers.switch, { layerId, ...options })
	}

	/** PUT /unico/v1/layers/switch — 对齐 LCD layerswitch.h（enable 0|1）。 */
	async setLayerSwitch(layerId: number | string, enable: boolean, instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.layers.switch
		const body = [{ layerId: Number(layerId), enable: enable ? 1 : 0 }]
		const response = await this.http!.put(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	/** POST /unico/v1/layers/transition-follow — LCD `s_LayerTransitionFollowArray`。 */
	async setLayerTransitionFollow(layerId: number | string, followTransition: boolean): Promise<unknown> {
		const body = [{ layerId: Number(layerId), enable: followTransition ? 1 : 0 }]
		return this.http!.post('/unico/v1/layers/transition-follow', body)
	}

	async getSwitchEffect(instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.screen.switchEffect
		const response = await this.http!.get(path)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	/** GET /unico/v1/screen/global/active-effect — 当前 TAKE 转场类型（MIX/WIPE/DVE/DIP）。 */
	async getActiveEffectType(instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.screen.activeEffect
		const response = await this.http!.get(path)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	/** POST /unico/v1/screen/global/active-effect  */
	async setActiveEffectType(type: number, instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.screen.activeEffect
		const body = { type }
		const response = await this.http!.post(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	/** GET /unico/v1/node/detail — 含 deviceLayerMode.mode（直控 0 / 跟切 1）。 */
	async getNodeDetail(instance?: ModuleInstance, nodeId?: number): Promise<unknown> {
		const base = this.cfg.endpoints.node.detail
		const path = nodeId != null ? `${base}?nodeId=${nodeId}` : base
		const response = await this.http!.get(path)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async getOutputDisplay(instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.interface.outputDisplay
		const response = await this.http!.get(path)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async setOutputDisplay(
		interfaceId: number | string,
		sourceType: number,
		sourceId: number | string,
		sourceName: string,
		instance?: ModuleInstance,
	): Promise<unknown> {
		const path = this.cfg.endpoints.interface.outputDisplay
		const body = [
			{
				interfaceId: Number(interfaceId),
				sourceType,
				sourceId: Number(sourceId),
				sourceName,
			},
		]
		const response = await this.http!.post(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async setAuxSource(
		interfaceId: number | string,
		sourceType: number,
		sourceId: number | string,
		sourceName: string,
		instance?: ModuleInstance,
	): Promise<unknown> {
		return this.setOutputDisplay(interfaceId, sourceType, sourceId, sourceName, instance)
	}

	async getAuxSource(_auxId: number | string): Promise<unknown> {
		return this.getOutputDisplay()
	}

	async setStreaming(start: boolean, instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.stream.status
		const body = { streamEnable: start ? 1 : 0 }
		const response = await this.http!.post(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async getStreamDetail(instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.stream.detail
		const response = await this.http!.get(path)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async getStreamRealtime(instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.stream.realtime
		const response = await this.http!.get(path)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async setRecording(start: boolean, instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.stream.recordEnable
		// LCD keyboard 将 s_StoragePathDetail.enable 切换为 0/1；Go ReqRecordEnable.enable 为 int。
		const body = { enable: start ? 1 : 0 }
		const response = await this.http!.post(path, body)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async getRecordStatus(instance?: ModuleInstance): Promise<unknown> {
		const path = this.cfg.endpoints.stream.recordInfo
		const response = await this.http!.get(path)
		logHttpResponse(instance, this.buildHttpUrl(path), response)
		return response
	}

	async rawRequest(
		method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
		path: string,
		body?: unknown,
	): Promise<unknown> {
		switch (method) {
			case 'GET':
				return this.http!.get(path)
			case 'POST':
				return this.http!.post(path, body as Record<string, unknown> | undefined)
			case 'PUT':
				return this.http!.put(path, body as Record<string, unknown> | undefined)
			case 'PATCH':
				return this.http!.patch(path, body as Record<string, unknown> | undefined)
			case 'DELETE':
				return this.http!.delete(path)
		}
	}
}
