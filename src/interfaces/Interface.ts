export interface InterfacesListDetailData {
	totalCount: number
	list: Interface[]
}

export interface Interface {
	auxiliaryInfo: InterfaceAuxiliaryInfo
	general: InterfaceGeneral
	interfaceId: number
	state: number
	linkInfo: LinkInfo
	displayInfo?: InterfaceDisplayInfo
}

export interface InterfaceDisplayInfo {
	sourceType?: number
	sourceId?: number
	sourceName?: string
}

export interface InterfaceGeneral {
	name: string
}

export interface InterfaceAuxiliaryInfo {
	connectorInfo: InterfaceAuxiliaryInfoConnectorInfo
	/** LCD auxiliaryInfo.alias — used for InterSource / Input label translation. */
	alias?: string
}

export interface InterfaceAuxiliaryInfoConnectorInfo {
	interfaceType: number
	type: number
	workMode: number
}

export interface LinkInfo {
	isLink: 0 | 1
	shared?: number
	sourceInfo?: SourceInfo
}

export interface SourceInfo {
	identify: string
	sourceId: number
	sourceType: number
}
