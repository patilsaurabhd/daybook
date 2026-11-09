// Adding a category from where you are (event dialog, day page), without
// going to settings. The tag is made from the name ("Road trips" -> road-trips).

import { Modal, Notice, Setting } from "obsidian";
import type DaybookPlugin from "../main";
import { Category } from "../core/types";
import { PROJECT_COLOURS } from "../core/project";

export function tagFromName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/^#/, "")
		.replace(/[^\p{L}\p{N}_/-]+/gu, "-")
		.replace(/^-+|-+$/g, "");
}

/** A colour not used by any category yet (falls back to the first). */
function freeColour(plugin: DaybookPlugin): string {
	const used = new Set(plugin.settings.categories.map((c) => c.color.toLowerCase()));
	return PROJECT_COLOURS.find((c) => !used.has(c.toLowerCase())) ?? PROJECT_COLOURS[0]!;
}

/** Adds a category to settings (or returns the existing one with that tag). */
export async function addCategory(plugin: DaybookPlugin, name: string, colour: string): Promise<Category | null> {
	const tag = tagFromName(name);
	if (!tag) return null;
	const existing = plugin.settings.categories.find((c) => c.tag.toLowerCase() === tag);
	if (existing) return existing;
	const category: Category = { name: name.trim(), tag, color: colour };
	plugin.settings.categories.push(category);
	await plugin.saveSettings();
	return category;
}

export class CategoryModal extends Modal {
	private name = "";
	private colour: string;

	/** `onSubmit` gets the chosen name and colour; the caller adds the category. */
	constructor(
		private plugin: DaybookPlugin,
		private onSubmit: (name: string, colour: string) => Promise<void>,
	) {
		super(plugin.app);
		this.colour = freeColour(plugin);
	}

	onOpen(): void {
		this.setTitle("New category");
		const { contentEl } = this;
		new Setting(contentEl).setName("Name").addText((t) => {
			t.setPlaceholder("Travel").onChange((v) => (this.name = v));
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					void this.submit();
				}
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(contentEl).setName("Colour").addColorPicker((c) => c.setValue(this.colour).onChange((v) => (this.colour = v)));
		contentEl.createDiv({ cls: "daybook-year-hint", text: "You can rename, recolour or remove categories later in Daybook's settings." });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Add")
					.setCta()
					.onClick(() => void this.submit()),
			);
	}

	private async submit(): Promise<void> {
		if (!tagFromName(this.name)) {
			new Notice("Give the category a name.");
			return;
		}
		this.close();
		await this.onSubmit(this.name.trim(), this.colour);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
