// The main-area Daybook view. One view, four zoom levels (day, week, month,
// year). Stage 1 implements the day level; the others show a placeholder.

import { ItemView, TAbstractFile, TFile, ViewStateResult, WorkspaceLeaf, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import {
	DateKey,
	addDays,
	addMonthsToKey,
	addYearsToKey,
	formatLongDate,
	isDateKey,
	monthName,
	parseKey,
	todayKey,
	weekIdFor,
	weekDays,
	formatRange,
	daysInMonth,
	toKey,
} from "../core/dates";
import { DayLayout, Selection, ZoomLevel } from "../core/types";
import { DayCard } from "./dayCard";
import { MonthBoard, WeekBoard } from "./weekView";
import { HabitTable } from "./habitTable";
import { PeriodNote } from "./periodNote";
import { monthPath, weekPath, yearPath } from "../core/paths";
import { YearBoard } from "./yearView";
import { firstGoal, parsePeriod } from "../core/period";
import { eventsOn } from "../core/event";
import { newEvent, renderEventBanner } from "./eventActions";

export const VIEW_TYPE_DAYBOOK = "daybook-view";

const LEVELS: ZoomLevel[] = ["day", "week", "month", "year"];

export class DaybookView extends ItemView {
	private level: ZoomLevel = "day";
	private date: DateKey = todayKey();
	private rendered: string | null = null;
	private card: DayCard | null = null;
	private board: WeekBoard | MonthBoard | YearBoard | null = null;
	private goals: PeriodNote | null = null;
	/** Week and month views' habit table at the bottom. */
	private habits: HabitTable | null = null;
	/** Week view's tasks/reflection container. */
	private splitEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: DaybookPlugin) {
		super(leaf);
		this.navigation = true; // take part in back/forward history
	}

	getViewType(): string {
		return VIEW_TYPE_DAYBOOK;
	}

	getIcon(): string {
		return "calendar-days";
	}

	getDisplayText(): string {
		const { year, month } = parseKey(this.date);
		const locale = moment.locale();
		switch (this.level) {
			case "day":
				return formatLongDate(this.date, locale);
			case "week": {
				const w = weekIdFor(this.date, this.plugin.settings.firstDayOfWeek);
				return `Week ${w.week}, ${w.year}`;
			}
			case "month":
				return `${monthName(month, locale)} ${year}`;
			case "year":
				return String(year);
		}
	}

	getState(): Record<string, unknown> {
		return { level: this.level, date: this.date };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as Partial<Selection>;
		if (s.level && LEVELS.includes(s.level)) this.level = s.level;
		if (isDateKey(s.date)) this.date = s.date;
		await this.show();
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("daybook-view");

		// Settings changed (e.g. root folder, first day of week): redraw.
		const layoutSettings = () => {
			const { rootFolder, firstDayOfWeek, categories } = this.plugin.settings;
			return JSON.stringify({ rootFolder, firstDayOfWeek, categories });
		};
		let lastSettings = layoutSettings();
		let seenEvents = this.plugin.eventsVersion;
		let seenRules = this.plugin.recurringVersion;
		this.register(
			this.plugin.onChange(() => {
				this.applyFocus();
				// An event was added, moved or deleted: redraw (unless the user is typing here).
				if (this.plugin.recurringVersion !== seenRules) {
					seenRules = this.plugin.recurringVersion;
					if (this.level === "day" && !this.card?.hasFocus() && !this.card?.isDirty()) void this.show(true);
				}
				if (this.plugin.eventsVersion !== seenEvents) {
					seenEvents = this.plugin.eventsVersion;
					if (!this.card?.hasFocus()) void this.show(true);
					return;
				}
				const now = layoutSettings();
				if (now !== lastSettings) {
					lastSettings = now;
					void this.show(true);
				}
			}),
		);

		// Esc leaves focus mode (unless you're typing or a dialog is open).
		this.registerDomEvent(this.contentEl, "keydown", (e) => {
			if (e.key !== "Escape" || !this.plugin.focusMode) return;
			const t = e.target as HTMLElement;
			if (t.closest("input, textarea, .daybook-popover")) return;
			this.plugin.exitFocus();
		});

		// Pick up edits made to the note elsewhere (editor, sync, another device).
		this.registerEvent(this.app.vault.on("modify", (file) => void this.onFileChanged(file)));
		this.registerEvent(this.app.vault.on("delete", (file) => void this.onFileChanged(file)));
		this.registerEvent(this.app.vault.on("create", (file) => void this.onFileChanged(file)));

		await this.show();
	}

	async onClose(): Promise<void> {
		await this.dropCard();
		this.contentEl.empty();
	}

	/** Moves this view to another date/level, recording it in history. */
	private navigate(level: ZoomLevel, date: DateKey): void {
		void this.leaf.setViewState({ type: VIEW_TYPE_DAYBOOK, active: true, state: { level, date } }, { history: true });
	}

	private step(direction: 1 | -1): void {
		const d = this.date;
		const next =
			this.level === "day"
				? addDays(d, direction)
				: this.level === "week"
					? addDays(d, 7 * direction)
					: this.level === "month"
						? addMonthsToKey(d, direction)
						: addYearsToKey(d, direction);
		this.navigate(this.level, next);
	}

	private async onFileChanged(file: TAbstractFile): Promise<void> {
		this.board?.onFileChanged(file.path);
		if (this.card && this.plugin.projects.isProjectPath(file.path)) {
			const text = file instanceof TFile ? await this.plugin.store.read(file.path) : null;
			if (text === null || !this.plugin.store.isOwnWrite(file.path, text)) await this.card.reloadProjects();
			return;
		}
		void this.goals?.onFileChanged(file.path);
		const card = this.card;
		if (!card || file.path !== card.path) return;
		if (file instanceof TFile) {
			const text = await this.plugin.store.read(file.path);
			if (text !== null && this.plugin.store.isOwnWrite(file.path, text, card)) return;
		}
		await card.reloadFromDisk();
	}

	private async dropCard(): Promise<void> {
		if (this.goals) {
			const goals = this.goals;
			this.goals = null;
			await goals.flush();
			this.removeChild(goals);
		}
		if (this.habits) {
			this.removeChild(this.habits);
			this.habits = null;
		}
		if (this.board) {
			this.removeChild(this.board);
			this.board = null;
		}
		if (!this.card) return;
		const card = this.card;
		this.card = null;
		await card.flush();
		this.removeChild(card);
	}

	private async show(force = false): Promise<void> {
		this.plugin.setSelection({ level: this.level, date: this.date });
		const key = `${this.level}|${this.date}`;
		if (!force && key === this.rendered) return;
		this.rendered = key;

		await this.dropCard();
		this.splitEl = null;
		const el = this.contentEl;
		el.empty();
		// Day page fills the window: goals on top, tasks/diary in the middle, notes at the bottom.
		// Day and week pages fill the window on desktop (cards stretch to the bottom).
		el.toggleClass("is-fill", this.level === "day" || this.level === "week");
		if (this.plugin.focusMode && this.level !== "day") this.plugin.exitFocus();
		this.renderHeader(el);
		this.applyFocus();
		const body = el.createDiv({ cls: "daybook-body" });

		if (this.level === "day") {
			const card = new DayCard(this.plugin, body.createDiv(), this.date);
			this.card = card;
			this.addChild(card);
			await card.init();
		} else if (this.level === "week") {
			const week = weekIdFor(this.date, this.plugin.settings.firstDayOfWeek);
			await this.renderPeriod(body, weekPath(this.plugin.settings.rootFolder, week), "week", (pane) =>
				new WeekBoard(this.plugin, pane, this.date, (date) => this.navigate("day", date)),
			);
			// Habits: one row each, the week's days as columns, at the bottom.
			const days = weekDays(this.date, this.plugin.settings.firstDayOfWeek);
			this.habits = this.addChild(new HabitTable(this.plugin, body.createDiv(), days, "week"));
		} else if (this.level === "month") {
			const { year, month } = parseKey(this.date);
			await this.renderPeriod(body, monthPath(this.plugin.settings.rootFolder, year, month), "month", (pane) =>
				new MonthBoard(
					this.plugin,
					pane,
					this.date,
					(date) => this.navigate("day", date),
					(date) => this.navigate("week", date),
				),
			);
			// Habits: one row each, a small square per day of the month, at the bottom.
			const monthDays = Array.from({ length: daysInMonth(year, month) }, (_, i) => toKey(year, month, i + 1));
			this.habits = this.addChild(new HabitTable(this.plugin, body.createDiv(), monthDays, "month"));
		} else {
			const { year } = parseKey(this.date);
			await this.renderPeriod(body, yearPath(this.plugin.settings.rootFolder, year), "year", (pane) =>
				new YearBoard(
					this.plugin,
					pane,
					this.date,
					(date) => this.navigate("day", date),
					(date) => this.navigate("month", date),
				),
			);
		}
	}

	/** Week or month: goals on top, then day cards and the reflection (Tasks | Both | Reflection). */
	private async renderPeriod(body: HTMLElement, notePath: string, noun: string, makeBoard: (pane: HTMLElement) => WeekBoard | MonthBoard | YearBoard): Promise<void> {
		const note = new PeriodNote(this.plugin, notePath);
		this.goals = note;
		this.addChild(note);
		await note.read();
		note.addBox(body, "goals", `Goals for the ${noun}`, `What matters this ${noun}? Start a line with - or 1. for a list`);

		const split = body.createDiv({ cls: "daybook-panes daybook-week-split" });
		this.splitEl = split;
		const tasksPane = split.createDiv({ cls: "daybook-pane daybook-pane-tasks" });
		const reflectionPane = split.createDiv({ cls: "daybook-pane daybook-pane-diary" });
		note.addBox(reflectionPane, "reflection", "Reflection", `How did the ${noun} go? Paste or drop images here`, { minRows: 8, images: true });
		this.applyLayout();

		const board = makeBoard(tasksPane);
		this.board = board;
		this.addChild(board);
		await board.draw();
	}

	/** The layout setting for the current level. */
	private get layout(): DayLayout {
		const s = this.plugin.settings;
		return this.level === "day" ? s.dayLayout : this.level === "week" ? s.weekLayout : this.level === "month" ? s.monthLayout : s.yearLayout;
	}

	private set layout(value: DayLayout) {
		const s = this.plugin.settings;
		if (this.level === "day") s.dayLayout = value;
		else if (this.level === "week") s.weekLayout = value;
		else if (this.level === "month") s.monthLayout = value;
		else s.yearLayout = value;
		void this.plugin.saveSettings(false);
	}

	private applyLayout(): void {
		if (this.level === "day") {
			this.card?.applyLayout();
		} else if (this.splitEl) {
			this.splitEl.toggleClass("is-diary-hidden", this.layout === "tasks");
			this.splitEl.toggleClass("is-tasks-hidden", this.layout === "diary");
		}
	}

	/** Tasks | Both | Diary (or Reflection) switch. */
	private renderLayoutSwitch(parent: HTMLElement): void {
		const writing = this.level === "day" ? "Diary" : "Reflection";
		const options: { value: DayLayout; label: string; icon: string; hint: string }[] = [
			this.level === "year"
				? { value: "tasks", label: "Year", icon: "layout-grid", hint: "Show only the year grid" }
				: { value: "tasks", label: "Tasks", icon: "list-checks", hint: "Show only tasks" },
			{ value: "both", label: "Both", icon: "columns-2", hint: `Show tasks and ${writing.toLowerCase()} side by side` },
			{ value: "diary", label: writing, icon: "book-open", hint: `Show only the ${writing.toLowerCase()}` },
		];
		const group = parent.createDiv({ cls: "daybook-layout", attr: { role: "radiogroup", "aria-label": "Layout" } });
		const buttons = options.map((o) => {
			const b = group.createEl("button", { cls: "daybook-layout-btn", attr: { role: "radio", "aria-label": o.hint } });
			setIcon(b.createSpan({ cls: "daybook-layout-icon" }), o.icon);
			b.createSpan({ text: o.label });
			b.addEventListener("click", () => {
				// "Both" starts with every project collapsed.
				if (this.level === "day" && o.value === "both") this.plugin.bothExpanded.clear();
				this.layout = o.value;
				sync();
				this.applyLayout();
			});
			return b;
		});
		const sync = () => {
			options.forEach((o, i) => {
				const on = this.layout === o.value;
				buttons[i]!.toggleClass("is-active", on);
				buttons[i]!.setAttr("aria-checked", String(on));
			});
		};
		sync();
	}

	/**
	 * Faint reminder of the bigger picture: the first goal of the week /
	 * month / year this page sits in. Click one to go there.
	 */
	private renderParentGoals(parent: HTMLElement): void {
		const root = this.plugin.settings.rootFolder;
		const { year, month } = parseKey(this.date);
		const week = { label: "Week", level: "week" as ZoomLevel, path: weekPath(root, weekIdFor(this.date, this.plugin.settings.firstDayOfWeek)) };
		const monthItem = { label: "Month", level: "month" as ZoomLevel, path: monthPath(root, year, month) };
		const yearItem = { label: "Year", level: "year" as ZoomLevel, path: yearPath(root, year) };
		const items = this.level === "day" ? [week, monthItem] : this.level === "week" ? [monthItem, yearItem] : this.level === "month" ? [yearItem] : [];
		if (items.length === 0) return;

		const line = parent.createDiv({ cls: "daybook-parent-goals" });
		line.hide();
		const date = this.date;
		void (async () => {
			for (const item of items) {
				const text = await this.plugin.store.read(item.path);
				const goal = text ? firstGoal(parsePeriod(text).goals) : "";
				if (!goal) continue;
				const span = line.createSpan({ cls: "daybook-parent-goal", attr: { role: "link", tabindex: "0", "aria-label": `Go to this ${item.level}` } });
				span.createSpan({ cls: "daybook-parent-goal-label", text: `${item.label}: ` });
				span.createSpan({ text: goal });
				span.addEventListener("click", () => this.navigate(item.level, date));
				span.addEventListener("keydown", (e) => {
					if (e.key === "Enter") this.navigate(item.level, date);
				});
				line.show();
			}
		})();
	}

	private applyFocus(): void {
		const on = this.plugin.focusMode && this.level === "day";
		this.contentEl.toggleClass("is-daybook-focus", on);
		this.focusBtn?.toggleClass("is-active", on);
		this.focusBtn?.setAttr("aria-label", on ? "Leave focus mode (Esc)" : "Focus on this day");
		this.focusBtn?.querySelector(".daybook-focus-label")?.setText(on ? "Exit focus" : "Focus");
	}

	private focusBtn: HTMLElement | null = null;

	/** "November" link to the month view. */
	private monthLink(parent: HTMLElement, date: DateKey): void {
		const { month } = parseKey(date);
		this.upLink(parent, monthName(month, moment.locale()), "month", date);
	}

	/** "2026" link to the year view. */
	private yearLink(parent: HTMLElement, date: DateKey): void {
		this.upLink(parent, String(parseKey(date).year), "year", date);
	}

	private upLink(parent: HTMLElement, text: string, level: ZoomLevel, date: DateKey): void {
		const link = parent.createSpan({ cls: "daybook-link", text, attr: { role: "button", tabindex: "0", "aria-label": `Open ${level}` } });
		link.addEventListener("click", () => this.navigate(level, date));
		link.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				this.navigate(level, date);
			}
		});
	}

	private renderHeader(el: HTMLElement): void {
		const header = el.createDiv({ cls: "daybook-header" });

		const titleWrap = header.createDiv({ cls: "daybook-title-wrap" });
		titleWrap.createDiv({ cls: "daybook-title", text: this.getDisplayText() });

		if (this.level === "day") {
			const w = weekIdFor(this.date, this.plugin.settings.firstDayOfWeek);
			const sub = titleWrap.createDiv({ cls: "daybook-subtitle" });
			const weekLink = sub.createSpan({
				cls: "daybook-link",
				text: `Week ${w.week}`,
				attr: { role: "button", tabindex: "0" },
			});
			weekLink.addEventListener("click", () => this.navigate("week", this.date));
			this.monthLink(sub, this.date);
			this.yearLink(sub, this.date);
			if (this.date === todayKey()) sub.createSpan({ cls: "daybook-today-badge", text: "Today" });
			const events = eventsOn(this.plugin.events.between(this.date, this.date), this.date);
			if (events.length) {
				const banners = titleWrap.createDiv({ cls: "daybook-event-banners" });
				for (const e of events) renderEventBanner(this.plugin, banners, e, this.date);
			}
		} else if (this.level === "week") {
			const days = weekDays(this.date, this.plugin.settings.firstDayOfWeek);
			const sub = titleWrap.createDiv({ cls: "daybook-subtitle" });
			sub.createSpan({ text: formatRange(days[0]!, days[6]!, moment.locale()) });
			const inMonth = days.find((d) => d.slice(0, 7) === this.date.slice(0, 7)) ?? this.date;
			this.monthLink(sub, inMonth);
			this.yearLink(sub, inMonth);
			if (days.includes(todayKey())) sub.createSpan({ cls: "daybook-today-badge", text: "This week" });
		} else if (this.level === "month") {
			const sub = titleWrap.createDiv({ cls: "daybook-subtitle" });
			this.yearLink(sub, this.date);
			if (this.date.slice(0, 7) === todayKey().slice(0, 7)) sub.createSpan({ cls: "daybook-today-badge", text: "This month" });
		} else if (this.level === "year" && this.date.slice(0, 4) === todayKey().slice(0, 4)) {
			titleWrap.createDiv({ cls: "daybook-subtitle" }).createSpan({ cls: "daybook-today-badge", text: "This year" });
		}

		this.renderParentGoals(titleWrap);

		const nav = header.createDiv({ cls: "daybook-nav" });

		this.focusBtn = null;
		if (this.level === "day") {
			const btn = nav.createEl("button", { cls: "daybook-focus-btn" });
			setIcon(btn.createSpan({ cls: "daybook-layout-icon" }), "focus");
			btn.createSpan({ cls: "daybook-focus-label", text: "Focus" });
			btn.addEventListener("click", () => {
				if (this.plugin.focusMode) this.plugin.exitFocus();
				else void this.plugin.enterFocus(this.date);
			});
			this.focusBtn = btn;
		}
		if (this.level !== "year") {
			const hint = this.level === "day" ? "Add an event starting this day" : "Add an event (or drag across days)";
			const ev = nav.createEl("button", { cls: "daybook-add-event", attr: { "aria-label": hint } });
			setIcon(ev.createSpan({ cls: "daybook-layout-icon" }), "calendar-plus");
			ev.createSpan({ text: "Event" });
			ev.addEventListener("click", () => {
				const today = todayKey();
				const start = this.level === "month" ? (today.slice(0, 7) === this.date.slice(0, 7) ? today : this.date.slice(0, 8) + "01") : this.date;
				newEvent(this.plugin, start, start);
			});
		}
		this.renderLayoutSwitch(nav);

		const prev = nav.createDiv({ cls: "clickable-icon", attr: { "aria-label": `Previous ${this.level}`, role: "button", tabindex: "0" } });
		setIcon(prev, "chevron-left");
		prev.addEventListener("click", () => this.step(-1));

		const today = nav.createEl("button", { cls: "daybook-today-btn", text: "Today" });
		today.addEventListener("click", () => this.navigate(this.level, todayKey()));

		const next = nav.createDiv({ cls: "clickable-icon", attr: { "aria-label": `Next ${this.level}`, role: "button", tabindex: "0" } });
		setIcon(next, "chevron-right");
		next.addEventListener("click", () => this.step(1));
	}
}
