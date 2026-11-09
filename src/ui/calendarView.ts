// Right-sidebar calendar. Click a day, week number, month name or year to
// open it in the main Daybook view.

import { ItemView, WorkspaceLeaf, debounce, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { addMonths, monthName, parseKey, todayKey, weekdayName, weekDays } from "../core/dates";
import { monthGrid, weekdayOrder } from "../core/calendar";
import { dayPath } from "../core/paths";
import { Selection, ZoomLevel } from "../core/types";
import { eventsOn } from "../core/event";
import { eventColour } from "./eventActions";

export const VIEW_TYPE_CALENDAR = "daybook-calendar";

export class CalendarView extends ItemView {
	private year: number;
	private month: number;
	private followedDate: string;

	constructor(leaf: WorkspaceLeaf, private plugin: DaybookPlugin) {
		super(leaf);
		const { year, month } = parseKey(plugin.selection.date);
		this.year = year;
		this.month = month;
		this.followedDate = plugin.selection.date;
	}

	getViewType(): string {
		return VIEW_TYPE_CALENDAR;
	}

	getDisplayText(): string {
		return "Daybook calendar";
	}

	getIcon(): string {
		return "calendar-days";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("daybook-calendar");

		this.register(
			this.plugin.onChange(() => {
				// Jump to the month of whatever the main view now shows.
				const date = this.plugin.selection.date;
				if (date !== this.followedDate) {
					this.followedDate = date;
					const p = parseKey(date);
					this.year = p.year;
					this.month = p.month;
				}
				this.render();
			}),
		);

		// Refresh the "has a note" dots when day notes come and go.
		const refresh = debounce(() => this.render(), 300, true);
		this.registerEvent(this.app.vault.on("create", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));

		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private go(level: ZoomLevel, date: string): void {
		void this.plugin.open({ level, date });
	}

	private shiftMonth(delta: number): void {
		const t = addMonths(this.year, this.month, delta);
		this.year = t.year;
		this.month = t.month;
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const locale = moment.locale();
		const { firstDayOfWeek, rootFolder } = this.plugin.settings;
		const sel: Selection = this.plugin.selection;
		const today = todayKey();
		const firstOfMonth = `${this.year}-${String(this.month).padStart(2, "0")}-01`;
		const selYear = parseKey(sel.date).year;
		const selMonth = parseKey(sel.date).month;

		// Navigation row
		const nav = el.createDiv({ cls: "daybook-cal-nav" });
		const prev = nav.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Previous month", role: "button", tabindex: "0" } });
		setIcon(prev, "chevron-left");
		activate(prev, () => this.shiftMonth(-1));

		const title = nav.createDiv({ cls: "daybook-cal-title" });
		const monthLink = title.createSpan({
			cls: "daybook-cal-link",
			text: monthName(this.month, locale),
			attr: { role: "button", tabindex: "0", "aria-label": "Open month" },
		});
		monthLink.toggleClass("is-selected", sel.level === "month" && selYear === this.year && selMonth === this.month);
		activate(monthLink, () => this.go("month", firstOfMonth));

		const yearLink = title.createSpan({
			cls: "daybook-cal-link",
			text: String(this.year),
			attr: { role: "button", tabindex: "0", "aria-label": "Open year" },
		});
		yearLink.toggleClass("is-selected", sel.level === "year" && selYear === this.year);
		activate(yearLink, () => this.go("year", firstOfMonth));

		const next = nav.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Next month", role: "button", tabindex: "0" } });
		setIcon(next, "chevron-right");
		activate(next, () => this.shiftMonth(1));

		const todayBtn = nav.createDiv({
			cls: "daybook-cal-today",
			text: "Today",
			attr: { role: "button", tabindex: "0", "aria-label": "Open today" },
		});
		activate(todayBtn, () => this.go("day", today));

		// Grid: week-number column + 7 day columns
		const grid = el.createDiv({ cls: "daybook-cal-grid" });
		grid.createDiv({ cls: "daybook-cal-head daybook-cal-weekhead", text: "W" });
		for (const wd of weekdayOrder(firstDayOfWeek)) {
			grid.createDiv({ cls: "daybook-cal-head", text: weekdayName(wd, locale, "short") });
		}

		const selectedWeek = sel.level === "week" ? weekDays(sel.date, firstDayOfWeek) : [];
		const allEvents = this.plugin.events.all();

		for (const row of monthGrid(this.year, this.month, firstDayOfWeek)) {
			const rowSelected = row.days.some((d) => selectedWeek.includes(d.key));
			const weekCell = grid.createDiv({
				cls: "daybook-cal-week",
				text: String(row.week.week),
				attr: { role: "button", tabindex: "0", "aria-label": `Open week ${row.week.week}` },
			});
			weekCell.toggleClass("is-selected", rowSelected);
			const weekTarget = row.days.find((d) => d.inMonth)?.key ?? row.days[0]!.key;
			activate(weekCell, () => this.go("week", weekTarget));

			for (const day of row.days) {
				const cell = grid.createDiv({
					cls: "daybook-cal-day",
					attr: { role: "button", tabindex: "0", "aria-label": day.key },
				});
				cell.createSpan({ cls: "daybook-cal-num", text: String(day.day) });
				cell.toggleClass("is-other-month", !day.inMonth);
				cell.toggleClass("is-today", day.key === today);
				cell.toggleClass("is-selected", sel.level === "day" && day.key === sel.date);
				cell.toggleClass("in-selected-week", rowSelected);
				const ev = eventsOn(allEvents, day.key)[0];
				if (ev) {
					cell.addClass("has-event");
					cell.setCssProps({ "--daybook-event": eventColour(this.plugin, ev) });
					cell.toggleClass("is-event-start", ev.start === day.key);
					cell.toggleClass("is-event-end", ev.end === day.key);
				}
				if (this.plugin.store.exists(dayPath(rootFolder, day.key))) {
					cell.createSpan({ cls: "daybook-cal-dot" });
				}
				activate(cell, () => this.go("day", day.key));
			}
		}
	}
}

/** Click or Enter/Space activates; keeps the calendar usable from the keyboard. */
function activate(el: HTMLElement, action: () => void): void {
	el.addEventListener("click", action);
	el.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter" || evt.key === " ") {
			evt.preventDefault();
			action();
		}
	});
}
