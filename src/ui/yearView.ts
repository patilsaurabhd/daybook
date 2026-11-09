// Year level: 12 rows (months) of day boxes coloured by category. A legend
// picks which category to highlight. Click a box for the day, a month name
// for the month. Drag across boxes to add an event (a trip, a conference);
// event days are underlined and listed below the grid.

import { Component, debounce, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, formatDate, monthName, parseKey, todayKey, weekday } from "../core/dates";
import { dayKeyFromPath } from "../core/paths";
import { boxFill, categoriesFor, countByCategory, yearRows } from "../core/year";
import { DayEvent, eventDates, eventsOn, orderRange } from "../core/event";
import { eventColour, eventRangeLabel, newEvent, repeatLabel, showEventMenu } from "./eventActions";
import { yearDayTags } from "../obsidian/store";

export class YearBoard extends Component {
	private host!: HTMLElement;
	/** Day boxes by date, for drag-selecting a range. */
	private boxes = new Map<DateKey, HTMLElement>();
	private dragFrom: DateKey | null = null;
	private dragTo: DateKey | null = null;
	private readonly redrawSoon = debounce(() => this.render(), 400, true);

	constructor(
		private plugin: DaybookPlugin,
		private containerEl: HTMLElement,
		private date: DateKey,
		private openDay: (date: DateKey) => void,
		private openMonth: (date: DateKey) => void,
	) {
		super();
	}

	async draw(): Promise<void> {
		this.host = this.containerEl.createDiv({ cls: "daybook-year" });
		// Tags come from Obsidian's index, which updates just after a file changes.
		const prefix = `${this.plugin.settings.rootFolder}/${parseKey(this.date).year}/`;
		this.registerEvent(
			this.plugin.app.metadataCache.on("changed", (file) => {
				if (file.path.startsWith(prefix)) this.redrawSoon();
			}),
		);
		this.registerEvent(
			this.plugin.app.vault.on("delete", (file) => {
				if (file.path.startsWith(prefix)) this.redrawSoon();
			}),
		);
		this.render();
		return Promise.resolve();
	}

	onunload(): void {
		this.redrawSoon.cancel();
	}

	/** Changes arrive through the metadata index (see draw); nothing to do here. */
	onFileChanged(): void {}

	private render(): void {
		const el = this.host;
		el.empty();
		const { rootFolder, categories } = this.plugin.settings;
		const year = parseKey(this.date).year;
		const locale = moment.locale();
		const today = todayKey();
		const tagsByDay = yearDayTags(this.plugin.app, rootFolder, year, (p) => dayKeyFromPath(rootFolder, p));
		// Every occurrence in this year (repeating events expanded).
		const events = this.plugin.events.between(`${year}-01-01`, `${year}-12-31`);
		// Event categories count as that day's category too (day notes untouched).
		const catTags = new Map<DateKey, string[]>();
		for (const [d, tags] of tagsByDay) catTags.set(d, [...tags]);
		for (const e of events) {
			if (!e.category) continue;
			for (const d of eventDates(e, `${year}-01-01`, `${year}-12-31`)) catTags.set(d, [...(catTags.get(d) ?? []), e.category]);
		}
		const counts = countByCategory(catTags, categories);
		this.boxes.clear();
		const usable = categories.filter((c) => c.tag.trim());
		let highlight = this.plugin.yearHighlight;
		if (highlight !== "all" && !usable.some((c) => c.tag.toLowerCase() === highlight)) highlight = this.plugin.yearHighlight = "all";

		// Legend: pick a category to highlight.
		const legend = el.createDiv({ cls: "daybook-year-legend", attr: { role: "radiogroup", "aria-label": "Highlight a category" } });
		const chip = (value: string, label: string, count: number, colour?: string) => {
			const b = legend.createEl("button", { cls: "daybook-filter-chip", attr: { role: "radio", "aria-checked": String(highlight === value) } });
			b.toggleClass("is-active", highlight === value);
			if (colour) b.createSpan({ cls: "daybook-chip-dot is-filled" }).setCssProps({ "--daybook-cat-color": colour });
			b.createSpan({ text: label });
			b.createSpan({ cls: "daybook-chip-count", text: String(count) });
			b.addEventListener("click", () => {
				this.plugin.yearHighlight = value;
				this.render();
			});
		};
		chip("all", "All", tagsByDay.size);
		for (const c of usable) chip(c.tag.toLowerCase(), c.name || c.tag, counts.get(c.tag.toLowerCase()) ?? 0, c.color);
		if (usable.length === 0) {
			legend.createSpan({ cls: "daybook-year-hint", text: "Add categories in settings to colour the year." });
		}
		const add = legend.createEl("button", { cls: "daybook-add-event" });
		setIcon(add.createSpan({ cls: "daybook-layout-icon" }), "calendar-plus");
		add.createSpan({ text: "Event" });
		add.addEventListener("click", () => {
			const start = today.startsWith(String(year)) ? today : `${year}-01-01`;
			newEvent(this.plugin, start, start);
		});

		// Grid: month label + 31 columns.
		const grid = el.createDiv({ cls: "daybook-year-grid" });
		grid.createDiv({ cls: "daybook-year-corner" });
		for (let d = 1; d <= 31; d++) grid.createDiv({ cls: "daybook-year-num", text: d % 5 === 0 || d === 1 ? String(d) : "" });

		for (const row of yearRows(year)) {
			const first = row.days[0]!;
			const label = grid.createDiv({
				cls: "daybook-year-month",
				text: monthName(row.month, locale, "short"),
				attr: { role: "button", tabindex: "0", "aria-label": `Open ${monthName(row.month, locale)}` },
			});
			label.addEventListener("click", () => this.openMonth(first));
			label.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this.openMonth(first);
				}
			});

			for (const day of row.days) {
				const tags = tagsByDay.get(day);
				const allTags = catTags.get(day);
				const cats = allTags ? categoriesFor(allTags, usable) : [];
				const shown = highlight === "all" ? cats : cats.filter((c) => c.tag.toLowerCase() === highlight);
				const box = grid.createDiv({ cls: "daybook-year-day", attr: { "data-date": day } });
				this.boxes.set(day, box);
				const dayEvents = eventsOn(events, day);
				const first = dayEvents[0];
				if (first) {
					box.addClass("has-event");
					box.setCssProps({ "--daybook-event": eventColour(this.plugin, first) });
					box.toggleClass("is-event-start", first.start === day);
					box.toggleClass("is-event-end", first.end === day);
				}
				box.toggleClass("has-note", tags !== undefined);
				box.toggleClass("is-today", day === today);
				box.toggleClass("is-weekend", weekday(day) === 0 || weekday(day) === 6);
				box.toggleClass("is-dim", highlight !== "all" && shown.length === 0);
				const fill = boxFill(shown.map((c) => c.color));
				if (fill) {
					box.addClass("has-fill");
					box.setCssProps({ "--daybook-fill": fill });
				}
				const names = [...cats.map((c) => c.name || c.tag), ...dayEvents.map((e) => e.name)].join(", ");
				box.setAttr("aria-label", `${formatDate(day, { weekday: "short", day: "numeric", month: "short" }, locale)}${names ? ` · ${names}` : ""}`);
			}
			// Keep rows aligned for short months.
			for (let d = row.days.length; d < 31; d++) grid.createDiv({ cls: "daybook-year-gap" });
		}
		this.wireDrag(grid);

		el.createDiv({
			cls: "daybook-year-hint",
			text: "Click a day to open it. Drag across days to add an event.",
		});
		this.renderEventList(el, events);
	}

	/** The year's events, as chips: click one for its menu. */
	private renderEventList(el: HTMLElement, events: DayEvent[]): void {
		if (events.length === 0) return;
		const wrap = el.createDiv({ cls: "daybook-year-events" });
		wrap.createDiv({ cls: "daybook-lane-label", text: "Events" });
		const list = wrap.createDiv({ cls: "daybook-chips" });
		// A repeating event is listed once, with how often it repeats.
		const seen = new Set<string>();
		for (const e of events) {
			if (e.repeats) {
				if (seen.has(e.name)) continue;
				seen.add(e.name);
			}
			const b = list.createEl("button", { cls: "daybook-filter-chip daybook-event-chip" });
			b.createSpan({ cls: "daybook-chip-dot is-filled" }).setCssProps({ "--daybook-cat-color": eventColour(this.plugin, e) });
			b.createSpan({ text: e.name });
			b.createSpan({ cls: "daybook-chip-count", text: e.repeats ? `${repeatLabel(e.repeats)} · ${eventRangeLabel(e)}` : eventRangeLabel(e) });
			if (e.repeats) setIcon(b.createSpan({ cls: "daybook-layout-icon daybook-event-repeat" }), "repeat");
			b.addEventListener("click", (evt) => showEventMenu(this.plugin, e, evt));
		}
	}

	/**
	 * Mouse/pen: press on a day and drag to another to add an event; a press
	 * without moving opens the day. Touch: a tap opens the day (use "+ Event"
	 * for ranges, since dragging would fight with scrolling).
	 */
	private wireDrag(grid: HTMLElement): void {
		const dateAt = (x: number, y: number): DateKey | null => {
			const el = activeDocument.elementFromPoint(x, y)?.closest<HTMLElement>(".daybook-year-day");
			return el?.getAttr("data-date") ?? null;
		};
		grid.addEventListener("pointerdown", (e) => {
			const box = (e.target as HTMLElement).closest<HTMLElement>(".daybook-year-day");
			const date = box?.getAttr("data-date");
			if (!date || e.button !== 0) return;
			if (e.pointerType === "touch") return; // handled by click
			e.preventDefault();
			grid.setPointerCapture(e.pointerId);
			this.dragFrom = date;
			this.dragTo = date;
			this.paintSelection();
		});
		grid.addEventListener("pointermove", (e) => {
			if (!this.dragFrom) return;
			const date = dateAt(e.clientX, e.clientY);
			if (date && date !== this.dragTo) {
				this.dragTo = date;
				this.paintSelection();
			}
		});
		const finish = (e: PointerEvent, cancel: boolean) => {
			if (!this.dragFrom) return;
			if (grid.hasPointerCapture(e.pointerId)) grid.releasePointerCapture(e.pointerId);
			const from = this.dragFrom;
			const to = this.dragTo ?? from;
			this.dragFrom = this.dragTo = null;
			this.paintSelection();
			if (cancel) return;
			if (from === to) this.openDay(from);
			else {
				const [a, b] = orderRange(from, to);
				newEvent(this.plugin, a, b);
			}
		};
		grid.addEventListener("pointerup", (e) => finish(e, false));
		grid.addEventListener("pointercancel", (e) => finish(e, true));
		grid.addEventListener("click", (e) => {
			// Touch taps arrive as clicks.
			const box = (e.target as HTMLElement).closest<HTMLElement>(".daybook-year-day");
			const date = box?.getAttr("data-date");
			if (date && e.pointerType === "touch") this.openDay(date);
		});
	}

	private paintSelection(): void {
		const [a, b] = this.dragFrom && this.dragTo ? orderRange(this.dragFrom, this.dragTo) : ["", ""];
		for (const [date, box] of this.boxes) box.toggleClass("is-selecting", a !== "" && date >= a && date <= b);
	}
}
