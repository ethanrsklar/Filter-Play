import { type LunaUnload, Tracer } from "@luna/core";
import { PlayState, redux } from "@luna/lib";

import { clearGesture, getActiveFilter, getRenderedRowIds, takeGesture, trackGestures, type Gesture } from "./dom";
import { findTrackList, resolveFilteredIds } from "./resolve";
import { settings } from "./Settings";

export const { trace } = Tracer("[FilteredPlay]");
export { Settings } from "./Settings";

export const unloads = new Set<LunaUnload>();

/** How recent a click must be to count as the cause of a play action */
const GESTURE_WINDOW_MS = 1500;
/** How long to block Tidal's follow-up queue actions after a takeover */
const FOLLOW_UP_WINDOW_MS = 3000;

const debug = (...args: unknown[]) => {
	if (settings.debug) trace.log(...args);
};

/**
 * A filtered queue this plugin created. While it is active, Tidal's lazy "load the rest of the list"
 * actions for the same source get blocked so the full playlist never sneaks back into the queue.
 */
let session: { context: redux.PlayQueueContext; startedAt: number } | undefined;

const sameContext = (a?: redux.PlayQueueContext, b?: redux.PlayQueueContext) =>
	a !== undefined && b !== undefined && a.type === b.type && String(a.id ?? "") === String(b.id ?? "");

type PlayNowAction = "playQueue/ADD_TRACK_LIST_TO_PLAY_QUEUE" | "playQueue/ADD_NOW";

interface Takeover {
	action: PlayNowAction;
	payload: redux.InterceptPayload<PlayNowAction>;
	gesture: Gesture;
	query: string;
	renderedIds: string[];
}

/**
 * Synchronous check run inside the interceptor. Returns the data needed for a takeover,
 * or undefined to let Tidal handle the action normally.
 */
const shouldTakeOver = (action: PlayNowAction, payload: redux.InterceptPayload<PlayNowAction>): Takeover | undefined => {
	if (!settings.enabled) return undefined;

	const gesture = takeGesture(GESTURE_WINDOW_MS);
	if (gesture === undefined) return undefined;
	if (gesture.kind === "button" && !settings.applyToPlayButtons) return undefined;

	const filter = getActiveFilter();
	if (filter === undefined) return undefined;

	const renderedIds = getRenderedRowIds(filter.root);
	if (gesture.kind === "row" && !renderedIds.includes(gesture.trackId)) return undefined;

	// If Tidal is already queueing only the matching tracks, leave it alone
	if ("mediaItemIds" in payload && payload.mediaItemIds.length <= renderedIds.length) {
		const rendered = new Set(renderedIds);
		if (payload.mediaItemIds.every((id) => rendered.has(String(id)))) return undefined;
	}

	return { action, payload, gesture, query: filter.text, renderedIds };
};

/** Builds the filtered queue and hands it to Tidal. Falls back to the original action on any failure. */
const takeOver = async ({ action, payload, gesture, query, renderedIds }: Takeover) => {
	const fallback = () => {
		session = undefined;
		// redux.actions dispatches through the unpatched action creator, so this does not re-enter the interceptor
		(redux.actions[action] as (p: typeof payload) => unknown)(payload);
	};

	try {
		const trackListName = "trackListName" in payload ? payload.trackListName : undefined;
		const payloadIds = "mediaItemIds" in payload ? payload.mediaItemIds : undefined;
		const clickedId = gesture.kind === "row" ? gesture.trackId : undefined;
		const list = findTrackList(trackListName, payload.context, clickedId);

		const { ids, source } = await resolveFilteredIds({ query, renderedIds, list, context: payload.context, payloadIds });
		debug("Resolved filtered queue", { action, query, source, count: ids.length, rendered: renderedIds.length, trackListName, context: payload.context });

		if (ids.length === 0) return fallback();

		const shuffleButton = gesture.kind === "button" && (gesture.shuffle || ("forceShuffle" in payload && payload.forceShuffle === true));
		let fromIndex = 0;
		if (gesture.kind === "row") {
			fromIndex = ids.findIndex((id) => String(id) === gesture.trackId);
			if (fromIndex === -1) return fallback();
		} else if (shuffleButton) {
			fromIndex = Math.floor(Math.random() * ids.length);
		}

		const shuffleOn = PlayState.shuffle || shuffleButton;
		const shuffleSeed = shuffleOn ? (("shuffleSeed" in payload && payload.shuffleSeed) || Math.floor(Math.random() * 2 ** 31)) : null;

		session = { context: payload.context, startedAt: Date.now() };
		await redux.actions["playQueue/ADD_NOW"]({
			context: payload.context,
			mediaItemIds: ids,
			fromIndex,
			overwritePlayQueue: true,
			shuffleSeed,
		});
		if (shuffleButton && !PlayState.shuffle) PlayState.setShuffle(true, true);

		if (settings.showNotice) trace.msg.log(`Playing ${ids.length} track${ids.length === 1 ? "" : "s"} matching "${query}"`);
	} catch (err) {
		trace.err.withContext("takeOver")(err);
		fallback();
	}
};

const onPlayNow = (action: PlayNowAction, payload: redux.InterceptPayload<PlayNowAction>): true | undefined => {
	const takeover = shouldTakeOver(action, payload);
	if (takeover !== undefined) {
		clearGesture();
		session = { context: payload.context, startedAt: Date.now() };
		takeOver(takeover);
		return true;
	}

	// Tidal follow-ups right after a takeover (the saga behind the click we cancelled)
	if (session && sameContext(session.context, payload.context) && Date.now() - session.startedAt < FOLLOW_UP_WINDOW_MS) {
		debug(`Blocked follow-up ${action}`);
		return true;
	}

	// Anything else that replaces the queue ends the filtered session
	session = undefined;
	return undefined;
};

redux.intercept("playQueue/ADD_TRACK_LIST_TO_PLAY_QUEUE", unloads, (payload) => {
	if (payload.position !== "now") return;
	return onPlayNow("playQueue/ADD_TRACK_LIST_TO_PLAY_QUEUE", payload);
});

redux.intercept("playQueue/ADD_NOW", unloads, (payload) => onPlayNow("playQueue/ADD_NOW", payload));

// Tidal loads big lists in pages and appends the rest as you play. Block that for a filtered queue.
redux.intercept(
	["playQueue/ADD_NOW_REST_OF_TRACK_LIST", "playQueue/FETCH_FIRST_PAGE_AND_ADD_TO_QUEUE", "playQueue/FETCH_REST_OF_THE_TRACKS_AND_ADD_TO_QUEUE"],
	unloads,
	(payload, type) => {
		if (session === undefined || !sameContext(session.context, payload.context)) return;
		// A fresh first-page fetch outside the follow-up window is a new, unfiltered play
		if (type === "playQueue/FETCH_FIRST_PAGE_AND_ADD_TO_QUEUE" && Date.now() - session.startedAt >= FOLLOW_UP_WINDOW_MS) {
			session = undefined;
			return;
		}
		debug(`Blocked ${type} for filtered queue`);
		return true;
	},
);

// Clearing or resetting the queue ends the session
redux.intercept(["playQueue/CLEAR_QUEUE", "playQueue/RESET"], unloads, () => {
	session = undefined;
});

trackGestures(unloads);
unloads.add(() => {
	session = undefined;
});
