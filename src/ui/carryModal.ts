// "What would be carried over": the unfinished tasks of an earlier day,
// card by card, each with a checkbox. Only ticked tasks move; the rest stay
// open on their own day.

import { App, Modal } from "obsidian";
import { OpenCard } from "../core/day";
import { parseCardLink } from "../core/project";

export class CarryModal extends Modal {
	/** Selected task keys -> text (the text is re-checked when moving). */
	private selected = new Map<string, string>();
	private boxes = new Map<string, HTMLInputElement>();
	private cardBoxes: { box: HTMLInputElement; keys: string[] }[] = [];
	private goBtn!: HTMLButtonElement;
	private padBtn: HTMLButtonElement | null = null;

	constructor(
		app: App,
		private fromLabel: string,
		private cards: OpenCard[],
		private onConfirm: (selected: Map<string, string>) => void,
		/** "Send to scratchpad": the ticked tasks go there instead of today. */
		private onSendToScratchpad?: (selected: Map<string, string>) => void,
	) {
		super(app);
		for (const c of cards) for (const t of c.tasks) this.selected.set(t.key, t.text);
	}

	onOpen(): void {
		this.modalEl.addClass("daybook-carry-modal");
		const total = this.cards.reduce((n, c) => n + c.tasks.length, 0);
		this.setTitle(`Unfinished on ${this.fromLabel}`);
		const { contentEl } = this;
		contentEl.createDiv({
			cls: "daybook-carry-intro",
			text: `${total} unfinished task${total === 1 ? "" : "s"}. Tick the ones to bring here; the rest stay where they are.`,
		});

		const tools = contentEl.createDiv({ cls: "daybook-carry-tools" });
		const all = tools.createEl("button", { text: "Select all" });
		all.addEventListener("click", () => this.setAll(true));
		const none = tools.createEl("button", { text: "Select none" });
		none.addEventListener("click", () => this.setAll(false));

		const list = contentEl.createDiv({ cls: "daybook-carry-list" });
		for (const card of this.cards) {
			const section = list.createDiv({ cls: "daybook-carry-card" });
			const head = section.createEl("label", { cls: "daybook-carry-card-head" });
			const cardBox = head.createEl("input", { type: "checkbox" });
			head.createSpan({ text: cardLabel(card.name) });
			head.createSpan({ cls: "daybook-carry-count", text: String(card.tasks.length) });
			const keys = card.tasks.map((t) => t.key);
			this.cardBoxes.push({ box: cardBox, keys });
			cardBox.addEventListener("change", () => {
				for (const t of card.tasks) this.set(t.key, t.text, cardBox.checked);
				this.sync();
			});

			for (const t of card.tasks) {
				const row = section.createEl("label", { cls: "daybook-carry-task" });
				row.setCssProps({ "--daybook-depth": String(t.depth) });
				const box = row.createEl("input", { type: "checkbox" });
				row.createSpan({ text: t.text });
				this.boxes.set(t.key, box);
				box.addEventListener("change", () => {
					this.set(t.key, t.text, box.checked);
					this.sync();
				});
			}
		}

		const footer = contentEl.createDiv({ cls: "daybook-carry-footer" });
		const cancel = footer.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		if (this.onSendToScratchpad) {
			const send = this.onSendToScratchpad;
			this.padBtn = footer.createEl("button", { attr: { "aria-label": "Put the ticked tasks on the scratchpad instead of today" } });
			this.padBtn.addEventListener("click", () => {
				if (this.selected.size === 0) return;
				const picked = new Map(this.selected);
				this.close();
				send(picked);
			});
		}
		this.goBtn = footer.createEl("button", { cls: "mod-cta" });
		this.goBtn.addEventListener("click", () => {
			if (this.selected.size === 0) return;
			const picked = new Map(this.selected);
			this.close();
			this.onConfirm(picked);
		});
		this.sync();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private set(key: string, text: string, on: boolean): void {
		if (on) this.selected.set(key, text);
		else this.selected.delete(key);
	}

	private setAll(on: boolean): void {
		for (const c of this.cards) for (const t of c.tasks) this.set(t.key, t.text, on);
		this.sync();
	}

	private sync(): void {
		for (const [key, box] of this.boxes) box.checked = this.selected.has(key);
		for (const { box, keys } of this.cardBoxes) {
			const n = keys.filter((k) => this.selected.has(k)).length;
			box.checked = n === keys.length;
			box.indeterminate = n > 0 && n < keys.length;
		}
		const n = this.selected.size;
		this.goBtn.setText(n === 0 ? "Nothing selected" : `Carry over ${n} task${n === 1 ? "" : "s"}`);
		this.goBtn.disabled = n === 0;
		if (this.padBtn) {
			this.padBtn.setText("Send to scratchpad");
			this.padBtn.disabled = n === 0;
		}
	}
}

function cardLabel(name: string | null): string {
	if (name === null) return "Tasks";
	const link = parseCardLink(name);
	if (!link) return name || "Untitled";
	if (link.milestoneId) return `${link.project} › ${link.alias ?? "milestone"}`;
	return link.title ? `${link.project} › ${link.title}` : link.project;
}
