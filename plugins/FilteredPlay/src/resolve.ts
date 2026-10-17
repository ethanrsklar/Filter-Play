import { Playlist, redux } from "@luna/lib";

type ItemId = redux.ItemId;
type TItem = redux.Track | redux.Video;

const normalize = (s: string) =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.trim();

/**
 * Mirrors Tidal's list filter: title, version, artist names and album title, case and accent insensitive.
 * Accepts either the whole query in one field or every word somewhere across the fields.
 */
export const itemMatches = (item: TItem | undefined, query: string): boolean => {
	if (item === undefined) return false;
	const fields = [item.title, item.version, item.artist?.name, ...(item.artists ?? []).map((a) => a.name), item.album?.title]
		.filter((f): f is string => typeof f === "string" && f !== "")
		.map(normalize);
	const q = normalize(query);
	if (fields.some((f) => f.includes(q))) return true;
	const haystack = fields.join(" ");
	return q.split(/\s+/).every((term) => haystack.includes(term));
};

/** Finds the Redux track list behind the page being played from. */
export const findTrackList = (trackListName: string | undefined, context: redux.PlayQueueContext, clickedId?: string): redux.List | undefined => {
	const lists = redux.store.getState().content.trackLists ?? {};
	if (trackListName !== undefined && lists[trackListName] !== undefined) return lists[trackListName];

	const contextId = context.id == null ? undefined : String(context.id);
	const candidates = Object.values(lists).filter((list): list is redux.List => list !== undefined);
	if (contextId !== undefined) {
		const byEntity = candidates.find((l) => l.entityId === contextId);
		if (byEntity) return byEntity;
	}
	if (clickedId !== undefined) {
		const byItem = candidates
			.filter((l) => listOrders(l).some((order) => order.some((id) => String(id) === clickedId)))
			.sort((a, b) => b.totalNumberOfItems - a.totalNumberOfItems);
		if (byItem[0]) return byItem[0];
	}
	return undefined;
};

/** Every loaded sort order of a list (default sort, date sort, and any other key Tidal stores). */
export const listOrders = (list: redux.List | undefined): ItemId[][] => {
	if (list === undefined) return [];
	const sorted = list.sorted as unknown as Record<string, redux.ListSortState | undefined>;
	return Object.values(sorted)
		.map((s) => s?.items ?? [])
		.filter((items) => items.length > 0);
};

export const isListFullyLoaded = (list: redux.List | undefined) => {
	if (list === undefined) return false;
	const sorted = list.sorted as unknown as Record<string, redux.ListSortState | undefined>;
	return Object.values(sorted).some((s) => s?.isFullyLoaded);
};

/** True if the ids in `visible` all appear in `order`, in the same relative order. */
const agreesWith = (visible: string[], order: string[]) => {
	const pos = new Map(order.map((id, i) => [id, i] as const));
	let last = -1;
	for (const id of visible) {
		const p = pos.get(id);
		if (p === undefined || p <= last) return false;
		last = p;
	}
	return true;
};

export interface ResolveInput {
	query: string;
	renderedIds: string[];
	list: redux.List | undefined;
	context: redux.PlayQueueContext;
	/** Ids Tidal was about to queue, when the intercepted action carried them */
	payloadIds?: ItemId[];
}

export interface ResolveResult {
	ids: ItemId[];
	source: string;
}

/**
 * Builds the ordered list of track ids that match the filter.
 * Matches against Redux metadata for every loaded item, adds any row Tidal rendered as a match,
 * then orders the result to agree with what is on screen.
 */
export const resolveFilteredIds = async ({ query, renderedIds, list, context, payloadIds }: ResolveInput): Promise<ResolveResult> => {
	const state = redux.store.getState();
	const items = new Map<string, TItem>();
	const original = new Map<string, ItemId>();
	const remember = (id: ItemId) => {
		const key = String(id);
		if (!original.has(key)) original.set(key, id);
		return key;
	};

	const orders: string[][] = listOrders(list).map((order) => order.map(remember));
	if (payloadIds?.length) orders.push(payloadIds.map(remember));

	let source = list ? "redux list" : "rendered rows";

	// Large playlists may not be fully in Redux yet. Pull the full item list from the API.
	if (context.type === "playlist" && context.id != null && !isListFullyLoaded(list)) {
		try {
			const playlist = await Playlist.fromId(context.id);
			const tItems = (await playlist?.tMediaItems()) ?? [];
			if (tItems.length > 0) {
				orders.push(tItems.map((t) => remember(t.item.id)));
				for (const t of tItems) items.set(String(t.item.id), t.item as TItem);
				source = "playlist api";
			}
		} catch {
			// Fall back to whatever is in Redux
		}
	}

	for (const order of orders) {
		for (const key of order) {
			if (items.has(key)) continue;
			const item = state.content.mediaItems?.[key]?.item as TItem | undefined;
			if (item) items.set(key, item);
		}
	}

	const wanted = new Set<string>();
	for (const [key, item] of items) if (itemMatches(item, query)) wanted.add(key);
	for (const id of renderedIds) {
		wanted.add(id);
		remember(/^\d+$/.test(id) ? Number(id) : id);
	}

	const best = orders.find((order) => agreesWith(renderedIds, order));
	let ordered: string[];
	if (best) {
		ordered = best.filter((id) => wanted.has(id));
		const placed = new Set(ordered);
		for (const id of wanted) if (!placed.has(id)) ordered.push(id);
	} else if (wanted.size === renderedIds.length) {
		ordered = renderedIds;
		source = "rendered rows";
	} else {
		ordered = (orders[0] ?? renderedIds).filter((id) => wanted.has(id));
		const placed = new Set(ordered);
		for (const id of renderedIds) if (!placed.has(id)) ordered.push(id);
		source += " (order unverified)";
	}

	return { ids: ordered.map((key) => original.get(key) ?? key), source };
};
