// Year grid: 12 rows of day boxes coloured by category. Pure logic.

import { DateKey, daysInMonth, toKey } from "./dates";
import { Category } from "./types";

export interface YearRow {
	month: number; // 1-12
	days: DateKey[]; // 28-31 dates
}

export function yearRows(year: number): YearRow[] {
	return Array.from({ length: 12 }, (_, i) => {
		const month = i + 1;
		return { month, days: Array.from({ length: daysInMonth(year, month) }, (_, d) => toKey(year, month, d + 1)) };
	});
}

/** Normalises a tags property (list, single string, "#tag", "a, b") to plain lower-case tags. */
export function normaliseTags(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
	return raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim().replace(/^#/, "").toLowerCase())
		.filter(Boolean);
}

/** Categories a day belongs to, in settings order. */
export function categoriesFor(tags: string[], categories: Category[]): Category[] {
	const set = new Set(tags.map((t) => t.toLowerCase()));
	return categories.filter((c) => c.tag && set.has(c.tag.toLowerCase()));
}

/** Days per category tag (lower case) across the given days. */
export function countByCategory(tagsByDay: Map<DateKey, string[]>, categories: Category[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const c of categories) if (c.tag) counts.set(c.tag.toLowerCase(), 0);
	for (const tags of tagsByDay.values()) {
		for (const c of categoriesFor(tags, categories)) {
			const k = c.tag.toLowerCase();
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
	}
	return counts;
}

/** CSS background for a box: one colour, or equal stripes for several. */
export function boxFill(colours: string[]): string | null {
	if (colours.length === 0) return null;
	if (colours.length === 1) return colours[0]!;
	const step = 100 / colours.length;
	const stops = colours.map((c, i) => `${c} ${Math.round(i * step)}% ${Math.round((i + 1) * step)}%`);
	return `linear-gradient(135deg, ${stops.join(", ")})`;
}
