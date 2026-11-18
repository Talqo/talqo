import { autoUpdate, computePosition, offset, type Placement, shift } from "@floating-ui/dom"

const MARGIN = 16
const GAP = 12
const MIN_ANCHORED_WIDTH = 640
const PLACEMENTS: Placement[] = ["right-start", "left-start", "bottom-start", "top-start"]

type Rect = { left: number; top: number; right: number; bottom: number }
type Size = { width: number; height: number }
type Point = { x: number; y: number }

function overlaps(first: Rect, second: Rect): boolean {
	return (
		first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
	)
}

function obstacles(excluded: readonly Element[]): DOMRect[] {
	return excluded.flatMap((root) =>
		[root, ...root.children, ...root.querySelectorAll("dialog[open], [popover]")].flatMap((element) =>
			[...element.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0),
		),
	)
}

function apply(panel: HTMLElement, left: number, top: number): void {
	Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" })
}

function corners(panel: HTMLElement): Rect[] {
	const rect = panel.getBoundingClientRect()
	return [
		{ left: innerWidth - rect.width - MARGIN, top: MARGIN, right: innerWidth - MARGIN, bottom: MARGIN + rect.height },
		{ left: MARGIN, top: MARGIN, right: MARGIN + rect.width, bottom: MARGIN + rect.height },
		{
			left: innerWidth - rect.width - MARGIN,
			top: innerHeight - rect.height - MARGIN,
			right: innerWidth - MARGIN,
			bottom: innerHeight - MARGIN,
		},
		{ left: MARGIN, top: innerHeight - rect.height - MARGIN, right: MARGIN + rect.width, bottom: innerHeight - MARGIN },
	]
}

function isFree(corner: Rect, occupied: readonly Rect[]): boolean {
	return occupied.every((other) => !overlaps(corner, other))
}

function isOffscreen(target: HTMLElement, rect: DOMRect): boolean {
	return (
		innerWidth < MIN_ANCHORED_WIDTH ||
		!target.isConnected ||
		rect.bottom <= 0 ||
		rect.top >= innerHeight ||
		rect.right <= 0 ||
		rect.left >= innerWidth
	)
}

function fits(position: Point, size: Size, occupied: readonly Rect[]): boolean {
	return (
		position.x >= MARGIN &&
		position.y >= MARGIN &&
		position.x + size.width <= innerWidth - MARGIN &&
		position.y + size.height <= innerHeight - MARGIN &&
		occupied.every(
			(other) =>
				!overlaps(
					{
						left: position.x,
						top: position.y,
						right: position.x + size.width,
						bottom: position.y + size.height,
					},
					other,
				),
		)
	)
}

function pickPosition(positions: Point[], size: Size, occupied: readonly Rect[]): Point | undefined {
	return positions.find((position) => fits(position, size, occupied))
}

function highlightRect(highlight: HTMLElement, rect: DOMRect): void {
	Object.assign(highlight.style, {
		left: `${rect.left}px`,
		top: `${rect.top}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	})
}

export function anchorPageApproval(
	panel: HTMLElement,
	highlight: HTMLElement,
	target: HTMLElement,
	excluded: readonly Element[],
): () => void {
	let revision = 0
	let disposed = false

	function fixed(): void {
		const occupied = [target.getBoundingClientRect(), ...obstacles(excluded)]
		const rects = corners(panel)
		const corner = rects.find((candidate) => isFree(candidate, occupied)) ?? rects[0]
		if (corner) apply(panel, corner.left, corner.top)
	}

	async function update(): Promise<void> {
		const current = ++revision
		if (disposed) return
		const targetRect = target.getBoundingClientRect()
		highlightRect(highlight, targetRect)
		if (isOffscreen(target, targetRect)) {
			fixed()
			return
		}
		const positions = await Promise.all(
			PLACEMENTS.map((placement) =>
				computePosition(target, panel, {
					placement,
					strategy: "fixed",
					middleware: [offset(GAP), shift({ padding: MARGIN })],
				}),
			),
		)
		if (disposed || current !== revision) return
		const position = pickPosition(positions, panel.getBoundingClientRect(), [
			target.getBoundingClientRect(),
			...obstacles(excluded),
		])
		if (position) apply(panel, position.x, position.y)
		else fixed()
	}

	function schedule(): void {
		void update().catch(() => {
			if (disposed) return
			console.warn("TalqoSDK: approval positioning failed; using fixed controls")
			fixed()
		})
	}

	const cleanup = autoUpdate(target, panel, schedule)
	const observer = new MutationObserver(schedule)
	for (const root of excluded)
		observer.observe(root, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["class", "style", "open", "hidden"],
		})
	return () => {
		disposed = true
		cleanup()
		observer.disconnect()
	}
}
