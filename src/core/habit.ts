// Habits: things you want to do regularly, ticked off day by day.
//
// Your habits are listed in one note, one per line (written by Daybook):
//
//   Daybook/Habits.md
//   ## Habits
//
//   - Gym | colour: #5aa469
//   - Read | colour: #3e7bfa
//   - Guitar | colour: #8e4ec6 | archived
//
// A day records what was done in its "habits" property:
//
//   habits:
//     - gym
//     - read
//
// A habit for one day only goes in "habits-extra" (and in "habits" once
// ticked). There are no due days: every habit shows on every day, and the
// count that matters is how often it was done this week.

import { DateKey } from "./dates";
import { DayEntry } from "./day";
import { joinFrontmatter, readSection, splitFrontmatter, writeSection } from "./markdown";

export interface Habit {
	name: string;
	colour: string;
	/** Hidden from day pages (its past ticks stay). */
	archived: boolean;
}

export const HABITS_HEADING = "Habits";

/** A habit's key in the "habits" property: its name, trimmed and in lower case. */
export function habitKey(name: string): string {
	return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseHabitLine(line: string): Habit | null {
	const m = /^\s*[-*+]\s+(.*)$/.exec(line);
	if (!m) return null;
	const parts = m[1]!.split("|").map((p) => p.trim());
	const name = parts[0] ?? "";
	if (!name) return null;
	const habit: Habit = { name, colour: "", archived: false };
	for (const p of parts.slice(1)) {
		const kv = /^colou?r\s*:\s*(.+)$/i.exec(p);
		if (kv) habit.colour = kv[1]!.trim();
		else if (p.toLowerCase() === "archived") habit.archived = true;
	}
	return habit;
}

export function formatHabitLine(h: Habit): string {
	const parts = [h.name.replace(/\|/g, "/").trim()];
	if (h.colour) parts.push(`colour: ${h.colour}`);
	if (h.archived) parts.push("archived");
	return `- ${parts.join(" | ")}`;
}

export function parseHabits(text: string): Habit[] {
	const { body } = splitFrontmatter(text);
	const seen = new Set<string>();
	const out: Habit[] = [];
	for (const line of (readSection(body, HABITS_HEADING) ?? "").split("\n")) {
		const h = parseHabitLine(line);
		if (!h || seen.has(habitKey(h.name))) continue; // one line per habit
		seen.add(habitKey(h.name));
		out.push(h);
	}
	return out;
}

/** Writes the list into the note's "## Habits" section; the rest of the note is kept. */
export function applyHabits(text: string, habits: Habit[]): string {
	const { frontmatter, body } = splitFrontmatter(text);
	const intro = body.trim() === "" ? "Your habits for Daybook. Ticks are saved in each day's \"habits\" property.\n\n" : "";
	return joinFrontmatter(frontmatter, writeSection(intro || body, HABITS_HEADING, habits.map(formatHabitLine).join("\n")));
}

/** Adds a habit (unless one with that name exists, which is un-archived instead). */
export function addHabit(habits: Habit[], name: string, colour: string): Habit | null {
	const clean = name.trim().replace(/\s+/g, " ");
	if (!clean) return null;
	const existing = habits.find((h) => habitKey(h.name) === habitKey(clean));
	if (existing) {
		existing.archived = false;
		return existing;
	}
	const habit: Habit = { name: clean, colour, archived: false };
	habits.push(habit);
	return habit;
}

// ---- One day ----

/** A row in a day's habit box. */
export interface DayHabitRow {
	key: string;
	name: string;
	colour: string;
	done: boolean;
	/** Added for this day only. */
	oneDay: boolean;
}

/**
 * The habits to show on a day: active habits, plus archived ones that were
 * ticked that day, plus that day's one-day habits.
 */
export function dayHabits(habits: Habit[], day: Pick<DayEntry, "habits" | "habitsExtra">): DayHabitRow[] {
	const done = new Set(day.habits);
	const rows: DayHabitRow[] = [];
	const seen = new Set<string>();
	for (const h of habits) {
		const key = habitKey(h.name);
		if (h.archived && !done.has(key)) continue;
		seen.add(key);
		rows.push({ key, name: h.name, colour: h.colour, done: done.has(key), oneDay: false });
	}
	for (const name of day.habitsExtra) {
		const key = habitKey(name);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		rows.push({ key, name, colour: "", done: done.has(key), oneDay: true });
	}
	return rows;
}

export function setHabitDone(day: Pick<DayEntry, "habits">, key: string, done: boolean): void {
	const rest = day.habits.filter((k) => k !== key);
	day.habits = done ? [...rest, key] : rest;
}

/** Adds a habit for this day only. */
export function addOneDayHabit(day: Pick<DayEntry, "habitsExtra">, name: string): void {
	const clean = name.trim().replace(/\s+/g, " ");
	if (clean && !day.habitsExtra.some((n) => habitKey(n) === habitKey(clean))) day.habitsExtra = [...day.habitsExtra, clean];
}

/** Removes a one-day habit (and its tick) from the day. */
export function removeOneDayHabit(day: Pick<DayEntry, "habits" | "habitsExtra">, key: string): void {
	day.habitsExtra = day.habitsExtra.filter((n) => habitKey(n) !== key);
	day.habits = day.habits.filter((k) => k !== key);
}

/** How many of `days` have the habit ticked. */
export function timesDone(ticksByDay: Map<DateKey, string[]>, key: string, days: DateKey[]): number {
	return days.filter((d) => (ticksByDay.get(d) ?? []).includes(key)).length;
}

// ---- A week (or any run of days) ----

/** One row of the week table: a habit and whether it was done on each day. */
export interface HabitGridRow {
	key: string;
	name: string;
	colour: string;
	done: boolean[];
	count: number;
}

/**
 * Rows for a table of `days`: active habits, plus archived ones that were
 * ticked on one of those days (so past weeks still show them).
 */
export function habitGrid(habits: Habit[], ticksByDay: Map<DateKey, string[]>, days: DateKey[]): HabitGridRow[] {
	const rows: HabitGridRow[] = [];
	for (const h of habits) {
		const key = habitKey(h.name);
		const done = days.map((d) => (ticksByDay.get(d) ?? []).includes(key));
		const count = done.filter(Boolean).length;
		if (h.archived && count === 0) continue;
		rows.push({ key, name: h.name, colour: h.colour, done, count });
	}
	return rows;
}

/** How many of the given habits were done each day (days with none are left out). */
export function habitsDonePerDay(ticksByDay: Map<DateKey, string[]>, keys: string[]): Map<DateKey, number> {
	const wanted = new Set(keys);
	const out = new Map<DateKey, number>();
	for (const [day, ticks] of ticksByDay) {
		const n = new Set(ticks.filter((t) => wanted.has(t))).size;
		if (n > 0) out.set(day, n);
	}
	return out;
}
