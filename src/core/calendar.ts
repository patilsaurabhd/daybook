// Month grid for the sidebar calendar: always whole weeks, each labelled with
// its week number. Pure data; the UI decides how to draw it.

import { DateKey, IsoWeek, Weekday, addDays, daysInMonth, parseKey, startOfWeek, toKey, weekIdFor } from "./dates";

export interface CalendarDay {
	key: DateKey;
	day: number;
	inMonth: boolean;
}

export interface CalendarWeek {
	week: IsoWeek;
	days: CalendarDay[];
}

export function monthGrid(year: number, month: number, firstDay: Weekday): CalendarWeek[] {
	const first = toKey(year, month, 1);
	const last = toKey(year, month, daysInMonth(year, month));
	const weeks: CalendarWeek[] = [];
	let cursor = startOfWeek(first, firstDay);
	while (cursor <= last) {
		const days: CalendarDay[] = [];
		for (let i = 0; i < 7; i++) {
			const key = addDays(cursor, i);
			const p = parseKey(key);
			days.push({ key, day: p.day, inMonth: p.month === month && p.year === year });
		}
		weeks.push({ week: weekIdFor(cursor, firstDay), days });
		cursor = addDays(cursor, 7);
	}
	return weeks;
}

/** Weekday numbers in display order, e.g. [1,2,3,4,5,6,0] for a Monday start. */
export function weekdayOrder(firstDay: Weekday): Weekday[] {
	return Array.from({ length: 7 }, (_, i) => ((firstDay + i) % 7) as Weekday);
}
