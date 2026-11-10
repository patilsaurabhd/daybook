// Year level: 12 rows (months) of day boxes coloured by category. A legend
// picks which category to highlight. Click a box for the day, a month name
// for the month. Drag across boxes to add an event (a trip, a conference);
// event days are underlined and listed below the grid.

import { Component, debounce, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, formatDate, monthName, parseKey, todayKey, weekday } from "../core/dates";
import { dayKeyFromPath } from "../core/paths";
import { boxFill, categoriesFor, countByCategory, yearRows, yearStats } from "../core/year";
import { Category } from "../core/types";
import { DayEvent, eventDates, eventsOn, orderRange } from "../core/event";
import { eventColour, newEvent } from "./eventActions";

/** yearHighlight value for one event, picked in the event list. */
const EVENT_PREFIX = "event:";
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
		// What's highlighted: "all", a category tag, or "event:<name>" (picked in the event list).
		let highlight = this.plugin.yearHighlight;
		const eventName = highlight.startsWith(EVENT_PREFIX) ? highlight.slice(EVENT_PREFIX.length) : null;
		const valid = highlight === "all" || (eventName !== null ? events.some((e) => e.name === eventName) : usable.some((c) => c.tag.toLowerCase() === highlight));
		if (!valid) highlight = this.plugin.yearHighlight = "all";
		const pickedEvent = highlight.startsWith(EVENT_PREFIX) ? highlight.slice(EVENT_PREFIX.length) : null;
		const pickedEventDays = new Set<DateKey>();
		if (pickedEvent) {
			for (const e of events) if (e.name === pickedEvent) for (const d of eventDates(e, `${year}-01-01`, `${year}-12-31`)) pickedEventDays.add(d);
		}

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
		if (pickedEvent) {
			const ev = events.find((e) => e.name === pickedEvent)!;
			chip(highlight, pickedEvent, pickedEventDays.size, eventColour(this.plugin, ev));
		}
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
				const shown = pickedEvent ? [] : highlight === "all" ? cats : cats.filter((c) => c.tag.toLowerCase() === highlight);
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
				const inPicked = pickedEventDays.has(day);
				box.toggleClass("is-dim", highlight !== "all" && shown.length === 0 && !inPicked);
				const fill = inPicked ? eventColour(this.plugin, events.find((e) => e.name === pickedEvent)!) : boxFill(shown.map((c) => c.color));
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
		// The days behind the current selection, for "Year in numbers".
		const yearFrom = `${year}-01-01`;
		const yearTo = `${year}-12-31`;
		const daysOf = (tag: string) => [...catTags].filter(([, tags]) => tags.includes(tag)).map(([d]) => d);
		// Events with no category (or one that isn't set up) get their own rows,
		// since no category row counts them. One row per event, with its days.
		const known = new Set(usable.map((c) => c.tag.toLowerCase()));
		const loose = new Map<string, { name: string; colour: string; days: Set<DateKey> }>();
		for (const e of events) {
			if (e.category && known.has(e.category)) continue;
			const row = loose.get(e.name) ?? { name: e.name, colour: eventColour(this.plugin, e), days: new Set<DateKey>() };
			for (const d of eventDates(e, yearFrom, yearTo)) row.days.add(d);
			loose.set(e.name, row);
		}
		this.renderNumbers(el, year, highlight, pickedEvent, {
			categories: usable.map((c) => ({ c, days: counts.get(c.tag.toLowerCase()) ?? 0 })),
			otherEvents: [...loose.values()]
				.map((x) => ({ name: x.name, colour: x.colour, days: x.days.size }))
				.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name)),
			notes: tagsByDay.size,
			dates: pickedEvent ? [...pickedEventDays] : highlight === "all" ? [] : daysOf(highlight),
			events: pickedEvent
				? events.filter((e) => e.name === pickedEvent)
				: highlight === "all"
					? events
					: events.filter((e) => e.category === highlight),
			colour: pickedEvent
				? eventColour(this.plugin, events.find((e) => e.name === pickedEvent)!)
				: (usable.find((c) => c.tag.toLowerCase() === highlight)?.color ?? "var(--interactive-accent)"),
		});

	}

	/**
	 * "Year in numbers": with All, days per category; with one category or
	 * event, its days, how many times, the longest run, and days per month.
	 */
	private renderNumbers(
		el: HTMLElement,
		year: number,
		highlight: string,
		pickedEvent: string | null,
		data: {
			categories: { c: Category; days: number }[];
			otherEvents: { name: string; colour: string; days: number }[];
			notes: number;
			dates: DateKey[];
			events: DayEvent[];
			colour: string;
		},
	): void {
		const wrap = el.createDiv({ cls: "daybook-year-numbers" });
		const locale = moment.locale();
		const label =
			pickedEvent ?? (highlight === "all" ? null : (data.categories.find(({ c }) => c.tag.toLowerCase() === highlight)?.c.name ?? highlight));
		wrap.createDiv({ cls: "daybook-lane-label", text: label ? `${year} in numbers · ${label}` : `${year} in numbers` });

		if (highlight === "all") {
			const others = data.otherEvents;
			const max = Math.max(1, ...data.categories.map((x) => x.days), ...others.map((x) => x.days));
			const rows = wrap.createDiv({ cls: "daybook-stat-rows" });
			const statRow = (label: string, colour: string, days: number, pick: () => void) => {
				const row = rows.createDiv({ cls: "daybook-stat-row", attr: { role: "button", tabindex: "0", "aria-label": `Show ${label}` } });
				row.setCssProps({ "--daybook-cat-color": colour, "--daybook-share": `${Math.round((days / max) * 100)}%` });
				row.createSpan({ cls: "daybook-chip-dot is-filled" });
				row.createSpan({ cls: "daybook-stat-name", text: label });
				row.createDiv({ cls: "daybook-stat-bar" }).createDiv({ cls: "daybook-stat-fill" });
				row.createSpan({ cls: "daybook-stat-value", text: `${days} day${days === 1 ? "" : "s"}` });
				row.addEventListener("click", pick);
				row.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						pick();
					}
				});
			};
			for (const { c, days } of data.categories) {
				statRow(c.name || c.tag, c.color, days, () => {
					this.plugin.yearHighlight = c.tag.toLowerCase();
					this.render();
				});
			}
			// Events without a category: top 5, the rest behind "+ N more".
			const showAll = this.plugin.yearEventsOpen;
			for (const ev of showAll ? others : others.slice(0, 5)) {
				statRow(ev.name, ev.colour, ev.days, () => {
					this.plugin.yearHighlight = EVENT_PREFIX + ev.name;
					this.render();
				});
			}
			if (others.length > 5) {
				const n = others.length - 5;
				const more = rows.createDiv({
					cls: "daybook-stat-more",
					text: showAll ? "Show fewer events" : `+ ${n} more event${n === 1 ? "" : "s"}`,
					attr: { role: "button", tabindex: "0" },
				});
				const flip = () => {
					this.plugin.yearEventsOpen = !showAll;
					this.render();
				};
				more.addEventListener("click", flip);
				more.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						flip();
					}
				});
			}
			wrap.createDiv({ cls: "daybook-year-hint", text: `${data.notes} day${data.notes === 1 ? "" : "s"} with a note. Pick a category or event for more.` });
			return;
		}

		const stats = yearStats(data.dates, year);
		const tiles = wrap.createDiv({ cls: "daybook-stat-tiles" });
		const tile = (value: string, caption: string) => {
			const t = tiles.createDiv({ cls: "daybook-stat-tile" });
			t.createDiv({ cls: "daybook-stat-big", text: value });
			t.createDiv({ cls: "daybook-stat-caption", text: caption });
		};
		tile(String(stats.days), stats.days === 1 ? "day" : "days");
		const times = data.events.length;
		tile(String(times), pickedEvent ? (times === 1 ? "time" : "times") : times === 1 ? "event" : "events");
		tile(
			String(stats.longest),
			stats.longest > 1 && stats.longestFrom
				? `days in a row (from ${formatDate(stats.longestFrom, { day: "numeric", month: "short" }, locale)})`
				: "longest run (days)",
		);

		const max = Math.max(1, ...stats.byMonth);
		const bars = wrap.createDiv({ cls: "daybook-month-bars" });
		bars.setCssProps({ "--daybook-cat-color": data.colour });
		stats.byMonth.forEach((n, i) => {
			const col = bars.createDiv({ cls: "daybook-month-bar", attr: { "aria-label": `${monthName(i + 1, locale)}: ${n} day${n === 1 ? "" : "s"}` } });
			col.createDiv({ cls: "daybook-month-bar-value", text: n ? String(n) : "" });
			col.createDiv({ cls: "daybook-month-bar-fill" }).setCssProps({ "--daybook-share": `${Math.round((n / max) * 100)}%` });
			col.createDiv({ cls: "daybook-month-bar-label", text: monthName(i + 1, locale, "short").slice(0, 3) });
		});
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
