// The Scratchpad section in the right sidebar, under the calendar: a header
// (count, ↗ to the full page, collapsible and remembered), a quick-add box,
// and the open tasks as compact task cards. They work like on a day page:
// Enter adds the next task, Tab nests, drag to reorder or onto a calendar
// day, ⋯ for Move to date…

import { Component, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { ScratchpadEditor } from "./scratchpadEditor";

export class ScratchpadSection extends Component {
	private headEl!: HTMLElement;
	private chevronEl!: HTMLElement;
	private countEl!: HTMLElement;
	private editor!: ScratchpadEditor;

	constructor(
		private plugin: DaybookPlugin,
		private containerEl: HTMLElement,
	) {
		super();
	}

	onload(): void {
		const el = this.containerEl;
		el.addClass("daybook-pad");

		this.headEl = el.createDiv({ cls: "daybook-pad-head", attr: { role: "button", tabindex: "0" } });
		this.chevronEl = this.headEl.createSpan({ cls: "daybook-notes-chevron" });
		this.headEl.createSpan({ cls: "daybook-pane-title", text: "Scratchpad" });
		this.countEl = this.headEl.createSpan({ cls: "daybook-pad-count" });
		const openPage = this.headEl.createDiv({ cls: "clickable-icon daybook-pad-open", attr: { role: "button", tabindex: "0", "aria-label": "Open the scratchpad page" } });
		setIcon(openPage, "arrow-up-right");
		openPage.addEventListener("click", (e) => {
			e.stopPropagation(); // don't collapse the section
			void this.plugin.openScratchpad();
		});
		openPage.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				e.stopPropagation();
				void this.plugin.openScratchpad();
			}
		});
		const flip = () => {
			this.plugin.settings.scratchpadCollapsed = !this.plugin.settings.scratchpadCollapsed;
			void this.plugin.saveSettings(false);
			this.syncCollapsed();
		};
		this.headEl.addEventListener("click", flip);
		this.headEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				flip();
			}
		});

		const body = el.createDiv({ cls: "daybook-pad-body" });
		const add = body.createEl("input", {
			type: "text",
			cls: "daybook-pad-add",
			attr: { placeholder: "Add a task or idea…", "aria-label": "Add to the scratchpad" },
		});
		add.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" || e.isComposing) return;
			e.preventDefault();
			const text = add.value.trim();
			if (!text) return;
			add.value = "";
			void this.editor.quickAdd(text);
		});

		this.editor = this.addChild(
			new ScratchpadEditor(this.plugin, body.createDiv({ cls: "daybook-pad-list" }), {
				notes: false,
				onCount: (n) => this.countEl.setText(n ? String(n) : ""),
			}),
		);
		this.syncCollapsed();
		// e.g. "Back to sidebar" on the page expanded the section
		this.register(this.plugin.onChange(() => this.syncCollapsed()));
	}

	private syncCollapsed(): void {
		const collapsed = this.plugin.settings.scratchpadCollapsed;
		this.containerEl.toggleClass("is-collapsed", collapsed);
		setIcon(this.chevronEl, collapsed ? "chevron-right" : "chevron-down");
		this.headEl.setAttr("aria-expanded", String(!collapsed));
		this.headEl.setAttr("aria-label", collapsed ? "Show scratchpad" : "Hide scratchpad");
	}
}
