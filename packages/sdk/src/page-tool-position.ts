import { autoUpdate, computePosition, offset, type Placement, shift } from "@floating-ui/dom"

const MARGIN = 16
const GAP = 12
const MIN_ANCHORED_WIDTH = 640
const PLACEMENTS: Placement[] = ["right-start", "left-start", "bottom-start", "top-start"]

type Rect = { left: number; top: number; right: number; bottom: number }

function overlaps(first: Rect, second: Rect): boolean {
	return (
		first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
	)
}

export function anchorPageApproval(
	panel: HTMLElement,
	highlight: HTMLElement,
	target: HTMLElement,
	excluded: readonly Element[],
): () => void {
	let revision = 0
	let disposed = false

	function obstacles(): DOMRect[] {
		return excluded.flatMap((root) =>
			[root, ...root.children, ...root.querySelectorAll("dialog[open], [popover]")].flatMap((element) =>
				[...element.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0),
			),
		)
	}

	function apply(left: number, top: number): void {
		Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" })
	}

	function fixed(): void {
		const rect = panel.getBoundingClientRect()
		const occupied = [target.getBoundingClientRect(), ...obstacles()]
		const corners = [
			{ left: innerWidth - rect.width - MARGIN, top: MARGIN },
			{ left: MARGIN, top: MARGIN },
			{ left: innerWidth - rect.width - MARGIN, top: innerHeight - rect.height - MARGIN },
			{ left: MARGIN, top: innerHeight - rect.height - MARGIN },
		]
		const corner =
			corners.find(({ left, top }) =>
				occupied.every((other) => !overlaps({ left, top, right: left + rect.width, bottom: top + rect.height }, other)),
			) ?? corners[0]
		if (corner) apply(corner.left, corner.top)
	}

	async function update(): Promise<void> {
		const current = ++revision
		if (disposed) return
		const targetRect = target.getBoundingClientRect()
		Object.assign(highlight.style, {
			left: `${targetRect.left}px`,
			top: `${targetRect.top}px`,
			width: `${targetRect.width}px`,
			height: `${targetRect.height}px`,
		})
		if (
			innerWidth < MIN_ANCHORED_WIDTH ||
			!target.isConnected ||
			targetRect.bottom <= 0 ||
			targetRect.top >= innerHeight ||
			targetRect.right <= 0 ||
			targetRect.left >= innerWidth
		) {
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
		const { width, height } = panel.getBoundingClientRect()
		const occupied = [target.getBoundingClientRect(), ...obstacles()]
		const position = positions.find(
			({ x, y }) =>
				x >= MARGIN &&
				y >= MARGIN &&
				x + width <= innerWidth - MARGIN &&
				y + height <= innerHeight - MARGIN &&
				occupied.every((other) => !overlaps({ left: x, top: y, right: x + width, bottom: y + height }, other)),
		)
		if (position) apply(position.x, position.y)
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
