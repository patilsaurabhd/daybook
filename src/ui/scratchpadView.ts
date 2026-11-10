// The Scratchpad page: tasks and ideas that belong to no day. Task cards on
// the left (same cards as a day page), free-text Notes on the right.
// Daybook/Scratchpad.md is only created once something is written.

import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { ScratchpadEditor } from "./scratchpadEditor";

export const VIEW_TYPE_SCRATCHPAD = "daybook-scratchpad";

export class ScratchpadView extends ItemView {
	private editor: ScratchpadEditor | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: DaybookPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_SCRATCHPAD;
	}

	getDisplayText(): string {
		return "Scratchpad";
	}

	getIcon(): string {
		return "notebook-pen";
	}

	async onOpen(): Promise<void> {
		const el = this.contentEl;
		// Fills the window on desktop, like a day page, so the main card can be big.
		el.addClass("daybook-view", "daybook-scratchpad-view", "is-fill");
		const header = el.createDiv({ cls: "daybook-header" });
		const titleWrap = header.createDiv({ cls: "daybook-title-wrap" });
		titleWrap.createDiv({ cls: "daybook-title", text: "Scratchpad" });
		titleWrap.createDiv({ cls: "daybook-subtitle", text: "Tasks and ideas that don't belong to a day yet." });

		// ↙ The reverse of ↗ in the sidebar: back to the small Scratchpad under the calendar.
		const nav = header.createDiv({ cls: "daybook-nav" });
		const back = nav.createEl("button", { cls: "daybook-focus-btn", attr: { "aria-label": "Close this page and show the scratchpad under the calendar" } });
		setIcon(back.createSpan({ cls: "daybook-layout-icon" }), "arrow-down-left");
		back.createSpan({ cls: "daybook-focus-label", text: "Back to sidebar" });
		back.addEventListener("click", () => void this.backToSidebar());

		this.editor = this.addChild(new ScratchpadEditor(this.plugin, el.createDiv({ cls: "daybook-body" }), { notes: true }));
		return Promise.resolve();
	}

	/** Saves, closes this tab and shows the Scratchpad section in the right sidebar. */
	private async backToSidebar(): Promise<void> {
		await this.editor?.flush();
		if (this.plugin.settings.scratchpadCollapsed) {
			this.plugin.settings.scratchpadCollapsed = false;
			await this.plugin.saveSettings(); // the section expands
		}
		await this.plugin.revealCalendar();
		this.leaf.detach();
	}

	async onClose(): Promise<void> {
		await this.editor?.flush();
		this.contentEl.empty();
	}
}
