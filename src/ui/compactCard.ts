// A small day card for the week and month views: date, category dots and
// the first few tasks ("+N more"). Tasks can be ticked here; clicking the
// card opens it out for quick editing, and ↗ goes to the day page.

import { Notice, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, formatDate, parseKey, todayKey, weekday } from "../core/dates";
import { eventsOn } from "../core/event";
import { renderEventPill } from "./eventActions";
import { applyDay, parseDay } from "../core/day";
import { dayPath } from "../core/paths";
import { SummaryRow, summarizeDay } from "../core/summary";

export interface CompactCardOptions {
	maxRows: number;
	/** Show the weekday name (week view) or just the day number (month view). */
	showWeekday: boolean;
	/** Card clicked: open it out in place. */
	onOpen: (card: CompactDayCard) => void;
	/** ↗ clicked: go to the day page. */
	onOpenPage: (date: DateKey) => void;
}

export class CompactDayCard {
	readonly path: string;
	readonly el: HTMLElement;

	constructor(
		private plugin: DaybookPlugin,
		parent: HTMLElement,
		readonly date: DateKey,
		private opts: CompactCardOptions,
	) {
		this.path = dayPath(plugin.settings.rootFolder, date);
		this.el = parent.createDiv({ cls: "daybook-mini", attr: { "data-date": date } });
		this.el.toggleClass("is-today", date === todayKey());
		this.el.toggleClass("is-past", date < todayKey());
		this.el.addEventListener("click", (evt) => {
			if ((evt.target as HTMLElement).closest("input, .daybook-mini-page, .daybook-event-pill")) return;
			if (this.el.hasClass("is-drag-end")) return; // just finished drawing an event
			this.opts.onOpen(this);
		});
	}

	/** How many tasks to list before "+N more". Returns true if it changed. */
	setMaxRows(n: number): boolean {
		if (n === this.opts.maxRows) return false;
		this.opts.maxRows = n;
		return true;
	}

	async refresh(): Promise<void> {
		const text = await this.plugin.store.read(this.path);
		const entry = text === null ? null : parseDay(text);
		const summary = summarizeDay(entry, this.opts.maxRows, this.plugin.settings.categories);
		const el = this.el;
		el.empty();

		const locale = moment.locale();
		const head = el.createDiv({
			cls: "daybook-mini-head",
			attr: { role: "button", tabindex: "0", "aria-label": `Edit tasks for ${formatDate(this.date, { weekday: "long", day: "numeric", month: "long" }, locale)}` },
		});
		head.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				this.opts.onOpen(this);
			}
		});
		if (this.opts.showWeekday) {
			head.createSpan({ cls: "daybook-mini-weekday", text: formatDate(this.date, { weekday: "short" }, locale) });
		}
		head.createSpan({ cls: "daybook-mini-date", text: String(parseKey(this.date).day) });

		const dots = head.createSpan({ cls: "daybook-mini-dots" });
		for (const cat of summary.categories) {
			const dot = dots.createSpan({ cls: "daybook-mini-dot", attr: { "aria-label": cat.name || cat.tag } });
			dot.setCssProps({ "--daybook-cat-color": cat.color });
		}
		const total = summary.open + summary.done;
		if (total > 0) head.createSpan({ cls: "daybook-mini-count", text: `${summary.done}/${total}` });
		const page = head.createSpan({ cls: "daybook-mini-page clickable-icon", attr: { role: "button", tabindex: "0", "aria-label": "Open day page" } });
		setIcon(page, "arrow-up-right");
		page.addEventListener("click", () => this.opts.onOpenPage(this.date));
		page.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.stopPropagation();
				this.opts.onOpenPage(this.date);
			}
		});

		const events = eventsOn(this.plugin.events.between(this.date, this.date), this.date);
		if (events.length) {
			const bars = el.createDiv({ cls: "daybook-mini-events" });
			const { day } = parseKey(this.date);
			// Name on the event's first day, and again at the start of each row.
			const rowStart = weekday(this.date) === this.plugin.settings.firstDayOfWeek || day === 1;
			for (const e of events) renderEventPill(this.plugin, bars, e, this.date, e.start === this.date || rowStart);
		}
		if (summary.goal) el.createDiv({ cls: "daybook-mini-goal", text: summary.goal });
		const list = el.createDiv({ cls: "daybook-mini-tasks" });
		for (const row of summary.rows) this.renderRow(list, row);
		if (summary.more > 0) el.createDiv({ cls: "daybook-mini-more", text: `+${summary.more} more` });
		if (total === 0) el.createDiv({ cls: "daybook-mini-empty", text: summary.hasDiary ? "Diary only" : "No tasks" });
	}

	private renderRow(list: HTMLElement, row: SummaryRow): void {
		const item = list.createDiv({ cls: "daybook-mini-task" });
		item.toggleClass("is-done", row.done);
		item.setCssProps({ "--daybook-depth": String(row.depth) });
		if (row.carried) {
			item.addClass("is-carried");
			const where = row.movedTo ? formatDate(row.movedTo, { day: "numeric", month: "short" }, moment.locale()) : "";
			setIcon(item.createSpan({ cls: "daybook-carried-mark", attr: { "aria-label": where ? `Moved to ${where}` : "Moved to a later day" } }), "corner-up-right");
		} else {
			const box = item.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { "aria-label": row.text } });
			box.checked = row.done;
			box.addEventListener("change", () => void this.setDone(row, box.checked));
		}
		item.createSpan({ cls: "daybook-mini-text", text: row.text });
		if (row.carried && row.movedTo) {
			item.createSpan({ cls: "daybook-moved-to", text: `→ ${formatDate(row.movedTo, { day: "numeric", month: "short" }, moment.locale())}` });
		}
	}

	/** Ticks a task in the day note, checking it's still the same task first. */
	private async setDone(row: SummaryRow, done: boolean): Promise<void> {
		try {
			await this.plugin.store.write(this.path, (old) => {
				const entry = parseDay(old);
				const task = entry.groups[row.pos.group]?.tasks[row.pos.index];
				if (!task || task.text !== row.text) return old; // note changed meanwhile
				task.done = done;
				return applyDay(old, entry);
			});
		} catch (e) {
			console.error("Daybook: could not update task", e);
			new Notice(`Daybook could not save ${this.path}.`);
		}
		await this.refresh();
	}
}
