// Recurring tasks. All rules live in one note, one per line:
//
//   Daybook/Recurring.md
//   ## Recurring
//
//   - Pay rent | monthly on 1
//   - Water plants | weekly on sun
//   - Team sync | weekly on mon, thu | card: Work
//   - Passport renewal | yearly on 03-14
//   - Stretch | daily | from: 2026-11-09
//   - Backup | every 3 days | from: 2026-11-09 | paused
//   - Course | weekly on tue | from: 2026-11-09 | until: 2026-12-15
//
// The Daybook dialog writes these lines, so nobody has to type them.
// On a day where a rule is due, its task shows up (not yet written); the
// first edit of that day writes it, and the day note remembers the rule in
// a "recurring" property so it's never added twice.

import { DateKey, Weekday, addDays, daysInMonth, isDateKey, parseKey, weekday } from "./dates";
import { DayEntry, Task, addCarried, newTask } from "./day";
import { joinFrontmatter, readSection, splitFrontmatter, writeSection } from "./markdown";
import { parseCardLink } from "./project";

export type Frequency =
	| { kind: "daily" }
	| { kind: "weekdays" } // Monday to Friday
	| { kind: "weekly"; days: Weekday[] }
	| { kind: "monthly"; day: number | "last" } // 1-31; short months use their last day
	| { kind: "yearly"; month: number; day: number } // 29 Feb falls back to 28 Feb
	| { kind: "every"; n: number; unit: "days" | "weeks" }; // counted from "from"

export interface Rule {
	text: string;
	freq: Frequency;
	/** Task card heading to put it under ("Home", "[[Project]]"), or null. */
	card: string | null;
	/** First day the rule applies (also the anchor for "every N"); "" = no start date. */
	from: DateKey;
	/** Last day it can appear; "" = no end. */
	until: DateKey;
	paused: boolean;
}

/**
 * A card heading safe to write in a rule line. Rule parts are separated by
 * "|", so a project or milestone card is stored by its link alone, without
 * its display alias: "[[dpu#^abc|abc]]" -> "[[dpu#^abc]]". Matching finds the
 * day's card by what it links to (see addRuleTasks).
 */
export function ruleCard(card: string | null): string | null {
	if (!card) return null;
	const link = parseCardLink(card);
	if (link?.milestoneId) return `[[${link.project}#^${link.milestoneId}]]`;
	if (link) return link.title ? `[[${link.project}]] ${link.title.replace(/\|/g, "/")}` : `[[${link.project}]]`;
	return card.replace(/\|/g, "/").trim() || null;
}

/** Repairs cards saved by an older version, where "[[p#^id|alias]]" became "[[p#^id/alias]]". */
function repairCard(card: string): string {
	return card.replace(/^(\[\[[^\]#|]+#\^[A-Za-z0-9-]+)\/[^\]]*\]\]/, "$1]]");
}

export const RECURRING_HEADING = "Recurring";

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function dayIndex(name: string): Weekday | null {
	const i = DAY_NAMES.indexOf(name.trim().slice(0, 3).toLowerCase() as (typeof DAY_NAMES)[number]);
	return i < 0 ? null : (i as Weekday);
}

// ---- Reading and writing rule lines ----

export function parseFrequency(raw: string): Frequency | null {
	const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
	if (s === "daily" || s === "every day") return { kind: "daily" };
	if (s === "weekdays" || s === "every weekday") return { kind: "weekdays" };
	let m = /^weekly on (.+)$/.exec(s);
	if (m) {
		const days = m[1]!
			.split(/[ ,]+/)
			.map(dayIndex)
			.filter((d): d is Weekday => d !== null);
		return days.length ? { kind: "weekly", days: [...new Set(days)].sort() } : null;
	}
	m = /^monthly on (last|\d{1,2})$/.exec(s);
	if (m) {
		if (m[1] === "last") return { kind: "monthly", day: "last" };
		const day = Number(m[1]);
		return day >= 1 && day <= 31 ? { kind: "monthly", day } : null;
	}
	m = /^yearly on (\d{1,2})-(\d{1,2})$/.exec(s);
	if (m) {
		const month = Number(m[1]);
		const day = Number(m[2]);
		return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { kind: "yearly", month, day } : null;
	}
	m = /^every (\d+) (days?|weeks?)$/.exec(s);
	if (m) {
		const n = Number(m[1]);
		return n >= 1 ? { kind: "every", n, unit: m[2]!.startsWith("week") ? "weeks" : "days" } : null;
	}
	return null;
}

export function formatFrequency(f: Frequency): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	switch (f.kind) {
		case "daily":
			return "daily";
		case "weekdays":
			return "weekdays";
		case "weekly":
			return `weekly on ${f.days.map((d) => DAY_NAMES[d]).join(", ")}`;
		case "monthly":
			return `monthly on ${f.day}`;
		case "yearly":
			return `yearly on ${pad(f.month)}-${pad(f.day)}`;
		case "every":
			return `every ${f.n} ${f.n === 1 ? f.unit.slice(0, -1) : f.unit}`;
	}
}

/** One "- text | frequency | card: X | from: date | paused" line; null if it isn't a rule. */
export function parseRule(line: string): Rule | null {
	const m = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
	if (!m) return null;
	const parts = m[1]!.split("|").map((p) => p.trim());
	const text = parts[0] ?? "";
	const freq = parseFrequency(parts[1] ?? "");
	if (!text || !freq) return null;
	const rule: Rule = { text, freq, card: null, from: "", until: "", paused: false };
	for (const p of parts.slice(2)) {
		const kv = /^(card|from|until)\s*:\s*(.+)$/i.exec(p);
		const key = kv?.[1]!.toLowerCase();
		const value = kv?.[2]!.trim() ?? "";
		if (key === "card") rule.card = repairCard(value);
		else if (key === "from" && isDateKey(value)) rule.from = value;
		else if (key === "until" && isDateKey(value)) rule.until = value;
		else if (p.toLowerCase() === "paused") rule.paused = true;
	}
	return rule;
}

export function formatRule(r: Rule): string {
	const parts = [r.text.replace(/\|/g, "/").trim(), formatFrequency(r.freq)];
	const card = ruleCard(r.card);
	if (card) parts.push(`card: ${card}`);
	if (r.from) parts.push(`from: ${r.from}`);
	if (r.until) parts.push(`until: ${r.until}`);
	if (r.paused) parts.push("paused");
	return `- ${parts.join(" | ")}`;
}

/** Rules from the note's "## Recurring" section (lines that aren't rules are ignored). */
export function parseRules(text: string): Rule[] {
	const { body } = splitFrontmatter(text);
	const section = readSection(body, RECURRING_HEADING) ?? "";
	return section
		.split("\n")
		.map(parseRule)
		.filter((r): r is Rule => r !== null);
}

/** Writes the rules into the note's "## Recurring" section; the rest of the note is kept. */
export function applyRules(text: string, rules: Rule[]): string {
	const { frontmatter, body } = splitFrontmatter(text);
	const intro =
		body.trim() === ""
			? "Recurring tasks for Daybook. Use the \"Recurring tasks\" dialog to add or change them.\n\n"
			: "";
	const next = writeSection(intro || body, RECURRING_HEADING, rules.map(formatRule).join("\n"));
	return joinFrontmatter(frontmatter, next);
}

// ---- When a rule is due ----

/** The day-of-month a "day N" lands on in a given month (31st -> last day of short months). */
export function clampDay(year: number, month: number, day: number): number {
	return Math.min(day, daysInMonth(year, month));
}

function daysBetween(a: DateKey, b: DateKey): number {
	const pa = parseKey(a);
	const pb = parseKey(b);
	return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000);
}

export function isDue(r: Rule, date: DateKey): boolean {
	if (r.paused) return false;
	if (r.from && date < r.from) return false;
	if (r.until && date > r.until) return false;
	const { year, month, day } = parseKey(date);
	const f = r.freq;
	switch (f.kind) {
		case "daily":
			return true;
		case "weekdays": {
			const w = weekday(date);
			return w >= 1 && w <= 5;
		}
		case "weekly":
			return f.days.includes(weekday(date));
		case "monthly":
			return day === (f.day === "last" ? daysInMonth(year, month) : clampDay(year, month, f.day));
		case "yearly":
			return month === f.month && day === clampDay(year, month, f.day);
		case "every": {
			if (!r.from) return false;
			const step = f.unit === "weeks" ? f.n * 7 : f.n;
			return daysBetween(r.from, date) % step === 0;
		}
	}
}

/** The next date on or after `from` when the rule is due (within ~2 years), or null. */
export function nextDue(r: Rule, from: DateKey): DateKey | null {
	let d = r.from && r.from > from ? r.from : from;
	for (let i = 0; i < 800; i++, d = addDays(d, 1)) if (isDue(r, d)) return d;
	return null;
}

/** Plain-English description, e.g. "Every month on the 31st (or the last day)". */
export function describe(r: Rule, dayName: (d: Weekday) => string, monthName: (m: number) => string): string {
	const f = r.freq;
	const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
	switch (f.kind) {
		case "daily":
			return "Every day";
		case "weekdays":
			return "Every weekday (Mon–Fri)";
		case "weekly":
			return `Every week on ${f.days.map(dayName).join(", ")}`;
		case "monthly":
			if (f.day === "last") return "Every month on the last day";
			return f.day > 28 ? `Every month on the ${ord(f.day)} (or the last day)` : `Every month on the ${ord(f.day)}`;
		case "yearly":
			return `Every year on ${f.day} ${monthName(f.month)}${f.month === 2 && f.day === 29 ? " (28 Feb in other years)" : ""}`;
		case "every":
			return f.n === 1 ? `Every ${f.unit.slice(0, -1)}` : `Every ${f.n} ${f.unit}`;
	}
}

// ---- Putting due tasks into a day ----

/** A rule's identity in a day note's "recurring" property. */
export function ruleId(r: Rule): string {
	return r.text.trim().toLowerCase();
}

/**
 * Rules due on `date` that this day doesn't have yet: not recorded in its
 * "recurring" property, and no task with the same text already there (for
 * example one carried over from yesterday).
 */
export function pendingRules(entry: DayEntry, rules: Rule[], date: DateKey): Rule[] {
	const recorded = new Set(entry.recurring.map((r) => r.toLowerCase()));
	const texts = new Set(entry.groups.flatMap((g) => g.tasks.map((t) => t.text.trim().toLowerCase())));
	return rules.filter((r) => isDue(r, date) && !recorded.has(ruleId(r)) && !texts.has(ruleId(r)));
}

/**
 * Adds the rules' tasks to the day (under their card) and records them, so
 * they're written with the day's next save and never added again.
 */
export function addRuleTasks(entry: DayEntry, rules: Rule[]): Task[] {
	const added: Task[] = [];
	for (const r of rules) {
		const task = newTask(r.text);
		addCarried(entry, [{ name: cardIn(entry, r.card), tasks: [task] }]);
		entry.recurring.push(ruleId(r));
		added.push(task);
	}
	return added;
}

/**
 * The heading of the day's card a rule's task goes into. A project or
 * milestone card is found by what it links to, whatever its display text;
 * other cards by name (a missing card is created with the rule's heading).
 */
function cardIn(entry: DayEntry, card: string | null): string | null {
	if (!card) return null;
	const want = parseCardLink(card);
	if (!want) return card;
	const same = entry.groups.find((g) => {
		const have = parseCardLink(g.name);
		return (
			have !== null &&
			have.project.toLowerCase() === want.project.toLowerCase() &&
			have.milestoneId === want.milestoneId &&
			(want.milestoneId !== null || have.title.toLowerCase() === want.title.toLowerCase())
		);
	});
	return same?.name ?? card;
}
