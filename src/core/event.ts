// Events: things that span days (a trip, a conference). Each is its own note:
//
//   Daybook/Events/Germany.md
//   ---
//   start: 2026-03-01
//   end: 2026-03-05
//   category: travel
//   ---
//
//   ## Notes
//
// An event can repeat: "repeats: yearly" (or weekly, every 2 weeks, monthly)
// with an optional "until: 2028-12-31". Each occurrence keeps the event's
// length. Events never write into day notes; views look them up by date.

import { DateKey, addDays, addMonthsToKey, compareKeys, isDateKey } from "./dates";
import {
	hasYamlKey,
	joinFrontmatter,
	readSection,
	readYamlString,
	removeYamlKey,
	setYamlKey,
	splitFrontmatter,
	writeSection,
	yamlStringLines,
} from "./markdown";
import { Category } from "./types";

/** How an event repeats: every n weeks, months or years. */
export interface EventRepeat {
	unit: "week" | "month" | "year";
	n: number;
}

export interface DayEvent {
	/** File name without ".md"; also the event's title. */
	name: string;
	/** For a repeating event's occurrence, the dates of that occurrence. */
	start: DateKey;
	end: DateKey;
	/** Category tag (from settings), or "". */
	category: string;
	/** Repeats, or null for a one-off event. */
	repeats?: EventRepeat | null;
	/** Last day an occurrence may start, or "" for no end. */
	until?: DateKey;
	/** On an occurrence: the event's own (first) dates, used when editing the series. */
	series?: { start: DateKey; end: DateKey };
}

export function parseRepeat(raw: string): EventRepeat | null {
	const s = raw.trim().toLowerCase();
	if (s === "weekly") return { unit: "week", n: 1 };
	if (s === "monthly") return { unit: "month", n: 1 };
	if (s === "yearly" || s === "annually") return { unit: "year", n: 1 };
	const m = /^every (\d+) (weeks?|months?|years?)$/.exec(s);
	if (!m || Number(m[1]) < 1) return null;
	return { unit: m[2]!.replace(/s$/, "") as EventRepeat["unit"], n: Number(m[1]) };
}

export function formatRepeat(r: EventRepeat): string {
	if (r.n === 1) return r.unit === "week" ? "weekly" : r.unit === "month" ? "monthly" : "yearly";
	return `every ${r.n} ${r.unit}s`;
}

export const EVENT_NOTES_HEADING = "Notes";

/** From a note's text (used when writing). */
export function parseEvent(name: string, text: string): DayEvent | null {
	const { frontmatter } = splitFrontmatter(text);
	return eventFromProps(name, {
		start: readYamlString(frontmatter, "start"),
		end: readYamlString(frontmatter, "end"),
		category: readYamlString(frontmatter, "category"),
		repeats: readYamlString(frontmatter, "repeats"),
		until: readYamlString(frontmatter, "until"),
	});
}

/** From properties (e.g. Obsidian's metadata index). Returns null if the dates aren't valid. */
export function eventFromProps(name: string, props: Record<string, unknown> | undefined): DayEvent | null {
	if (!props) return null;
	const date = (v: unknown): string => {
		if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
		return typeof v === "string" ? v.trim().slice(0, 10) : "";
	};
	const start = date(props.start);
	const end = date(props.end) || start;
	if (!isDateKey(start) || !isDateKey(end)) return null;
	const [a, b] = orderRange(start, end);
	const cat = typeof props.category === "string" ? props.category : "";
	const event: DayEvent = { name, start: a, end: b, category: cat.trim().replace(/^#/, "").toLowerCase() };
	const repeats = typeof props.repeats === "string" ? parseRepeat(props.repeats) : null;
	if (repeats) {
		event.repeats = repeats;
		const until = date(props.until);
		if (isDateKey(until)) event.until = until;
	}
	return event;
}

/** Writes dates and category; the rest of the note (its notes) is kept. */
export function applyEvent(text: string, e: DayEvent): string {
	let { frontmatter, body } = splitFrontmatter(text);
	frontmatter = setYamlKey(frontmatter, "start", yamlStringLines("start", e.start));
	frontmatter = setYamlKey(frontmatter, "end", yamlStringLines("end", e.end));
	frontmatter = setYamlKey(frontmatter, "category", yamlStringLines("category", e.category));
	if (e.repeats) {
		frontmatter = setYamlKey(frontmatter, "repeats", yamlStringLines("repeats", formatRepeat(e.repeats)));
		if (e.until) frontmatter = setYamlKey(frontmatter, "until", yamlStringLines("until", e.until));
		else frontmatter = removeYamlKey(frontmatter, "until");
	} else {
		if (hasYamlKey(frontmatter, "repeats")) frontmatter = removeYamlKey(frontmatter, "repeats");
		if (hasYamlKey(frontmatter, "until")) frontmatter = removeYamlKey(frontmatter, "until");
	}
	if (body.trim() === "" && readSection(body, EVENT_NOTES_HEADING) === null) body = writeSection("", EVENT_NOTES_HEADING, "");
	if (!body.startsWith("\n")) body = "\n" + body;
	return joinFrontmatter(frontmatter, body);
}

export function orderRange(a: DateKey, b: DateKey): [DateKey, DateKey] {
	return compareKeys(a, b) <= 0 ? [a, b] : [b, a];
}

export function isOn(e: DayEvent, date: DateKey): boolean {
	return e.start <= date && date <= e.end;
}

/** Events on a day, longest-running first (so bars line up across days). */
export function eventsOn(events: DayEvent[], date: DateKey): DayEvent[] {
	return events.filter((e) => isOn(e, date)).sort(byStart);
}

export function eventsOverlapping(events: DayEvent[], from: DateKey, to: DateKey): DayEvent[] {
	return events.filter((e) => e.start <= to && e.end >= from).sort(byStart);
}

function byStart(a: DayEvent, b: DayEvent): number {
	return a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.name.localeCompare(b.name);
}

export function lengthInDays(e: DayEvent): number {
	let n = 1;
	for (let d = e.start; d < e.end; d = addDays(d, 1)) n++;
	return n;
}

/** "day 2 of 5" position of a date within an event (1-based). */
export function dayOf(e: DayEvent, date: DateKey): { day: number; total: number } {
	let day = 1;
	for (let d = e.start; d < date; d = addDays(d, 1)) day++;
	return { day, total: lengthInDays(e) };
}

/** The category an event uses, if it's one from settings. */
export function eventCategory(e: DayEvent, categories: Category[]): Category | null {
	if (!e.category) return null;
	return categories.find((c) => c.tag.toLowerCase() === e.category) ?? null;
}

/** Every date an event covers, limited to [from, to]. */
export function eventDates(e: DayEvent, from: DateKey, to: DateKey): DateKey[] {
	const out: DateKey[] = [];
	const a = e.start > from ? e.start : from;
	const b = e.end < to ? e.end : to;
	for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
	return out;
}

// ---- Repeating events ----

/** Start date of the k-th occurrence (k = 0 is the event itself). Month ends clamp, e.g. 31st -> 30th. */
function occurrenceStart(e: DayEvent, k: number): DateKey {
	const r = e.repeats!;
	if (r.unit === "week") return addDays(e.start, 7 * r.n * k);
	return addMonthsToKey(e.start, (r.unit === "year" ? 12 : 1) * r.n * k);
}

/**
 * The event's occurrences that overlap [from, to], each as its own DayEvent
 * with that occurrence's dates (and `series` pointing at the original dates).
 * A one-off event is returned as is when it overlaps.
 */
export function occurrences(e: DayEvent, from: DateKey, to: DateKey): DayEvent[] {
	if (!e.repeats) return e.start <= to && e.end >= from ? [e] : [];
	const length = lengthInDays(e);
	const out: DayEvent[] = [];
	for (let k = 0; k < 5000; k++) {
		const start = occurrenceStart(e, k);
		if (start > to || (e.until && start > e.until)) break;
		const end = addDays(start, length - 1);
		if (end < from) continue;
		out.push({ ...e, start, end, series: { start: e.start, end: e.end } });
	}
	return out;
}

/** All events (repeating ones expanded) overlapping [from, to]. */
export function expandEvents(events: DayEvent[], from: DateKey, to: DateKey): DayEvent[] {
	return events.flatMap((e) => occurrences(e, from, to)).sort(byStart);
}
