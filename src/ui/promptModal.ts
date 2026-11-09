// A small "type a name" dialog.

import { App, Modal, Setting } from "obsidian";

export class PromptModal extends Modal {
	private value = "";
	private done = false;

	constructor(
		app: App,
		private heading: string,
		private placeholder: string,
		private actionLabel: string,
		private onSubmit: (value: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.heading);
		new Setting(this.contentEl).addText((text) => {
			text.setPlaceholder(this.placeholder).onChange((v) => (this.value = v));
			text.inputEl.addClass("daybook-prompt-input");
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					this.submit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.actionLabel)
					.setCta()
					.onClick(() => this.submit()),
			);
	}

	private submit(): void {
		if (this.done || !this.value.trim()) return;
		this.done = true;
		this.close();
		this.onSubmit(this.value.trim());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
