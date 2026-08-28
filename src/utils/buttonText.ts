/** 超过此长度则缩小字号（15 键 Stream Deck 约一行 10–12 字）。 */
const SHRINK_AFTER_CHARS = 20
const SMALL_FONT_SIZE = 12

export function buttonFontSizeForText(text: string, base = 15): number {
	return text.trim().length > SHRINK_AFTER_CHARS ? SMALL_FONT_SIZE : base
}

export function buttonDisplayFromLabel(label: string, baseSize = 15): { text: string; size: number } {
	const text = label.trim()
	return { text, size: buttonFontSizeForText(text, baseSize) }
}
