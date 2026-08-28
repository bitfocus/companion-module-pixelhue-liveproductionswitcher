export interface LayerListDetailData {
	totalCount: number
	list: Layer[]
}

export interface LayerSelection {
	layerId: number
	selected: 0 | 1
}

export interface Layer {
	layerId: number
	general: LayerGeneral
	source: LayerSource
	selected: 0 | 1
	serial: number
	layerIdObj: LayerIdObj
	window: LayerBounds
	UMD: LayerUMD[]
	enable?: number
}

export interface LayerIdObj {
	attachScreenId: number
	attachScreenType?: number
	id?: number
	sceneType: number
	type?: number
}

export interface LayerGeneral {
	name: string
}

export interface LayerBounds {
	width: number
	height: number
	x: number
	y: number
}

export interface LayerSource {
	general: LayerSourceGeneral
}

export interface LayerSourceGeneral {
	sourceName: string
	sourceId?: number
	sourceType?: number
	connectorType?: number
}

export interface LayerUMD {
	area: number
	enable: 0 | 1
	name: string
	type: number
}
