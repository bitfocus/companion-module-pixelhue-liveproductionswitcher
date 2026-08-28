import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import { ConfigFieldId } from './utils/enum.js'

export interface ModuleConfig {
	/** Device IP address */
	host?: string
}

export class Config {
	public GetConfigFields(): SomeCompanionConfigField[] {
		return [
			{
				type: 'textinput',
				id: ConfigFieldId.Host,
				label: 'IP address',
				width: 6,
				regex: Regex.IP,
			},
		]
	}
}
