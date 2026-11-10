// Habits on the week and month pages: a table at the bottom with your habits
// as rows, the days as columns, and how many times each was done.
// Week: seven labelled cells. Month: a small square per day.
// Click a cell to tick or untick that habit on that day (saved in the day's
// "habits" property; the day's note is created if needed).

import { Component, Notice, debounce, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, formatDate, todayKey } from "../core/dates";
import { applyDay, parseDay } from "../core/day";
import { HabitGridRow, habitGrid, setHabitDone } from "../core/habit";
import { dayPath } from "../core/paths";

export type HabitPeriod = "week" | "month";

export class HabitTable extends Component {
	/** Ticks per day as shown (updated right away when a cell is clicked). */
	private ticks = new Map<DateKey, string[]>();
	private seenVersion = -1;

	constructor(
		private plugin: DaybookPlugin,
		private el: HTMLElement,
		private days: DateKey[],
		private period: HabitPeriod,
	) {
		super();
	}

	onload(): void {
		this.el.addClass("daybook-week-habits", `is-${this.period}`);
		// Your habit list changed (added, archived, recoloured).
		this.register(
			this.plugin.onChange(() => {
				if (this.plugin.habitsVersion !== this.seenVersion) void this.render(true);
			}),
		);
		// A day of this week was ticked elsewhere (its page, another device).
		const paths = new Set(this.days.map((d) => dayPath(this.plugin.settings.rootFolder, d)));
		const refresh = debounce(() => void this.render(true), 300, true);
		this.registerEvent(
			this.plugin.app.metadataCache.on("changed", (file) => {
				if (paths.has(file.path)) refresh();
			}),
		);
		void this.render(true);
	}

	private async render(reread: boolean): Promise<void> {
		this.seenVersion = this.plugin.habitsVersion;
		if (reread) this.ticks = this.plugin.habits.ticks(this.days);
		const rows = habitGrid(await this.plugin.habits.list(), this.ticks, this.days);
		const el = this.el;
		el.empty();
		el.createDiv({ cls: "daybook-pane-title", text: "Habits" });
		if (rows.length === 0) {
			el.createDiv({ cls: "daybook-year-hint", text: "No habits yet. Add them from the Habits box on a day page." });
			return;
		}

		const locale = moment.locale();
		const today = todayKey();
		const month = this.period === "month";
		const grid = el.createDiv({ cls: "daybook-week-habits-grid", attr: { role: "table", "aria-label": `Habits this ${this.period}` } });
		grid.setCssProps({ "--daybook-habit-days": String(this.days.length) });

		// Header: blank corner, the days, and the count column.
		grid.createDiv({ cls: "daybook-wh-corner" });
		for (const d of this.days) {
			const head = grid.createDiv({ cls: "daybook-wh-day", attr: { role: "columnheader" } });
			head.toggleClass("is-today", d === today);
			if (month) {
				// Day numbers on the 1st and every 5th (and today), so the row stays readable.
				const n = Number(d.slice(8));
				if (n === 1 || n % 5 === 0 || d === today) head.setText(String(n));
				head.setAttr("aria-label", formatDate(d, { weekday: "short", day: "numeric" }, locale));
				continue;
			}
			// Short names ("Mon"), or single letters when the table is narrow.
			const weekday = head.createDiv({ cls: "daybook-wh-weekday" });
			weekday.createSpan({ cls: "daybook-wh-short", text: formatDate(d, { weekday: "short" }, locale) });
			weekday.createSpan({ cls: "daybook-wh-narrow", text: formatDate(d, { weekday: "narrow" }, locale) });
			head.createDiv({ cls: "daybook-wh-date", text: String(Number(d.slice(8))) });
		}
		grid.createDiv({ cls: "daybook-wh-countcol", text: month ? "Month" : "Week" });

		for (const row of rows) this.renderRow(grid, row, today);
	}

	private renderRow(grid: HTMLElement, row: HabitGridRow, today: DateKey): void {
		const name = grid.createDiv({ cls: "daybook-wh-name", attr: { role: "rowheader" } });
		name.setCssProps({ "--daybook-habit-colour": row.colour || "var(--text-faint)" });
		name.createSpan({ cls: "daybook-habit-dot" });
		name.createSpan({ cls: "daybook-habit-name", text: row.name });

		this.days.forEach((day, i) => {
			const done = row.done[i]!;
			const label = `${row.name}, ${formatDate(day, { weekday: "long", day: "numeric", month: "short" }, moment.locale())}: ${done ? "done" : "not done"}`;
			const cell = grid.createDiv({ cls: "daybook-wh-cell", attr: { role: "checkbox", tabindex: "0", "aria-checked": String(done), "aria-label": label } });
			cell.setCssProps({ "--daybook-habit-colour": row.colour || "var(--interactive-accent)" });
			cell.toggleClass("is-done", done);
			cell.toggleClass("is-today", day === today);
			if (done && this.period === "week") setIcon(cell, "check");
			const toggle = () => void this.setDone(row.key, day, !done);
			cell.addEventListener("click", toggle);
			cell.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					toggle();
				}
			});
		});

		grid.createDiv({ cls: "daybook-wh-count", text: `${row.count}×`, attr: { "aria-label": `Done ${row.count} time${row.count === 1 ? "" : "s"} this ${this.period}` } });
	}

	/** Ticks or unticks a habit on a day: shown at once, then saved to that day's note. */
	private async setDone(key: string, day: DateKey, done: boolean): Promise<void> {
		const before = this.ticks.get(day) ?? [];
		const entry = { habits: [...before] };
		setHabitDone(entry, key, done);
		this.ticks.set(day, entry.habits);
		await this.render(false);
		try {
			await this.plugin.store.write(
				dayPath(this.plugin.settings.rootFolder, day),
				(old) => {
					const e = parseDay(old);
					setHabitDone(e, key, done);
					return applyDay(old, e);
				},
				{ fromElsewhere: true }, // that day may be open on its page
			);
		} catch (e) {
			console.error("Daybook: could not save the habit", e);
			new Notice("Daybook could not save the habit.");
			this.ticks.set(day, before);
			await this.render(false);
		}
	}
}
