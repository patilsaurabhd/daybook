// The Habits box on a day page (bottom right): one row per habit with a tick
// and how many times it was done this week, plus "Add a habit" to add one quickly
// (every day, or just for this day). Ticks are saved in the day's "habits"
// property with the rest of the day.

import { Component, Menu, Modal, Notice, Setting, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, weekDays } from "../core/dates";
import { DayEntry } from "../core/day";
import { Habit, addHabit, addOneDayHabit, dayHabits, habitKey, removeOneDayHabit, setHabitDone, timesDone } from "../core/habit";
import { PROJECT_COLOURS } from "../core/project";

/** More rows than this and the box switches to a two-column grid. */
const MANY = 8;

export class HabitBox extends Component {
	private seenVersion = -1;

	constructor(
		private plugin: DaybookPlugin,
		private el: HTMLElement,
		private entry: DayEntry,
		private date: DateKey,
		/** The day changed (a tick, a one-day habit): save it. */
		private onChange: () => void,
	) {
		super();
	}

	onload(): void {
		this.el.addClass("daybook-habits");
		// Redraw when the habit list changes (here, in another day, in the editor).
		this.register(
			this.plugin.onChange(() => {
				if (this.plugin.habitsVersion !== this.seenVersion) void this.render();
			}),
		);
		void this.render();
	}

	private async render(): Promise<void> {
		this.seenVersion = this.plugin.habitsVersion;
		const habits = await this.plugin.habits.list();
		const el = this.el;
		el.empty();

		const head = el.createDiv({ cls: "daybook-habits-head" });
		head.createDiv({ cls: "daybook-pane-title", text: "Habits" });
		const menuBtn = head.createDiv({ cls: "clickable-icon daybook-habits-menu", attr: { role: "button", tabindex: "0", "aria-label": "Manage habits" } });
		setIcon(menuBtn, "more-horizontal");
		menuBtn.addEventListener("click", () => new HabitsModal(this.plugin).open());

		// Times done this week: other days from the index, this day as it is now.
		const days = weekDays(this.date, this.plugin.settings.firstDayOfWeek);
		const ticks = this.plugin.habits.ticks(days);
		ticks.set(this.date, this.entry.habits);

		const rows = dayHabits(habits, this.entry);
		const list = el.createDiv({ cls: "daybook-habits-list" });
		list.toggleClass("is-many", rows.length > MANY);
		for (const row of rows) {
			const item = list.createDiv({ cls: "daybook-habit" });
			item.toggleClass("is-done", row.done);
			item.toggleClass("is-one-day", row.oneDay);
			item.setCssProps({ "--daybook-habit-colour": row.colour || "var(--text-faint)" });

			const box = item.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { "aria-label": `Done: ${row.name}` } });
			box.checked = row.done;
			box.addEventListener("change", () => {
				setHabitDone(this.entry, row.key, box.checked);
				this.onChange();
				void this.render();
			});
			item.createSpan({ cls: "daybook-habit-dot" });
			item.createSpan({ cls: "daybook-habit-name", text: row.name });

			if (row.oneDay) {
				item.createSpan({ cls: "daybook-habit-count", text: "today only" });
				const keep = item.createDiv({ cls: "clickable-icon daybook-habit-action", attr: { role: "button", tabindex: "0", "aria-label": "Track this every day" } });
				setIcon(keep, "repeat");
				keep.addEventListener("click", () => void this.trackEveryDay(row.name, row.key, habits.length));
				const remove = item.createDiv({ cls: "clickable-icon daybook-habit-action", attr: { role: "button", tabindex: "0", "aria-label": "Remove from this day" } });
				setIcon(remove, "x");
				remove.addEventListener("click", () => {
					removeOneDayHabit(this.entry, row.key);
					this.onChange();
					void this.render();
				});
			} else {
				const n = timesDone(ticks, row.key, days);
				item.createSpan({ cls: "daybook-habit-count", text: `${n} this week`, attr: { "aria-label": `Done ${n} time${n === 1 ? "" : "s"} this week` } });
				// ×: remove the habit (or archive it), right where it was added.
				const remove = item.createDiv({ cls: "clickable-icon daybook-habit-action", attr: { role: "button", tabindex: "0", "aria-label": `Remove ${row.name}` } });
				setIcon(remove, "x");
				remove.addEventListener("click", (evt) => this.removeMenu(evt, row.name));
			}
		}

		// Add a habit: type a name, Enter, then "Every day" or "Just today".
		const add = el.createEl("input", { type: "text", cls: "daybook-habit-add", attr: { placeholder: "Add a habit…", "aria-label": "Add a habit" } });
		add.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" || e.isComposing) return;
			e.preventDefault();
			const name = add.value.trim();
			if (!name) return;
			const r = add.getBoundingClientRect();
			const menu = new Menu();
			menu.addItem((i) =>
				i
					.setTitle("Every day")
					.setIcon("repeat")
					.onClick(() => {
						add.value = "";
						void this.addEveryDay(name, habits.length);
					}),
			);
			menu.addItem((i) =>
				i
					.setTitle("Just today")
					.setIcon("calendar-check")
					.onClick(() => {
						add.value = "";
						addOneDayHabit(this.entry, name);
						this.onChange();
						void this.render();
					}),
			);
			menu.showAtPosition({ x: r.left, y: r.bottom });
		});
	}

	/** × on a habit: remove it from your habits, or archive it (hidden, history kept). */
	private removeMenu(evt: MouseEvent, name: string): void {
		const key = habitKey(name);
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle(`Remove ${name} from your habits`)
				.setIcon("trash")
				.onClick(() => void this.changeList((list) => {
					const at = list.findIndex((h) => habitKey(h.name) === key);
					if (at >= 0) list.splice(at, 1);
				}, `Removed ${name}. Ticks already in your day notes stay.`)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Archive (hide it, keep its history)")
				.setIcon("archive")
				.onClick(() => void this.changeList((list) => {
					const h = list.find((x) => habitKey(x.name) === key);
					if (h) h.archived = true;
				}, `Archived ${name}. Bring it back from ⋯ in the Habits box.`)),
		);
		menu.showAtMouseEvent(evt);
	}

	private async changeList(update: (list: Habit[]) => void, done: string): Promise<void> {
		try {
			await this.plugin.habits.change(update);
			new Notice(done);
		} catch (e) {
			console.error("Daybook: could not change your habits", e);
			new Notice("Daybook could not change your habits.");
		}
		await this.render();
	}

	private async addEveryDay(name: string, count: number): Promise<void> {
		try {
			await this.plugin.habits.change((list) => {
				addHabit(list, name, PROJECT_COLOURS[count % PROJECT_COLOURS.length]!);
			});
		} catch (e) {
			console.error("Daybook: could not add the habit", e);
			new Notice("Daybook could not add the habit.");
		}
		await this.render();
	}

	/** A one-day habit becomes a regular one; today's tick is kept. */
	private async trackEveryDay(name: string, key: string, count: number): Promise<void> {
		await this.addEveryDay(name, count);
		this.entry.habitsExtra = this.entry.habitsExtra.filter((n) => habitKey(n) !== key);
		this.onChange();
		await this.render();
	}
}

/** "Manage habits": colour, archive or bring back, remove from the list. */
class HabitsModal extends Modal {
	constructor(private plugin: DaybookPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle("Habits");
		void this.draw();
	}

	private async draw(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({
			cls: "daybook-carry-intro",
			text: "Archived habits are hidden from day pages. Removing a habit only takes it off this list; ticks already in your day notes stay.",
		});
		const habits = await this.plugin.habits.list();
		if (habits.length === 0) {
			contentEl.createDiv({ cls: "daybook-year-hint", text: "No habits yet. Add one from the Habits box on a day page." });
			return;
		}
		for (const h of habits) {
			const setting = new Setting(contentEl).setName(h.name).setDesc(h.archived ? "Archived" : "");
			setting.addColorPicker((c) => c.setValue(h.colour || "#888888").onChange((v) => void this.change(h, (x) => (x.colour = v), false)));
			setting.addButton((b) => b.setButtonText(h.archived ? "Bring back" : "Archive").onClick(() => void this.change(h, (x) => (x.archived = !x.archived))));
			setting.addExtraButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("Remove from the list")
					.onClick(() => void this.remove(h)),
			);
		}
	}

	private async change(h: Habit, update: (x: Habit) => void, redraw = true): Promise<void> {
		await this.plugin.habits.change((list) => {
			const x = list.find((y) => habitKey(y.name) === habitKey(h.name));
			if (x) update(x);
		});
		if (redraw) await this.draw();
	}

	private async remove(h: Habit): Promise<void> {
		await this.plugin.habits.change((list) => {
			const i = list.findIndex((y) => habitKey(y.name) === habitKey(h.name));
			if (i >= 0) list.splice(i, 1);
		});
		await this.draw();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
