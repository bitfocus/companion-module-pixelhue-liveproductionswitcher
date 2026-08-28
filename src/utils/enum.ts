/** Companion action 定义 ID。 */
export enum ActionId {
	Cut = 'cut',
	Take = 'take',
	Ftb = 'ftb',
	SetTransitionMix = 'setTransitionMix',
	SetTransitionWipe = 'setTransitionWipe',
	SetTransitionDve = 'setTransitionDve',
	SetTransitionDip = 'setTransitionDip',
	SetTransitionEffect = 'setTransitionEffect',
	SetProgramSource = 'setProgramSource',
	SetPreviewSource = 'setPreviewSource',
	LoadPreset = 'loadPreset',
	SetAuxSource = 'setAuxSource',
	SelectOutputInterface = 'selectOutputInterface',
	SetStreaming = 'setStreaming',
	SetRecording = 'setRecording',
	LayerControl = 'layerControl',
	SetLayerSource = 'setLayerSource',
}

/** Companion feedback 定义 ID。 */
export enum FeedbackId {
	FtbActive = 'ftbActive',
	StreamingActive = 'streamingActive',
	RecordingActive = 'recordingActive',
	/** Stream 预设：一次回整份 style，避免 boolean overlay 先撕掉再涂色闪黑。 */
	StreamingStyle = 'streamingStyle',
	/** REC 预设：一次回整份 style。 */
	RecordingStyle = 'recordingStyle',
	LayerSelected = 'layerSelected',
	LayerOnAir = 'layerOnAir',
	LayerPreview = 'layerPreview',
	LayerTransitionFollow = 'layerTransitionFollow',
	LayerControlStyle = 'layerControlStyle',
	InputHasSignal = 'inputHasSignal',
	InputUsedByLayer = 'inputUsedByLayer',
	InputOnProgram = 'inputOnProgram',
	InputOnPreview = 'inputOnPreview',
	/** BKGD PGM 预设：信号文本 + 占用背景色（红 / 默认）。 */
	BkgdPgmSourceStyle = 'bkgdPgmSourceStyle',
	/** BKGD PVW 预设：信号亮度 + 占用背景色（绿 / 默认）。 */
	BkgdPvwSourceStyle = 'bkgdPvwSourceStyle',
	OutputInterfaceStyle = 'outputInterfaceStyle',
	OutputSourceStyle = 'outputSourceStyle',
	PresetNameStyle = 'presetNameStyle',
	PresetStyle = 'presetStyle',
	PresetActive = 'presetActive',
	AuxPresetActive = 'auxPresetActive',
	TransitionMixActive = 'transitionMixActive',
	TransitionWipeActive = 'transitionWipeActive',
	TransitionDveActive = 'transitionDveActive',
	TransitionDipActive = 'transitionDipActive',
	/** 匹配当前 TAKE 特效；options.effect 为此按钮选择 MIX/WIPE/DVE/DIP。 */
	TransitionEffectActive = 'transitionEffectActive',
}

/** Companion 变量 ID。 */
export enum VariableId {
	ConnectionStatus = 'connection_status',
	WsConnected = 'ws_connected',
	FtbEnabled = 'ftb_enabled',
	Streaming = 'streaming',
	Recording = 'recording',
	LayerCount = 'layer_count',
	InputCount = 'input_count',
	PresetCount = 'preset_count',
	CurrentPgmPresetId = 'current_pgm_preset_id',
	CurrentPvwPresetId = 'current_pvw_preset_id',
	/** 当前激活 TAKE 特效标签（MIX/WIPE/DVE/DIP），供按钮文本表达式使用。 */
	ActiveTransitionEffect = 'active_transition_effect',
}

/** Companion preset 定义 ID（Display / Stream 固定按钮）。 */
export enum PresetId {
	Cut = 'cut',
	Take = 'take',
	Ftb = 'ftb',
	TransitionMix = 'transitionMix',
	TransitionWipe = 'transitionWipe',
	TransitionDve = 'transitionDve',
	TransitionDip = 'transitionDip',
	Stream = 'stream',
	Rec = 'rec',
}

/** 模块配置字段 ID。 */
export enum ConfigFieldId {
	Host = 'host',
}
