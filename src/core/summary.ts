// What a compact day card shows: the first few tasks plus counts.
// Pure logic, shared by the week and month views.

import { Category } from "./types";
import { DayEntry, TaskPos } from "./day";
import { firstGoal } from "./period";

export interface SummaryRow {
	text: string;
	done: boolean;
	/** Moved to a later day ([>]). */
	carried: boolean;
	depth: number;
	/** Where the task lives, so a compact card can tick it. */
	pos: TaskPos;
}

export interface DaySummary {
	rows: SummaryRow[];
	/** Tasks not shown ("+N more"). */
	more: number;
	open: number;
	done: number;
	hasDiary: boolean;
	/** The day's first goal, as plain text ("" if none). */
	goal: string;
	categories: Category[];
}

export function summarizeDay(entry: DayEntry | null, maxRows: number, categories: Category[]): DaySummary {
	const rows: SummaryRow[] = [];
	let open = 0;
	let done = 0;
	if (entry) {
		entry.groups.forEach((g, group) =>
			g.tasks.forEach((t, index) => {
				if (t.text.trim() === "") return;
				if (t.done) done++;
				else if (!t.carried) open++;
				rows.push({ text: t.text, done: t.done, carried: t.carried === true, depth: t.depth, pos: { group, index } });
			}),
		);
	}
	const tags = new Set((entry?.tags ?? []).map((t) => t.toLowerCase()));
	return {
		rows: rows.slice(0, maxRows),
		more: Math.max(0, rows.length - maxRows),
		open,
		done,
		hasDiary: (entry?.diary.trim() ?? "") !== "",
		goal: firstGoal(entry?.goals ?? ""),
		categories: categories.filter((c) => c.tag && tags.has(c.tag.toLowerCase())),
	};
}
