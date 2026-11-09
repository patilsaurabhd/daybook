// "Go to date…": pick any day and open it.

import { App, Modal, Notice, Setting, moment } from "obsidian";
import { DateKey, addDays, formatDate, isDateKey, todayKey } from "../core/dates";

export class GoToDateModal extends Modal {
	private date: DateKey = todayKey();

	constructor(
		app: App,
		private onPick: (date: DateKey) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Go to date");
		const { contentEl } = this;
		const today = todayKey();
		const label = (d: DateKey) => formatDate(d, { weekday: "short", day: "numeric", month: "short" }, moment.locale());

		const quick = contentEl.createDiv({ cls: "daybook-move-quick" });
		for (const p of [
			{ name: "Yesterday", date: addDays(today, -1) },
			{ name: "Today", date: today },
			{ name: "Tomorrow", date: addDays(today, 1) },
		]) {
			const b = quick.createEl("button", { cls: "daybook-move-pick" });
			b.createSpan({ cls: "daybook-move-pick-name", text: p.name });
			b.createSpan({ cls: "daybook-move-pick-date", text: label(p.date) });
			b.addEventListener("click", () => this.pick(p.date));
		}

		new Setting(contentEl)
			.setName("Date")
			.addText((t) => {
				t.inputEl.type = "date";
				t.setValue(this.date).onChange((v) => (this.date = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.pick(this.date);
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			})
			.addButton((b) =>
				b
					.setButtonText("Open")
					.setCta()
					.onClick(() => this.pick(this.date)),
			);
	}

	private pick(date: DateKey): void {
		if (!isDateKey(date)) {
			new Notice("Pick a date.");
			return;
		}
		this.close();
		this.onPick(date);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
