export function setRect(element: Element, left: number, top: number, width = 40, height = 20) {
	Object.defineProperty(element, "getBoundingClientRect", {
		configurable: true,
		value: () => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top }),
	})
}
