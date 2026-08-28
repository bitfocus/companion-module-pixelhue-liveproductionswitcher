import { combineRgb } from '@companion-module/base'

export const PRESET_CATEGORY = {
	CONTROL: 'Control',
	STREAM_RECORD: 'Stream / Record',
	DEBUG: '[Debug]',
} as const

export const CONNECTION_TIMEOUT_MS = 20_000
/** WebSocket 协议层 ping 间隔；设备断电后半开连接靠收不到 pong 发现。 */
export const WS_PING_INTERVAL_MS = 10_000
/** 发出 ping 后等待 pong 的超时。 */
export const WS_PONG_TIMEOUT_MS = 8_000
/** 断线后首次重连间隔。 */
export const RECONNECT_RETRY_MS = 2_000
/** 重连退避上限。 */
export const RECONNECT_RETRY_MAX_MS = 15_000

/** ucenter WebSocket `client-type` 查询参数（S16 / DB4K 使用 11）。 */
export const UCENTER_WS_CLIENT_TYPE = 11

export const UCENTER_WS_PATH = `/unico/v1/ucenter/ws?client-type=${UCENTER_WS_CLIENT_TYPE}`

export const WHITE = combineRgb(255, 255, 255)
export const BLACK = combineRgb(0, 0, 0)
export const GRAY = combineRgb(64, 64, 64)
export const RED = combineRgb(204, 0, 0)
export const GREEN = combineRgb(0, 153, 0)
export const BLUE = combineRgb(0, 102, 204)
export const PURPLE = combineRgb(170, 85, 204)
export const YELLOW = combineRgb(255, 255, 0)
export const ORANGE = combineRgb(255, 165, 0)
export const PINK = combineRgb(255, 192, 203)
export const BROWN = combineRgb(165, 42, 42)
export const LIGHT_GRAY = combineRgb(200, 200, 200)
export const DARK_GRAY = combineRgb(50, 50, 50)

export const KEY_TYPE_UPSTREAM = 1024
export const KEY_TYPE_DOWNSTREAM = 2048
/** LCD LayerType::Bkgd (1 << 13)，BKGD PGM/PVW 源切换用。 */
export const KEY_TYPE_BKGD = 8192

export const BUS_SYNC_DEBOUNCE_MS = 200
/** list-thumb 刷新防抖（WS PutLayers 等） */
export const LAYER_THUMB_REFRESH_DEBOUNCE_MS = 300
/** FTB 淡入淡出默认时长（ms），对齐协议 screenftbprotometa */
export const FTB_DEFAULT_TIME_MS = 700
/** Stream / REC 预设：长按后才下发协议，1500ms。 */
export const STREAM_RECORD_HOLD_MS = 1500

// ------------------------------- 图层（0x0008xxxx） -------------------------------
export const PutLayers = 0x00081100 // 图层列表
export const PutLayerSelect = 0x00081105 // 图层选中
export const PutLayersSource = 0x0008110a // 图层源信息（换源）
export const PutLayersGeneral = 0x00081109 // 图层基本信息（含名称）
export const PutLayerSwitch = 0x0008111a // 图层开关（onair / PVW）
export const PutLayerTransitionFollow = 0x0008112f // 图层转场跟随（下一次转场开关）

// ------------------------------- 接口 / 输入源（0x0006xxxx） -------------------------------
export const PutInterfaceDetail = 0x00061100 // 接口详情上报
export const PutInterfaceGeneral = 0x00061102 // 接口通用功能上报（含重命名）
export const GetInterfaceActualInfo = 0x00061115 // 接口 actual 上报，接口真实数据（信号状态）
export const PutInterfaceSetOutputDisplay = 0x00061123 // 输出接口当前内容（切源结果）
export const PutInterfaceOutputDisplay = 0x00061127 // 输出接口可选源列表变更
export const PutInterfaceCurrentSource = 0x00062501 // 纯发送切源

// ------------------------------- 场景 / Preset（0x000Axxxx） -------------------------------
export const GetPresetDetail = 0x000a2100 // 场景信息（列表）
export const PutPresetCreate = 0x000a2101 // 场景创建
export const PutPresetGeneral = 0x000a2105 // 场景基本信息（重命名等）
export const DeletePreset = 0x000a2106 // 场景删除
export const PutPresetPlay = 0x000a2203 // 场景应用（加载到 PGM/PVW）

// ------------------------------- 屏幕 / 转场（0x0007xxxx） -------------------------------
export const UnicoTagScreenFtb = 0x00071114 // 屏幕 FTB
export const PutSelectedScreenFtb = 0x00071206 // 屏幕 FTB 动作
export const PutSwitchEffect = 0x00071205 // 设置切换特效参数
export const PutActiveEffectType = 0x00071209 // 切换激活特效（TAKE 使用）
export const UnicoTagScreenTake = 0x00071302 // 屏幕 take
export const UnicoTagScreenTBar = 0x00071303 // 屏幕 tbar
export const UnicoTagScreenCut = 0x00071304 // 屏幕 cut

// ------------------------------- 推流 / 录制（0x0041xxxx / 0x0042xxxx） -------------------------------
export const PutStreamStatus = 0x00410002 // 设置推流总开关
export const PutRecordEnable = 0x00420002 // 设置录制开关

// ------------------------------- 音频（0x0006 37xx） -------------------------------
export const GetAudioList = 0x00063700 // 获取音频列表
export const SetAudioOverdub = 0x00063701 // 设置音频混音
export const SetAudioSolo = 0x00063702 // 设置音频 solo
export const SetAudioBaseInfo = 0x00063703 // 设置音频基础信息（level/gain）
export const SetAudioSeparation = 0x00063704 // 设置音频分离

// ------------------------------- 节点（0x0005xxxx） -------------------------------
export const PutNodeDeviceLayerMode = 0x00050141 // 设备图层模式（直控 / 跟切）

// ------------------------------- ucenter 协议层（非 unicotag 业务） -------------------------------
export const UcenterHeartbeat = 0x00101602 // ucenter 心跳/应答，无业务数据

export const TAG_NAMES: Record<number, string> = {
	[PutLayers]: 'PutLayers',
	[PutLayerSelect]: 'PutLayerSelect',
	[PutLayersSource]: 'PutLayersSource',
	[PutLayersGeneral]: 'PutLayersGeneral',
	[PutLayerSwitch]: 'PutLayerSwitch',
	[PutLayerTransitionFollow]: 'PutLayerTransitionFollow',
	[PutInterfaceDetail]: 'PutInterfaceDetail',
	[PutInterfaceGeneral]: 'PutInterfaceGeneral',
	[GetInterfaceActualInfo]: 'GetInterfaceActualInfo',
	[PutInterfaceSetOutputDisplay]: 'PutInterfaceSetOutputDisplay',
	[PutInterfaceOutputDisplay]: 'PutInterfaceOutputDisplay',
	[PutInterfaceCurrentSource]: 'PutInterfaceCurrentSource',
	[GetPresetDetail]: 'GetPresetDetail',
	[PutPresetCreate]: 'PutPresetCreate',
	[PutPresetGeneral]: 'PutPresetGeneral',
	[DeletePreset]: 'DeletePreset',
	[PutPresetPlay]: 'PutPresetPlay',
	[UnicoTagScreenFtb]: 'UnicoTagScreenFtb',
	[PutSelectedScreenFtb]: 'PutSelectedScreenFtb',
	[PutSwitchEffect]: 'PutSwitchEffect',
	[PutActiveEffectType]: 'PutActiveEffectType',
	[UnicoTagScreenTake]: 'UnicoTagScreenTake',
	[UnicoTagScreenTBar]: 'UnicoTagScreenTBar',
	[UnicoTagScreenCut]: 'UnicoTagScreenCut',
	[PutStreamStatus]: 'PutStreamStatus',
	[PutRecordEnable]: 'PutRecordEnable',
	[GetAudioList]: 'GetAudioList',
	[SetAudioOverdub]: 'SetAudioOverdub',
	[SetAudioSolo]: 'SetAudioSolo',
	[SetAudioBaseInfo]: 'SetAudioBaseInfo',
	[SetAudioSeparation]: 'SetAudioSeparation',
	[PutNodeDeviceLayerMode]: 'PutNodeDeviceLayerMode',
	[UcenterHeartbeat]: 'UcenterHeartbeat',
}
