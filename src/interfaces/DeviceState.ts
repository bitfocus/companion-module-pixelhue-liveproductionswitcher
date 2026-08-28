export interface S16ListItem {
	id: string
	name: string
	raw?: unknown
}

/** 图层状态：selected=选中态，onAir=PGM开关，preview=PVW开关，transitionFollow=下一次转场跟�?*/
export interface S16LayerState extends S16ListItem {
	selected: boolean
	onAir: boolean
	preview: boolean
	transitionFollow: boolean
	sceneType?: number
	keyType?: 'upstream' | 'downstream' | 'bkgd' | 'transition'
	keyIndex?: number
	sourceLayerIds?: string[]
	sourceId?: string
}

export interface S16InputState extends S16ListItem {
	hasSignal: boolean
	resolution?: string
}

export interface S16AuxState extends S16ListItem {
	sourceId?: string
}

export interface S16OutputInterfaceState extends S16ListItem {
	interfaceType: number
	online?: boolean
	displaySourceType?: number
	displaySourceId?: string
	displaySourceName?: string
}

export interface S16OutputDisplaySourceState extends S16ListItem {
	sourceType: number
	sourceId: string
	hasSignal: boolean
}

export interface OutputDisplayGroup {
	sourceType: number
	sourceInfo: Array<{ sourceId: number; sourceName: string }>
}

export interface S16PresetState extends S16ListItem {
	saved: boolean
	presetId?: number
	/** presetIdObj.playType�?=未加�?2=PGM 4=PVW 6=PGM+PVW */
	playType?: number
	/** 场景序号，来�?presetIdObj.id，仅用于排序 */
	sortIndex?: number
	lastLoadedBus?: 'PVW' | 'PGM' | 'AUX'
}

export interface DeviceState {
	raw: unknown
	inputs: S16InputState[]
	auxes: S16AuxState[]
	outputs: S16OutputInterfaceState[]
	/** Currently selected output interface for OUTPUT Source presets. */
	selectedOutputInterfaceId?: string
	/** Cached GET /interface/output-display displayInfos (raw groups). */
	outputDisplayGroups: OutputDisplayGroup[]
	layers: S16LayerState[]
	presets: S16PresetState[]
	programSourceId?: string
	previewSourceId?: string
	streaming: boolean
	recording: boolean
	currentPgmPresetId?: string
	currentPvwPresetId?: string
	currentAuxPresetId?: string
}

export const emptyDeviceState = (): DeviceState => ({
	raw: undefined,
	inputs: [],
	auxes: Array.from({ length: 12 }, (_, index) => ({
		id: String(index + 1),
		name: `AUX ${index + 1}`,
	})),
	outputs: [],
	outputDisplayGroups: [],
	layers: [],
	presets: [],
	streaming: false,
	recording: false,
})
