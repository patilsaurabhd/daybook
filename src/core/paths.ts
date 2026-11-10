// Where each kind of Daybook note lives. Pure string logic, no vault access.
//
//   <root>/2026/11/2026-11-09.md   day
//   <root>/2026/11/2026-11.md      month goal
//   <root>/2026/2026.md            year goal
//   <root>/2026/Weeks/2026-W46.md  week goal (ISO week-numbering year)

import { DateKey, IsoWeek, pad, parseKey, toKey, isDateKey } from "./dates";

export function cleanRoot(root: string): string {
	const trimmed = root.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	return trimmed.replace(/\/{2,}/g, "/");
}

function join(root: string, ...parts: string[]): string {
	const r = cleanRoot(root);
	return (r ? [r, ...parts] : parts).join("/");
}

export function dayPath(root: string, key: DateKey): string {
	const { year, month } = parseKey(key);
	return join(root, String(year), pad(month), `${key}.md`);
}

export function monthPath(root: string, year: number, month: number): string {
	return join(root, String(year), pad(month), `${year}-${pad(month)}.md`);
}

export function yearPath(root: string, year: number): string {
	return join(root, String(year), `${year}.md`);
}

export function weekPath(root: string, week: IsoWeek): string {
	return join(root, String(week.year), "Weeks", `${week.year}-W${pad(week.week)}.md`);
}

export function projectsFolder(root: string): string {
	return join(root, "Projects");
}

export function projectPath(root: string, name: string): string {
	return join(root, "Projects", `${name}.md`);
}

/** Your habits, one per line. */
export function habitsPath(root: string): string {
	return join(root, "Habits.md");
}

/** The Scratchpad: tasks and ideas that belong to no day. */
export function scratchpadPath(root: string): string {
	return join(root, "Scratchpad.md");
}

/** The one note holding all recurring-task rules. */
export function recurringPath(root: string): string {
	return join(root, "Recurring.md");
}

export function eventsFolder(root: string): string {
	return join(root, "Events");
}

export function eventPath(root: string, name: string): string {
	return join(root, "Events", `${name}.md`);
}

/** If `path` is a Daybook day note, returns its date; otherwise null. */
export function dayKeyFromPath(root: string, path: string): DateKey | null {
	const m = /(\d{4})-(\d{2})-(\d{2})\.md$/.exec(path);
	if (!m) return null;
	const key = toKey(Number(m[1]), Number(m[2]), Number(m[3]));
	if (!isDateKey(key)) return null;
	return dayPath(root, key) === path ? key : null;
}
