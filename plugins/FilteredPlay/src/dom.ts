import type { LunaUnloads } from "@luna/core";

export const ROW_SELECTOR = 'div[data-test="tracklist-row"]';

/** Containers that hold app chrome rather than page content. A filter box never lives in these. */
const CHROME_SELECTORS = [
	'[data-test="main-layout-header"]',
	'[data-test="main-layout-sidebar-wrapper"]',
	'[data-test="footer-player"]',
	'[data-test="search-popover-container"]',
	'[data-test="contextmenu"]',
];
const CHROME_SELECTOR = CHROME_SELECTORS.join(",");

export interface ActiveFilter {
	/** Text typed into the list's filter box */
	text: string;
	/** Smallest element containing both the filter box and the track rows */
	root: Element;
}

const isVisible = (el: HTMLElement) => el.offsetParent !== null || el.getClientRects().length > 0;

/**
 * Finds a non-empty text input that sits on the same page as a tracklist.
 * Tidal keeps the playlist filter text in React state, not Redux, so the DOM is the only reliable source.
 *
 * The test: walk up from each input to the first ancestor that also contains track rows.
 * For a playlist filter box that ancestor is the page body. For the global search bar it is the whole
 * app layout, which also contains the header and sidebar, so it gets rejected.
 */
export const getActiveFilter = (): ActiveFilter | undefined => {
	const inputs = document.querySelectorAll<HTMLInputElement>('input:not([type]), input[type="text"], input[type="search"]');
	for (const input of inputs) {
		const text = input.value.trim();
		if (text === "" || !isVisible(input)) continue;
		if (input.closest(CHROME_SELECTOR) !== null) continue;

		let root: Element | null = input.parentElement;
		while (root !== null && root !== document.body && root.querySelector(ROW_SELECTOR) === null) root = root.parentElement;
		if (root === null || root === document.body || root === document.documentElement) continue;
		if (root.querySelector(CHROME_SELECTOR) !== null) continue;

		return { text, root };
	}
	return undefined;
};

/**
 * Track ids of the rows currently rendered under `root`, in on-screen order.
 * Tidal virtualizes long lists, so this can be a subset of the full filtered result.
 */
export const getRenderedRowIds = (root: Element): string[] => {
	const rows = [...root.querySelectorAll<HTMLElement>(`${ROW_SELECTOR}[data-track-id]`)];
	const withPos = rows.map((row) => {
		const rowIndex = Number(row.getAttribute("aria-rowindex") ?? row.closest("[aria-rowindex]")?.getAttribute("aria-rowindex"));
		return {
			id: row.getAttribute("data-track-id")!,
			pos: Number.isFinite(rowIndex) ? rowIndex : row.getBoundingClientRect().top,
		};
	});
	withPos.sort((a, b) => a.pos - b.pos);
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const { id } of withPos) {
		if (id === "" || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
};

export type Gesture =
	| { kind: "row"; trackId: string; at: number }
	| { kind: "button"; shuffle: boolean; at: number };

let lastGesture: Gesture | undefined;

/** Returns the last user gesture if it happened within `maxAgeMs`. */
export const takeGesture = (maxAgeMs: number): Gesture | undefined => {
	if (lastGesture === undefined || Date.now() - lastGesture.at > maxAgeMs) return undefined;
	return lastGesture;
};
export const clearGesture = () => {
	lastGesture = undefined;
};

const recordGesture = (target: EventTarget | null) => {
	if (!(target instanceof Element)) return;
	if (target.closest('[data-test="footer-player"]') !== null) return;

	const row = target.closest(ROW_SELECTOR);
	const trackId = row?.getAttribute("data-track-id");
	if (row && trackId) {
		lastGesture = { kind: "row", trackId, at: Date.now() };
		return;
	}

	const button = target.closest('button, [role="button"]');
	if (button === null) return;
	const label = [button.getAttribute("data-test"), button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent]
		.filter(Boolean)
		.join(" ");
	lastGesture = { kind: "button", shuffle: /shuffle/i.test(label), at: Date.now() };
};

/** Watches clicks and Enter presses so the queue interceptor knows which row or button started playback. */
export const trackGestures = (unloads: LunaUnloads) => {
	const onPointer = (e: MouseEvent) => recordGesture(e.target);
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") recordGesture(e.target);
	};
	document.addEventListener("click", onPointer, true);
	document.addEventListener("dblclick", onPointer, true);
	document.addEventListener("keydown", onKey, true);
	unloads.add(() => {
		document.removeEventListener("click", onPointer, true);
		document.removeEventListener("dblclick", onPointer, true);
		document.removeEventListener("keydown", onKey, true);
	});
};
