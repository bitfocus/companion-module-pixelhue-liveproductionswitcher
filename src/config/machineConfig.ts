export interface MachineConfig {
	protocol: 'http' | 'https'
	apiPortStrategy: 'fromDeviceListHttpProtocol' | 'fixed'
	fixedApiPort?: number
	discovery: {
		protocol: 'http' | 'https'
		port: number
		httpsRejectUnauthorized?: boolean
	}
	basePath: string
	endpoints: {
		screen: {
			take: string
			selectedTake: string
			cut: string
			selectedCut: string
			ftb: string
			selectedFtb: string
			freeze: string
			select: string
			listDetail: string
			testPattern: string
			tbar: string
			switchEffect: string
			activeEffect: string
		}
		preset: {
			list: string
			apply: string
		}
		layers: {
			source: string
			listDetail: string
			listThumb: string
			select: string
			switch: string
			zorder: string
			window: string
			umd: string
			layerPresetListDetail: string
			layerPresetApply: string
			interfaces: string
			cropSource: string
		}
		crtl: {
			sourceBackup: string
		}
		stream: {
			status: string
			detail: string
			realtime: string
			recordEnable: string
			recordInfo: string
		}
		interface: {
			outputDisplay: string
		}
		node: {
			detail: string
		}
	}
}

export const MACHINE_CONFIG: MachineConfig = {
	protocol: 'http',
	apiPortStrategy: 'fromDeviceListHttpProtocol',
	discovery: { protocol: 'https', port: 19998, httpsRejectUnauthorized: false },
	basePath: '/unico/v1',
	endpoints: {
		screen: {
			take: '/unico/v1/screen/take',
			selectedTake: '/unico/v1/screen/selected/take',
			cut: '/unico/v1/screen/cut',
			selectedCut: '/unico/v1/screen/selected/cut',
			ftb: '/unico/v1/screen/ftb',
			selectedFtb: '/unico/v1/screen/selected/ftb',
			freeze: '/unico/v1/screen/freeze',
			select: '/unico/v1/screen/select',
			listDetail: '/unico/v1/screen/list-detail',
			testPattern: '/unico/v1/screen/test-pattern',
			tbar: '/unico/v1/ucenter/screen/tbar',
			switchEffect: '/unico/v1/screen/global/switch-effect',
			activeEffect: '/unico/v1/screen/global/active-effect',
		},
		preset: {
			list: '/unico/v1/preset/list-detail',
			apply: '/unico/v1/preset/play',
		},
		layers: {
			source: '/unico/v1/layers/source',
			listDetail: '/unico/v1/layers/list-detail',
			listThumb: '/unico/v1/layers/list-thumb',
			select: '/unico/v1/layers/select',
			switch: '/unico/v1/layers/switch',
			zorder: '/unico/v1/layers/zorder',
			window: '/unico/v1/layers/window',
			umd: '/unico/v1/layers/umd',
			layerPresetListDetail: '/unico/v1/layers/layer-preset/list-detail',
			layerPresetApply: '/unico/v1/layers/layer-preset/apply',
			interfaces: '/unico/v1/interface/list-detail',
			cropSource: '/unico/v1/interface/crop-source',
		},
		crtl: {
			sourceBackup: '/unico/v1/system/ctrl/source-backup',
		},
		stream: {
			status: '/unico/v1/stream/status',
			detail: '/unico/v1/stream/detail',
			realtime: '/unico/v1/stream/realtime',
			recordEnable: '/unico/v1/stream/record/enable',
			recordInfo: '/unico/v1/stream/record/info',
		},
		interface: {
			outputDisplay: '/unico/v1/interface/output-display',
		},
		node: {
			detail: '/unico/v1/node/detail',
		},
	},
}
