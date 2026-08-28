import type { CompanionStaticUpgradeScript, JsonObject } from '@companion-module/base'
import type { ModuleConfig } from './config.js'

type UpgradeConfig = ModuleConfig & JsonObject

export const UpgradeScripts: CompanionStaticUpgradeScript<UpgradeConfig>[] = []
