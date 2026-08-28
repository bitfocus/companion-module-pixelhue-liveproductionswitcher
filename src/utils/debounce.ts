/** trailing debounce — 延迟执行，连续触发只保留最后一次 */

export type DebouncedFn = {
	call: () => void
	cancel: () => void
}

/** 单路防抖（如 list-thumb 刷新） */
export function createDebounced(fn: () => void, waitMs: number): DebouncedFn {
	let timer: ReturnType<typeof setTimeout> | null = null
	return {
		call: () => {
			if (timer) clearTimeout(timer)
			timer = setTimeout(() => {
				timer = null
				fn()
			}, waitMs)
		},
		cancel: () => {
			if (timer) {
				clearTimeout(timer)
				timer = null
			}
		},
	}
}

export type KeyedDebouncer<TOwner extends object> = {
	schedule: (owner: TOwner, key: string, fn: () => void) => void
	cancel: (owner: TOwner, key?: string) => void
}

/** 按 owner + key 分桶防抖（如 PGM/PVW/TRANS 总线同步） */
export function createKeyedDebouncer<TOwner extends object>(waitMs: number): KeyedDebouncer<TOwner> {
	const timers = new WeakMap<TOwner, Map<string, ReturnType<typeof setTimeout>>>()
	return {
		schedule(owner, key, fn) {
			let map = timers.get(owner)
			if (!map) {
				map = new Map()
				timers.set(owner, map)
			}
			const existing = map.get(key)
			if (existing) clearTimeout(existing)
			map.set(
				key,
				setTimeout(() => {
					map!.delete(key)
					fn()
				}, waitMs),
			)
		},
		cancel(owner, key) {
			const map = timers.get(owner)
			if (!map) return
			if (key) {
				const existing = map.get(key)
				if (existing) clearTimeout(existing)
				map.delete(key)
				return
			}
			for (const existing of map.values()) clearTimeout(existing)
			map.clear()
		},
	}
}
