// Pure date helpers. No Obsidian imports: this folder is meant to be portable.
//
// Dates are passed around as "YYYY-MM-DD" strings (DateKey). All arithmetic
// is done in UTC so daylight-saving changes can never shift a day.

export type DateKey = string;

/** 0 = Sunday, 1 = Monday, ... 6 = Saturday (same as Date.getDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface YMD {
	year: number;
	month: number; // 1-12
	day: number;
}

export interface IsoWeek {
	year: number; // ISO week-numbering year (can differ from the calendar year)
	week: number; // 1-53
}

export function pad(n: number, width = 2): string {
	return String(n).padStart(width, "0");
}

export function toKey(year: number, month: number, day: number): DateKey {
	return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(value: unknown): value is DateKey {
	if (typeof value !== "string") return false;
	const m = KEY_RE.exec(value);
	if (!m) return false;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseKey(key: DateKey): YMD {
	const m = KEY_RE.exec(key);
	if (!m) throw new Error(`Invalid date key: ${key}`);
	return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function toUtc(key: DateKey): Date {
	const { year, month, day } = parseKey(key);
	return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(date: Date): DateKey {
	return toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Today's date in the device's local time zone. */
export function todayKey(now: Date = new Date()): DateKey {
	return toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(key: DateKey, days: number): DateKey {
	const d = toUtc(key);
	d.setUTCDate(d.getUTCDate() + days);
	return fromUtc(d);
}

export function weekday(key: DateKey): Weekday {
	return toUtc(key).getUTCDay() as Weekday;
}

export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
	return daysInMonth(year, 2) === 29;
}

/** Adds months to a year/month pair. */
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
	const index = year * 12 + (month - 1) + delta;
	return { year: Math.floor(index / 12), month: (index % 12 + 12) % 12 + 1 };
}

/** Same day-of-month in another month, clamped (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsToKey(key: DateKey, delta: number): DateKey {
	const { year, month, day } = parseKey(key);
	const t = addMonths(year, month, delta);
	return toKey(t.year, t.month, Math.min(day, daysInMonth(t.year, t.month)));
}

export function addYearsToKey(key: DateKey, delta: number): DateKey {
	return addMonthsToKey(key, delta * 12);
}

/** First day of the week that contains `key`. */
export function startOfWeek(key: DateKey, firstDay: Weekday): DateKey {
	const offset = (weekday(key) - firstDay + 7) % 7;
	return addDays(key, -offset);
}

/** The seven dates of the week containing `key`. */
export function weekDays(key: DateKey, firstDay: Weekday): DateKey[] {
	const start = startOfWeek(key, firstDay);
	return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** ISO 8601 week number (weeks start Monday; week 1 holds the first Thursday). */
export function isoWeek(key: DateKey): IsoWeek {
	const d = toUtc(key);
	const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
	d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
	const isoYear = d.getUTCFullYear();
	const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
	const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
	firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
	const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
	return { year: isoYear, week };
}

/**
 * The week label for a displayed week row. Whatever day the week starts on,
 * the row is named after the ISO week of the Thursday inside it, so every
 * row maps to exactly one week file.
 */
export function weekIdFor(key: DateKey, firstDay: Weekday): IsoWeek {
	const days = weekDays(key, firstDay);
	const thursday = days.find((d) => weekday(d) === 4) ?? days[0]!;
	return isoWeek(thursday);
}

export function compareKeys(a: DateKey, b: DateKey): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

// ---- Display names (locale-aware via Intl, no Obsidian/moment needed) ----

function fmt(key: DateKey, options: Intl.DateTimeFormatOptions, locale?: string): string {
	return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(toUtc(key));
}

export function formatLongDate(key: DateKey, locale?: string): string {
	return fmt(key, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, locale);
}

export function monthName(month: number, locale?: string, style: "long" | "short" = "long"): string {
	return fmt(toKey(2000, month, 1), { month: style }, locale);
}

/** Short weekday name for a weekday number, e.g. "Mon". */
export function weekdayName(day: Weekday, locale?: string, style: "short" | "narrow" | "long" = "short"): string {
	// 2000-01-02 was a Sunday.
	return fmt(addDays("2000-01-02", day), { weekday: style }, locale);
}

/** Formats a date with any Intl options, e.g. { day: "numeric", month: "short" }. */
export function formatDate(key: DateKey, options: Intl.DateTimeFormatOptions, locale?: string): string {
	return fmt(key, options, locale);
}

/** "9 – 15 Nov 2026" style label for a run of dates. */
export function formatRange(first: DateKey, last: DateKey, locale?: string): string {
	const a = parseKey(first);
	const b = parseKey(last);
	const end = fmt(last, { day: "numeric", month: "short", year: "numeric" }, locale);
	const startOpts: Intl.DateTimeFormatOptions =
		a.year !== b.year ? { day: "numeric", month: "short", year: "numeric" } : a.month !== b.month ? { day: "numeric", month: "short" } : { day: "numeric" };
	return `${fmt(first, startOpts, locale)} – ${end}`;
}
