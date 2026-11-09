// "Move to date…": pick a day for a task. Quick picks plus any date.

import { Modal, Notice, Setting, moment } from "obsidian";
import { DateKey, Weekday, addDays, formatDate, isDateKey, todayKey, weekday } from "../core/dates";

export class MoveModal extends Modal {
	private date: DateKey;

	constructor(
		app: Modal["app"],
		private taskText: string,
		/** The day the task is on now (moving there does nothing). */
		private from: DateKey,
		private firstDayOfWeek: Weekday,
		private onPick: (date: DateKey) => void,
	) {
		super(app);
		this.date = addDays(from > todayKey() ? from : todayKey(), 1);
	}

	onOpen(): void {
		this.setTitle("Move to date");
		const { contentEl } = this;
		contentEl.createDiv({ cls: "daybook-move-task", text: this.taskText });

		const locale = moment.locale();
		const label = (d: DateKey) => formatDate(d, { weekday: "short", day: "numeric", month: "short" }, locale);
		const today = todayKey();
		const base = this.from > today ? this.from : today;
		// Start of next week, by the first-day-of-week setting.
		const daysToNextWeek = ((this.firstDayOfWeek - weekday(base) + 7) % 7) || 7;
		const picks: { name: string; date: DateKey }[] = [
			{ name: "Today", date: today },
			{ name: "Tomorrow", date: addDays(today, 1) },
			{ name: "Next week", date: addDays(base, daysToNextWeek) },
			{ name: "In a week", date: addDays(base, 7) },
		].filter((p) => p.date !== this.from);

		const quick = contentEl.createDiv({ cls: "daybook-move-quick" });
		for (const p of picks) {
			const b = quick.createEl("button", { cls: "daybook-move-pick" });
			b.createSpan({ cls: "daybook-move-pick-name", text: p.name });
			b.createSpan({ cls: "daybook-move-pick-date", text: label(p.date) });
			b.addEventListener("click", () => this.pick(p.date));
		}

		new Setting(contentEl)
			.setName("Or pick a date")
			.addText((t) => {
				t.inputEl.type = "date";
				t.setValue(this.date).onChange((v) => (this.date = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.pick(this.date);
					}
				});
			})
			.addButton((b) =>
				b
					.setButtonText("Move")
					.setCta()
					.onClick(() => this.pick(this.date)),
			);
	}

	private pick(date: DateKey): void {
		if (!isDateKey(date)) {
			new Notice("Pick a date.");
			return;
		}
		if (date === this.from) {
			new Notice("That's the day it's already on.");
			return;
		}
		this.close();
		this.onPick(date);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
