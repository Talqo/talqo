import type { SupportedLanguage } from "./languages"

export const WIDGET_POSITIONS = ["bottom-right", "bottom-left"] as const
export const WIDGET_THEMES = ["system", "light", "dark"] as const

export type WidgetPosition = (typeof WIDGET_POSITIONS)[number]
export type WidgetTheme = (typeof WIDGET_THEMES)[number]

/** The only five colors a widget paints with; nothing else derives a tone or hue from them. */
export type WidgetScheme = {
	primary: string
	textOnPrimary: string
	background: string
	surface: string
	text: string
}

/** Every other widget token derives from one of these five colors in `apps/widget/src/theme/tokens.css`. */
export type WidgetAppearance = {
	light: WidgetScheme
	dark: WidgetScheme
	position: WidgetPosition
	theme: WidgetTheme
	themeToggle: boolean
	language: SupportedLanguage
}

/** As it arrives from an untrusted source; nothing is validated until the widget resolves it. */
export type WidgetSchemeInput = { [K in keyof WidgetScheme]?: unknown }
export type WidgetAppearanceInput = {
	[K in keyof Omit<WidgetAppearance, "light" | "dark">]?: unknown
} & {
	light?: WidgetSchemeInput
	dark?: WidgetSchemeInput
}

export const DEFAULT_LIGHT_SCHEME: WidgetScheme = {
	primary: "#1a7f4b",
	textOnPrimary: "#ffffff",
	background: "#ffffff",
	surface: "#f5f5f5",
	text: "#171717",
}

// An operator input, not derived from light: dark mode gets its own explicit palette.
export const DEFAULT_DARK_SCHEME: WidgetScheme = {
	primary: "#34d399",
	textOnPrimary: "#052e16",
	background: "#0a0a0a",
	surface: "#1a1a1a",
	text: "#fafafa",
}

export const DEFAULT_WIDGET_APPEARANCE: WidgetAppearance = {
	light: DEFAULT_LIGHT_SCHEME,
	dark: DEFAULT_DARK_SCHEME,
	position: "bottom-right",
	theme: "system",
	themeToggle: true,
	language: "en",
}

// Six-digit only: other notations would need normalising before reaching a custom property.
// Exported so the API contract and the dashboard form build on it rather than restate it.
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export const HEX_COLOR_MESSAGE = "Use a six-digit hex color, e.g. #1a7f4b"

export function isHexColor(value: unknown): value is string {
	return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
}

export function isWidgetPosition(value: unknown): value is WidgetPosition {
	return WIDGET_POSITIONS.includes(value as WidgetPosition)
}

export function isWidgetTheme(value: unknown): value is WidgetTheme {
	return WIDGET_THEMES.includes(value as WidgetTheme)
}

const HEX_RADIX = 16
const CHANNEL_MAX = 255
const CHANNEL_OFFSETS = { red: 1, green: 3, blue: 5 } as const
const CHANNEL_LENGTH = 2

const SRGB_LINEAR_THRESHOLD = 0.040_45
const SRGB_LINEAR_DIVISOR = 12.92
const SRGB_GAMMA_OFFSET = 0.055
const SRGB_GAMMA_SCALE = 1.055
const SRGB_GAMMA_EXPONENT = 2.4

const LUMINANCE_RED = 0.2126
const LUMINANCE_GREEN = 0.7152
const LUMINANCE_BLUE = 0.0722

// WCAG 2 adds this to both terms so the ratio stays finite for pure black.
const CONTRAST_OFFSET = 0.05

export const CONTRAST_AA_NORMAL = 4.5

function channel(hex: string, offset: number): number {
	const linear = Number.parseInt(hex.slice(offset, offset + CHANNEL_LENGTH), HEX_RADIX) / CHANNEL_MAX
	return linear <= SRGB_LINEAR_THRESHOLD
		? linear / SRGB_LINEAR_DIVISOR
		: ((linear + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_SCALE) ** SRGB_GAMMA_EXPONENT
}

/** WCAG 2 relative luminance. Assumes a validated six-digit hex. */
export function relativeLuminance(hex: string): number {
	return (
		LUMINANCE_RED * channel(hex, CHANNEL_OFFSETS.red) +
		LUMINANCE_GREEN * channel(hex, CHANNEL_OFFSETS.green) +
		LUMINANCE_BLUE * channel(hex, CHANNEL_OFFSETS.blue)
	)
}

export function contrastRatio(a: string, b: string): number {
	const first = relativeLuminance(a)
	const second = relativeLuminance(b)
	const lighter = Math.max(first, second)
	const darker = Math.min(first, second)
	return (lighter + CONTRAST_OFFSET) / (darker + CONTRAST_OFFSET)
}

/** The widget falls back to defaults on a mismatch, so both sides move together. */
export const WIDGET_CONFIG_VERSION = 2
