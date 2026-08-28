/**
 * Companion 模块入口 — Pixelhue 制作切换台。
 *
 * 职责：
 * - 连接设备 HTTP API + WebSocket（unico 协议）
 * - 维护运行时状态（屏幕、图层、输入、场景、转场特效、FTB 等）
 * - 注册 Companion actions / feedbacks / variables / presets
 * - 通过 HTTP 快照 + WS 推送驱动 UI 刷新（见 WebSocketHandling.ts）
 */
import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { Config, type ModuleConfig } from './config.js'
import { MACHINE_CONFIG } from './config/machineConfig.js'
import { updateCompanionVariableDefinitions, updateVariableValues } from './variables.js'
import { updateCompanionActions } from './actions.js'
import { presetStyleFeedbackId, updateCompanionFeedbacks } from './feedbacks.js'
import { updateCompanionPresets } from './presets.js'
import { ApiClient } from './services/ApiClient.js'
import { WebSocketClient } from './services/WebSocketClient.js'
import { CONNECTION_TIMEOUT_MS, LAYER_THUMB_REFRESH_DEBOUNCE_MS, RECONNECT_RETRY_MAX_MS, RECONNECT_RETRY_MS, UCENTER_WS_PATH } from './utils/constants.js'
import { createDebounced, type DebouncedFn } from './utils/debounce.js'
import { type DeviceState, emptyDeviceState } from './interfaces/DeviceState.js'
import type { Screen } from './interfaces/Screen.js'
import type { Layer } from './interfaces/Layer.js'
import type { Preset } from './interfaces/Preset.js'
import type { Interface } from './interfaces/Interface.js'
import {
	parseLayerThumbs,
	parsePresets,
	parseRecordEnable,
	parseStreamEnable,
	layerListKey,
} from './utils/stateParsers.js'
import {
	createLayerControlSelection,
	syncSelectedLayerControlFromLayers,
	checkLayerTransitionFollowFeedbacks,
	type SceneLayerDeviceInfo,
} from './utils/layerSelection.js'
import { syncOutputDisplayGroups, syncDeviceInterfaceList, interfaceCatalogKey } from './utils/outputSource.js'
import { BKGD_LAYER_TYPE, BKGD_SOURCE_FEEDBACK_IDS, syncBkgdSourceIdsFromDeviceLayers } from './utils/bkgdSource.js'
import { applyPresetLoadState } from './utils/utils.js'
import { FeedbackId } from './utils/enum.js'
import { parseActiveEffectType, parseSwitchEffect, transitionEffectNameFromType } from './utils/transitionEffect.js'
import {
	applyDeviceLayerMode,
	parseDeviceLayerMode,
	refreshUiAfterDeviceLayerModeChange,
	DEVICE_LAYER_MODE_SWITCHER,
} from './utils/layerSelection.js'
import type { LayerControlMode } from './utils/layerSelectionStyles.js'

export { UpgradeScripts } from './upgrades.js'

/** 主模块实例 — 继承 Companion InstanceBase。 */
export default class ModuleInstance extends InstanceBase {
	// -------------------------------------------------------------------------
	// 配置与客户端
	// -------------------------------------------------------------------------

	/** 用户配置（主机 IP 等） */
	config: ModuleConfig = {}

	/** HTTP API 客户端（REST unico/v1） */
	apiClient: ApiClient | null = null

	/** WebSocket 客户端（实时推送） */
	wsClient: WebSocketClient | null = null

	/** 登录后获得的设备序列号 */
	deviceSn: string | null = null

	/** Companion 连接状态 */
	connectionStatus: InstanceStatus = InstanceStatus.Connecting

	/** WebSocket 是否已连接 */
	wsConnected: boolean = false

	/** FTB（淡入黑场）开关 */
	ftbEnabled: boolean = false

	/** TAKE 后是否交换 PVW/PGM（设备默认行为） */
	swapEnabled = true

	/** 当前转场时长（ms），来自 switch-effect */
	effectTime = 500

	/**
	 * 当前激活的 TAKE 特效类型（SwitchEffect：Cut=0, Mix=1, Dip=2, Wipe=3, Dve=5）。
	 * UI 文案通过 transitionEffectNameFromType() 派生。
	 */
	activeTransitionEffectType = 1

	// -------------------------------------------------------------------------
	// 图层按键 UI 状态（Stream Deck 上的 KEY Edit 键）
	// -------------------------------------------------------------------------

	/** 每个控件的图层模式：select / pgm / nextTransPvw */
	layerControlModeByControlId = new Map<string, LayerControlMode>()

	/**
	 * 设备图层模式：0=直控（Switcher），1=跟切（Director）。
	 * NEXT TRANS/PVW 按键下发与高亮依此分支。
	 */
	deviceLayerMode: number = DEVICE_LAYER_MODE_SWITCHER

	/** 每个控件的 Load Preset「Load In」：PVW / PGM */
	presetLoadBusByControlId = new Map<string, 'PVW' | 'PGM'>()

	/**
	 * Companion 按键上的图层高亮选中集。
	 * select = 单个 layer id；pgm / nextTransPvw = 多选 id 集合。
	 */
	layerControlSelection = createLayerControlSelection()

	/** 每个 Companion 图层对应的 PGM/PVW 设备 layerId（来自 sceneType list-detail） */
	layerSceneDeviceInfo = new Map<string, SceneLayerDeviceInfo>()

	// -------------------------------------------------------------------------
	// list-detail 原始缓存（连接时 HTTP GET）
	// -------------------------------------------------------------------------

	/** GET /screen/list-detail */
	screens: Screen[] = []

	/** GET /layers/list-detail */
	deviceLayers: Layer[] = []

	/** GET /interface/list-detail */
	deviceInterfaces: Interface[] = []

	/** GET /preset/list-detail */
	devicePresets: Preset[] = []

	/** 归一化后的设备状态（inputs、layers、presets 等），由 HTTP 快照 + WS 推送合并 */
	state: DeviceState = emptyDeviceState()

	// -------------------------------------------------------------------------
	// 连接与刷新守卫（私有）
	// -------------------------------------------------------------------------

	/** 连接超时定时器 */
	private connectionTimeout: NodeJS.Timeout | null = null

	/** 单调递增的连接尝试 id — 过期异步结果会被忽略 */
	private connectionAttemptId = 0

	/** 异步任务是否属于已过期的连接尝试（不应再更新状态） */
	private isStaleAttempt(attemptId: number): boolean {
		return attemptId !== this.connectionAttemptId
	}

	/** 仅当 attemptId 仍为当前连接时才执行的 Promise 回调包装 */
	private onAttempt<T>(attemptId: number, fn: (value: T) => void): (value: T) => void {
		return (value) => {
			if (this.isStaleAttempt(attemptId)) return
			fn(value)
		}
	}

	/** 主动关闭 WS 时为 true（避免自动重连） */
	private intentionalDisconnect = false

	/** 防止 WS 断开时并发重连 */
	private reconnectInFlight = false

	/** 断线重连定时器（设备仍在启动时退避重试） */
	private reconnectTimer: NodeJS.Timeout | null = null

	/** 当前重连退避间隔 */
	private reconnectDelayMs = RECONNECT_RETRY_MS

	/** list-thumb 防抖刷新 */
	private readonly debouncedApplyLayerThumb: DebouncedFn

	/** 防止并发 layers HTTP 请求 */
	private thumbRefreshInFlight = false

	constructor(internal: unknown) {
		super(internal)
		this.debouncedApplyLayerThumb = createDebounced(
			() => void this.applyLayerThumbFromDevice(),
			LAYER_THUMB_REFRESH_DEBOUNCE_MS,
		)
	}

	// -------------------------------------------------------------------------
	// Companion 生命周期
	// -------------------------------------------------------------------------

	/** 首次初始化 — 与 config 更新相同 */
	async init(config: ModuleConfig, _isFirstInit: boolean, _secrets?: undefined): Promise<void> {
		await this.configUpdated(config, _secrets)
	}

	/** 模块卸载 — 清理全部资源 */
	async destroy(): Promise<void> {
		this.debouncedApplyLayerThumb.cancel()
		this.cleanup()
		this.log('debug', 'destroy')
	}

	/** 配置变更或请求重连 — host 变化时重新执行完整 HTTP + WS 连接 */
	async configUpdated(config: ModuleConfig, _secrets?: undefined): Promise<void> {
		this.config = {
			...config,
		}

		this.clearConnectionTimeout()
		this.cleanupConnections()
		this.connectionAttemptId++

		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Host is required')
			this.publishEmptyDefinitions()
			return
		}

		void this.runConnection()
	}

	/** 未连接 / 连接失败时清空 action、feedback、variable、preset 定义（与 cleanup 一致） */
	private publishEmptyDefinitions(): void {
		this.setActionDefinitions({})
		this.setFeedbackDefinitions({})
		this.setVariableDefinitions({})
		this.setPresetDefinitions([], {})
	}

	/** 清空设备缓存与归一化状态，避免断线/重连后 presets 重复或残留旧输入。 */
	private resetSessionState(): void {
		this.state = emptyDeviceState()
		this.screens = []
		this.deviceLayers = []
		this.deviceInterfaces = []
		this.devicePresets = []
		this.layerControlSelection = createLayerControlSelection()
		this.layerSceneDeviceInfo.clear()
		this.layerControlModeByControlId.clear()
		this.presetLoadBusByControlId.clear()
	}

	private refreshCompanionUi({
		variableDefinitions,
		variableValues,
		actions,
		feedbackDefinitions,
		presets,
	}: {
		actions?: boolean
		feedbackDefinitions?: boolean
		variableDefinitions?: boolean
		variableValues?: boolean
		presets?: boolean
	}): void {
		if (variableDefinitions) this.updateVariableDefinitions()
		if (variableValues) this.updateVariableValues()
		if (actions) this.updateActions()
		if (feedbackDefinitions) this.updateFeedbacks()
		if (presets) this.updatePresets()
	}

	/** 预设按钮目录（图层/输入/场景/输出 id），用于避免无结构变化时 setPresetDefinitions 闪烁。 */
	private presetCatalogKey(): string {
		return [
			layerListKey(this.state.layers),
			this.state.inputs.map((input) => input.id).join(','),
			this.state.presets.map((preset) => preset.id).join(','),
			this.state.outputs.map((output) => output.id).join(','),
		].join('|')
	}

	/** 带超时的连接编排 */
	private async runConnection(): Promise<void> {
		const attemptId = this.connectionAttemptId
		this.connectionStatus = InstanceStatus.Connecting
		this.updateStatus(InstanceStatus.Connecting)

		this.connectionTimeout = setTimeout(() => {
			if (this.isStaleAttempt(attemptId)) return

			this.connectionTimeout = null
			this.failConnection(`Connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s`)
		}, CONNECTION_TIMEOUT_MS)

		try {
			await this.establishConnection(attemptId)
			if (this.isStaleAttempt(attemptId)) return

			this.clearConnectionTimeout()
			this.connectionStatus = InstanceStatus.Ok
			this.updateStatus(InstanceStatus.Ok)
		} catch (err) {
			if (this.isStaleAttempt(attemptId)) return

			const msg = err instanceof Error ? err.message : String(err)
			this.failConnection(msg)
		}
	}

	/** HTTP 登录 → 打开 WebSocket → 注册 Companion 定义 → HTTP 快照 */
	private async establishConnection(attemptId: number): Promise<void> {
		const apiClient = await ApiClient.create(this, this.config.host!)
		if (this.isStaleAttempt(attemptId)) return

		this.apiClient = apiClient
		const wsClient = await WebSocketClient.create(this, this.config.host!, apiClient.token!)
		this.wsClient = wsClient

		void this.refreshInitialSnapshot(attemptId)
	}

	/** 连接时一次性拉取 list-detail 快照；后续状态由 WebSocket（WebSocketHandling.ts）驱动 */
	async refreshInitialSnapshot(attemptId: number): Promise<void> {
		const client = this.apiClient
		if (!client) return

		const catalogBefore = this.presetCatalogKey()

		await Promise.all([
			// 屏幕：选中、每屏 FTB 开关/时长
			client
				.getScreens()
				.then(
					this.onAttempt(attemptId, (response) => {
						this.screens = response?.data?.list ?? []
					}),
				)
				.catch((err) =>
					this.log(
						'warn',
						`[List] HTTP GET /unico/v1/screen/list-detail failed: ${err instanceof Error ? err.message : err}`,
					),
				),
			// 图层 list-detail（设备图层元数据）
			client
				.getLayers()
				.then(
					this.onAttempt(attemptId, (response) => {
						this.deviceLayers = response.data.list
						if (this.state.layers.length > 0) {
							syncSelectedLayerControlFromLayers(this, this.state.layers)
						}
						if (syncBkgdSourceIdsFromDeviceLayers(this)) {
							this.checkFeedbacks(...BKGD_SOURCE_FEEDBACK_IDS)
						}
					}),
				)
				.catch((err) =>
					this.log(
						'warn',
						`[List] HTTP GET /unico/v1/layers/list-detail failed: ${err instanceof Error ? err.message : err}`,
					),
				),
			// list-thumb — 驱动 state.layers 与按键选中图层
			client
				.getLayerThumbs()
				.then(
					this.onAttempt(attemptId, (response) => {
						syncSelectedLayerControlFromLayers(this, parseLayerThumbs(response))
					}),
				)
				.catch((err) =>
					this.log(
						'warn',
						`[List] HTTP GET /unico/v1/layers/list-thumb failed: ${err instanceof Error ? err.message : err}`,
					),
				),
			// 输入源（PGM/PVW 源列表，供 action 下拉）
			client
				.getInterfaces()
				.then(
					this.onAttempt(attemptId, (response) => {
						syncDeviceInterfaceList(this, response.data.list)
					}),
				)
				.catch((err) =>
					this.log(
						'warn',
						`[List] HTTP GET /unico/v1/interface/list-detail failed: ${err instanceof Error ? err.message : err}`,
					),
				),
			// 场景 preset（加载场景 action + PGM/PVW 场景状态）
			client
				.getPresets()
				.then(
					this.onAttempt(attemptId, (response) => {
						this.devicePresets = response.data.list
						const presets = parsePresets(response)
						this.state.presets = presets
						applyPresetLoadState(this, response.data.list)
					}),
				)
				.catch((err) =>
					this.log(
						'warn',
						`[List] HTTP GET /unico/v1/preset/list-detail failed: ${err instanceof Error ? err.message : err}`,
					),
				),
			this.refreshOutputSnapshot(attemptId),
			this.refreshActiveTransitionEffect(attemptId),
			this.refreshStreamRecordSnapshot(attemptId),
			this.refreshDeviceLayerMode(attemptId),
		])

		if (this.isStaleAttempt(attemptId)) return
		const prevNames = this.state.layers.map((layer) => `${layer.id}:${layer.name}`).join('|')
		if (this.state.layers.length > 0) {
			syncSelectedLayerControlFromLayers(this, this.state.layers)
		}
		const namesChanged =
			prevNames !== this.state.layers.map((layer) => `${layer.id}:${layer.name}`).join('|')
		const catalogChanged = catalogBefore !== this.presetCatalogKey()
		this.refreshCompanionUi({
			variableDefinitions: true,
			variableValues: true,
			actions: true,
			feedbackDefinitions: catalogChanged,
			presets: catalogChanged || namesChanged,
		})
		if (!catalogChanged) {
			this.checkFeedbacks(
				FeedbackId.FtbActive,
				FeedbackId.LayerSelected,
				FeedbackId.LayerOnAir,
				FeedbackId.LayerPreview,
				FeedbackId.LayerControlStyle,
				FeedbackId.InputHasSignal,
				FeedbackId.InputUsedByLayer,
				...BKGD_SOURCE_FEEDBACK_IDS,
			)
			checkLayerTransitionFollowFeedbacks(this)
		}
	}

	/** GET /interface/output-display — 仅拉取可选源目录；当前路由来自 list-detail */
	async refreshOutputSnapshot(attemptId: number): Promise<void> {
		const client = this.apiClient
		if (!client) return
		try {
			const raw = await client.getOutputDisplay(this)
			if (this.isStaleAttempt(attemptId)) return
			syncOutputDisplayGroups(this, raw)
		} catch (err) {
			this.log(
				'warn',
				`[List] HTTP GET /unico/v1/interface/output-display failed: ${err instanceof Error ? err.message : err}`,
			)
		}
	}

	/** GET /node/detail — 缓存 deviceLayerMode（直控 / 跟切）。 */
	async refreshDeviceLayerMode(attemptId: number): Promise<void> {
		const client = this.apiClient
		if (!client) return
		try {
			const raw = await client.getNodeDetail(this)
			if (this.isStaleAttempt(attemptId)) return
			const mode = parseDeviceLayerMode(raw)
			if (mode == null) return
			if (applyDeviceLayerMode(this, mode)) {
				this.log(
					'debug',
					`[S16] deviceLayerMode on connect: ${mode === DEVICE_LAYER_MODE_SWITCHER ? 'switcher' : 'director'} (${mode})`,
				)
				refreshUiAfterDeviceLayerModeChange(this)
			}
		} catch (err) {
			this.log('warn', `[List] HTTP GET /unico/v1/node/detail failed: ${err instanceof Error ? err.message : err}`)
		}
	}

	/** WS 解析失败时，通过 HTTP 刷新 OUTPUT 源路由 */
	async refreshOutputDisplayLive(): Promise<void> {
		await this.refreshInterfacesFromDevice()
	}

	/** HTTP GET interface/list-detail — 刷新输入/输出接口列表与 Source 预设。 */
	async refreshInterfacesFromDevice(): Promise<void> {
		const client = this.apiClient
		if (!client) return
		const attemptId = this.connectionAttemptId
		try {
			const catalogBefore = interfaceCatalogKey(this)
			const response = await client.getInterfaces()
			if (this.isStaleAttempt(attemptId)) return
			syncDeviceInterfaceList(this, response.data.list)
			this.refreshInterfaceCatalogUi(catalogBefore !== interfaceCatalogKey(this))
		} catch (err) {
			this.log(
				'warn',
				`[List] HTTP GET /unico/v1/interface/list-detail refresh failed: ${err instanceof Error ? err.message : err}`,
			)
		}
	}

	private refreshInterfaceCatalogUi(catalogChanged: boolean): void {
		this.refreshCompanionUi({
			variableDefinitions: catalogChanged,
			variableValues: true,
			actions: true,
			feedbackDefinitions: catalogChanged,
			presets: catalogChanged,
		})
		if (!catalogChanged) {
			this.checkFeedbacks(
				FeedbackId.InputHasSignal,
				FeedbackId.InputUsedByLayer,
				FeedbackId.BkgdPgmSourceStyle,
				FeedbackId.BkgdPvwSourceStyle,
				FeedbackId.OutputInterfaceStyle,
				FeedbackId.OutputSourceStyle,
			)
		}
	}

	/**
	 * 连接时读取当前 TAKE 特效，用于 MIX/WIPE/DVE/DIP 高亮。
	 * 优先 GET active-effect；回退 switch-effect.type（液晶 getEffectType 快照）。
	 */
	async refreshActiveTransitionEffect(attemptId: number): Promise<void> {
		const client = this.apiClient
		if (!client) return

		let switchRaw: Record<string, unknown> | undefined
		try {
			const response = await client.getSwitchEffect(this)
			if (this.isStaleAttempt(attemptId)) return
			switchRaw = response as Record<string, unknown>
		} catch (err) {
			this.log('warn', `[HTTP] GET switch-effect failed: ${err instanceof Error ? err.message : err}`)
		}

		let activeType: number | undefined
		try {
			const response = await client.getActiveEffectType(this)
			if (this.isStaleAttempt(attemptId)) return
			activeType = parseActiveEffectType(response)
		} catch {
			// 设备可能不支持 GET active-effect — 使用下方回退
		}

		const switchParsed = switchRaw ? parseSwitchEffect(switchRaw) : {}
		if (activeType == null) {
			activeType = switchParsed.type
		}

		if (activeType == null && switchParsed.timeMs == null) return

		if (activeType != null) {
			const label = transitionEffectNameFromType(activeType) ?? String(activeType)
			this.log('debug', `[S16] Active transition effect on connect: ${label} (type=${activeType})`)
		}

		this.applyActiveTransitionEffect(activeType ?? this.activeTransitionEffectType, switchParsed.timeMs)
	}

	/** 连接时读取推流/录制开关状态 */
	async refreshStreamRecordSnapshot(attemptId: number): Promise<void> {
		const client = this.apiClient
		if (!client) return

		await Promise.all([
			this.refreshBooleanState(
				attemptId,
				async () => client.getStreamDetail(this),
				parseStreamEnable,
				'streaming',
				FeedbackId.StreamingActive,
				MACHINE_CONFIG.endpoints.stream.detail,
			),
			this.refreshBooleanState(
				attemptId,
				async () => client.getRecordStatus(this),
				parseRecordEnable,
				'recording',
				FeedbackId.RecordingActive,
				MACHINE_CONFIG.endpoints.stream.recordInfo,
			),
		])

		if (!this.isStaleAttempt(attemptId)) {
			this.updateVariableValues()
		}
	}

	private async refreshBooleanState(
		attemptId: number,
		request: () => Promise<unknown>,
		parse: (raw: unknown) => boolean | undefined,
		stateKey: 'streaming' | 'recording',
		feedbackId: FeedbackId,
		path: string,
	): Promise<void> {
		try {
			const raw = await request()
			if (this.isStaleAttempt(attemptId)) return
			const value = parse(raw)
			if (value === undefined) return
			if (this.state[stateKey] === value) return
			this.state[stateKey] = value
			this.checkFeedbacks(feedbackId, stateKey === 'streaming' ? FeedbackId.StreamingStyle : FeedbackId.RecordingStyle)
		} catch (err) {
			this.log('warn', `[HTTP] GET ${path} failed: ${err instanceof Error ? err.message : err}`)
		}
	}

	/**
	 * 更新内存中的激活转场特效，并刷新 MIX/WIPE/DVE/DIP UI。
	 * 由 HTTP 刷新、WS PutActiveEffectType、SetTransition* action 调用。
	 */
	applyActiveTransitionEffect(type: number, timeMs?: number): void {
		this.activeTransitionEffectType = type
		if (timeMs != null && timeMs > 0) this.effectTime = timeMs
		this.checkFeedbacks(
			FeedbackId.TransitionMixActive,
			FeedbackId.TransitionWipeActive,
			FeedbackId.TransitionDveActive,
			FeedbackId.TransitionDipActive,
			FeedbackId.TransitionEffectActive,
		)
		this.updateVariableValues()
	}

	/** 防抖 list-thumb 刷新入口（WS 图层事件触发） */
	refreshLayerThumbState(): void {
		this.debouncedApplyLayerThumb.call()
	}

	/** GET /layers/list-thumb；更新 KEY/DSK 列表与 KEY Edit 高亮 */
	async applyLayerThumbFromDevice(): Promise<void> {
		if (this.thumbRefreshInFlight) return
		const client = this.apiClient
		if (!client) return

		this.thumbRefreshInFlight = true
		try {
			const response = await client.getLayerThumbs()
			const prevKey = layerListKey(this.state.layers)
			const prevNames = this.state.layers.map((layer) => `${layer.id}:${layer.name}`).join('|')
			syncSelectedLayerControlFromLayers(this, parseLayerThumbs(response))

			const structureChanged = prevKey !== layerListKey(this.state.layers)
			const namesChanged = prevNames !== this.state.layers.map((layer) => `${layer.id}:${layer.name}`).join('|')
			if (structureChanged) {
				this.updateVariableDefinitions()
			}
			this.refreshCompanionUi({
				actions: structureChanged,
				variableValues: true,
				presets: structureChanged || namesChanged,
			})
			this.checkFeedbacks(FeedbackId.LayerSelected, FeedbackId.LayerOnAir, FeedbackId.LayerPreview)
			checkLayerTransitionFollowFeedbacks(this)
		} catch (err) {
			this.log('warn', `[List] layer thumb refresh failed: ${err instanceof Error ? err.message : err}`)
		} finally {
			this.thumbRefreshInFlight = false
		}
	}

	/** 重新拉取场景状态；区分选中态、改名与结构刷新路径 */
	async refreshPresetSnapshot(refreshKind: 'state' | 'names' | 'structure' = 'state'): Promise<void> {
		const client = this.apiClient
		if (!client) return

		try {
			const previousNames = new Map(this.state.presets.map((preset) => [preset.id, preset.name]))
			const response = await client.getPresets()
			this.devicePresets = response.data.list
			this.state.presets = parsePresets(response)
			applyPresetLoadState(this, response.data.list)
			if (refreshKind === 'structure') {
				this.refreshCompanionUi({
					variableDefinitions: true,
					variableValues: true,
					actions: true,
					feedbackDefinitions: true,
					presets: true,
				})
			} else {
				const renamedFeedbacks = this.state.presets
					.filter((preset) => previousNames.get(preset.id) !== preset.name)
					.map((preset) => presetStyleFeedbackId(preset.id))
				if (renamedFeedbacks.length === 0) return
				this.updateVariableValues()
				if (refreshKind === 'names') this.updateActions()
				this.checkFeedbacks(FeedbackId.PresetNameStyle, ...renamedFeedbacks)
			}
		} catch (err) {
			this.log('warn', `[List] preset refresh failed: ${err instanceof Error ? err.message : err}`)
		}
	}

	private clearConnectionTimeout(): void {
		if (this.connectionTimeout) {
			clearTimeout(this.connectionTimeout)
			this.connectionTimeout = null
		}
	}

	/** WS 已连接 — 打日志、标记 OK、刷新变量 */
	onWebSocketConnected(): void {
		this.log(
			'info',
			`WebSocket connected to wss://${this.config.host}:19998${UCENTER_WS_PATH} (device SN: ${this.deviceSn ?? 'unknown'})`,
		)
		this.wsConnected = true
		this.apiClient?.markConnected(true)
		this.reconnectDelayMs = RECONNECT_RETRY_MS
		this.connectionStatus = InstanceStatus.Ok
		this.updateStatus(InstanceStatus.Ok)
		this.updateVariableValues()
	}

	/** WS 断开 — 更新断开状态或自动重连 */
	onWebSocketDisconnected(): void {
		this.log('debug', `WebSocket disconnected from wss://${this.config.host}:19998${UCENTER_WS_PATH}`)
		this.wsConnected = false
		this.apiClient?.markConnected(false)
		this.updateVariableValues()

		if (this.intentionalDisconnect || !this.config.host) return

		this.dropSession('WebSocket disconnected')
		void this.reconnectWebSocket()
	}

	/** HTTP/WS 初始化失败 — 模块保持存活以便编辑配置页 */
	failConnection(message?: string): void {
		this.clearConnectionTimeout()
		this.connectionStatus = InstanceStatus.ConnectionFailure

		if (message) {
			this.log('error', `Initialization failed: ${message}`)
		}
		this.updateStatus(InstanceStatus.ConnectionFailure, message)
		this.cleanupConnections()
		this.publishEmptyDefinitions()
	}

	/** 外部错误钩子 — 递增 attempt id 并标记连接失败 */
	error(message?: string): void {
		this.connectionAttemptId++
		this.failConnection(message)
	}

	/** destroy 时完整清理 */
	cleanup(): void {
		this.clearConnectionTimeout()
		this.clearReconnectTimer()
		this.cleanupConnections()

		this.setActionDefinitions({})
		this.setFeedbackDefinitions({})
		this.setVariableDefinitions({})
		this.setPresetDefinitions([], {})
	}

	/** 关闭 WS 并清空客户端与 list 缓存 */
	private cleanupConnections(): void {
		this.clearReconnectTimer()
		this.intentionalDisconnect = true
		this.wsClient?.disconnect()
		this.wsClient = null
		this.intentionalDisconnect = false
		this.apiClient = null
		this.wsConnected = false
		this.reconnectInFlight = false
		this.deviceSn = null
		this.deviceLayerMode = DEVICE_LAYER_MODE_SWITCHER
		this.resetSessionState()
	}

	/** 丢弃当前会话（旧 token / 半开 WS），保留自动重连。 */
	private dropSession(statusMessage: string): void {
		this.wsConnected = false
		this.intentionalDisconnect = true
		this.wsClient?.disconnect()
		this.wsClient = null
		this.intentionalDisconnect = false
		this.apiClient = null
		this.resetSessionState()
		this.publishEmptyDefinitions()
		this.connectionStatus = InstanceStatus.Disconnected
		this.updateStatus(InstanceStatus.Disconnected, statusMessage)
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
	}

	private scheduleReconnect(reason: string): void {
		if (this.intentionalDisconnect || !this.config.host || this.reconnectTimer || this.reconnectInFlight) return
		this.log('debug', `Scheduling reconnect in ${this.reconnectDelayMs}ms (${reason})`)
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			void this.reconnectWebSocket()
		}, this.reconnectDelayMs)
		this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_RETRY_MAX_MS)
	}

	/** WS/HTTP 重连 — 重建 apiClient 以获取新 token，再连 WS；失败则退避重试。 */
	private async reconnectWebSocket(): Promise<void> {
		if (this.reconnectInFlight || this.intentionalDisconnect || !this.config.host) return
		this.clearReconnectTimer()
		this.reconnectInFlight = true
		const attemptId = this.connectionAttemptId

		try {
			this.log('debug', 'Reconnecting: recreating HTTP client for new token...')
			const apiClient = await ApiClient.create(this, this.config.host)
			if (this.isStaleAttempt(attemptId) || this.intentionalDisconnect) return

			this.apiClient = apiClient
			this.log('debug', 'HTTP client recreated, token updated')

			const wsClient = await WebSocketClient.create(this, this.config.host, apiClient.token!)
			if (this.isStaleAttempt(attemptId) || this.intentionalDisconnect || !this.apiClient) return

			this.wsClient = wsClient
			this.reconnectDelayMs = RECONNECT_RETRY_MS
			this.log('debug', 'WebSocket reconnected with new token')
			void this.refreshInitialSnapshot(attemptId)
		} catch (err) {
			this.log('warn', `Reconnection failed: ${err instanceof Error ? err.message : String(err)}`)
			this.reconnectInFlight = false
			this.scheduleReconnect('login failed')
			return
		} finally {
			this.reconnectInFlight = false
		}
	}

	/** Companion 配置页字段 */
	getConfigFields(): SomeCompanionConfigField[] {
		return new Config().GetConfigFields()
	}

	updateActions(): void {
		updateCompanionActions(this)
	}

	updateFeedbacks(): void {
		updateCompanionFeedbacks(this)
	}

	updateVariableDefinitions(): void {
		updateCompanionVariableDefinitions(this)
	}

	updatePresets(): void {
		updateCompanionPresets(this)
	}

	updateVariableValues(): void {
		updateVariableValues(this)
	}

	/** 从 list-detail 刷新 BKGD 图层缓存（type=Bkgd） */
	async refreshBkgdLayerSnapshot(): Promise<void> {
		const client = this.apiClient
		if (!client) return

		try {
			const response = await client.getLayerDetails({ type: BKGD_LAYER_TYPE })
			const bkgdLayers = response.data?.list ?? []
			this.deviceLayers = [
				...this.deviceLayers.filter((layer) => layer.layerIdObj.type !== BKGD_LAYER_TYPE),
				...bkgdLayers,
			]
			const changed = syncBkgdSourceIdsFromDeviceLayers(this)
			if (changed) {
				this.checkFeedbacks(...BKGD_SOURCE_FEEDBACK_IDS)
			}
		} catch (err) {
			this.log('warn', `[List] BKGD layer refresh failed: ${err instanceof Error ? err.message : err}`)
		}
	}
}
