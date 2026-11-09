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
// Events never write into day notes; views look them up by date.

import { DateKey, addDays, compareKeys, isDateKey } from "./dates";
import { joinFrontmatter, readSection, readYamlString, setYamlKey, splitFrontmatter, writeSection, yamlStringLines } from "./markdown";
import { Category } from "./types";

export interface DayEvent {
	/** File name without ".md"; also the event's title. */
	name: string;
	start: DateKey;
	end: DateKey;
	/** Category tag (from settings), or "". */
	category: string;
}

export const EVENT_NOTES_HEADING = "Notes";

/** From a note's text (used when writing). */
export function parseEvent(name: string, text: string): DayEvent | null {
	const { frontmatter } = splitFrontmatter(text);
	return eventFromProps(name, {
		start: readYamlString(frontmatter, "start"),
		end: readYamlString(frontmatter, "end"),
		category: readYamlString(frontmatter, "category"),
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
	return { name, start: a, end: b, category: cat.trim().replace(/^#/, "").toLowerCase() };
}

/** Writes dates and category; the rest of the note (its notes) is kept. */
export function applyEvent(text: string, e: DayEvent): string {
	let { frontmatter, body } = splitFrontmatter(text);
	frontmatter = setYamlKey(frontmatter, "start", yamlStringLines("start", e.start));
	frontmatter = setYamlKey(frontmatter, "end", yamlStringLines("end", e.end));
	frontmatter = setYamlKey(frontmatter, "category", yamlStringLines("category", e.category));
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
