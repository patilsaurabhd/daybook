// A day's tasks, opened out in place over a compact card (week/month views).
// Full task editing: add, tick, nest, drag, task cards. "Open day" goes to the
// day page. Esc or a click outside closes it; edits are saved.

import { Component, Notice, debounce, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, formatLongDate } from "../core/dates";
import { DayEntry, applyDay, emptyDay, parseDay } from "../core/day";
import { dayPath } from "../core/paths";
import { TaskBoard } from "./taskBoard";

const SAVE_DELAY_MS = 600;

export interface DayPopoverOptions {
	onOpenPage: (date: DateKey) => void;
	onClose: () => void;
}

export class DayPopover extends Component {
	readonly path: string;
	private el!: HTMLElement;
	private entry: DayEntry = emptyDay();
	private dirty = false;
	private saving: Promise<void> = Promise.resolve();
	private closing = false;
	private readonly saveSoon = debounce(() => void this.flush(), SAVE_DELAY_MS, true);

	constructor(
		private plugin: DaybookPlugin,
		/** Positioned element the popover floats in. */
		private host: HTMLElement,
		/** The compact card it opens out of. */
		private anchor: HTMLElement,
		readonly date: DateKey,
		private opts: DayPopoverOptions,
	) {
		super();
		this.path = dayPath(plugin.settings.rootFolder, date);
	}

	onload(): void {
		this.el = this.host.createDiv({ cls: "daybook-popover", attr: { role: "dialog", "aria-label": formatLongDate(this.date, moment.locale()) } });
		this.place();
		this.anchor.addClass("is-open");

		const head = this.el.createDiv({ cls: "daybook-popover-head" });
		head.createDiv({ cls: "daybook-popover-title", text: formatLongDate(this.date, moment.locale()) });
		const open = head.createEl("button", { cls: "daybook-popover-open" });
		setIcon(open.createSpan({ cls: "daybook-layout-icon" }), "arrow-up-right");
		open.createSpan({ text: "Open day" });
		open.addEventListener("click", () => void this.close().then(() => this.opts.onOpenPage(this.date)));
		const close = head.createDiv({ cls: "clickable-icon", attr: { role: "button", tabindex: "0", "aria-label": "Close" } });
		setIcon(close, "x");
		close.addEventListener("click", () => void this.close());

		const body = this.el.createDiv({ cls: "daybook-popover-body daybook-pane-tasks" });

		// Close on Esc (unless a drag is in progress) or a click outside.
		this.registerDomEvent(this.el, "keydown", (evt) => {
			if (evt.key === "Escape" && !this.el.querySelector(".daybook-board.is-dragging")) {
				evt.stopPropagation();
				void this.close();
			}
		});
		this.registerDomEvent(
			activeDocument,
			"pointerdown",
			(evt) => {
				const t = evt.target as HTMLElement;
				if (this.el.contains(t) || t.closest(".menu, .modal-container")) return;
				void this.close();
			},
			{ capture: true },
		);

		void this.readNote(body);
	}

	onunload(): void {
		this.saveSoon.cancel();
		void this.flush();
		this.anchor.removeClass("is-open");
		this.el.remove();
	}

	private async readNote(body: HTMLElement): Promise<void> {
		const text = await this.plugin.store.read(this.path);
		this.entry = text === null ? emptyDay() : parseDay(text);
		const projects = await this.plugin.projects.activeOn(this.date);
		this.addChild(
			new TaskBoard(this.plugin, body, this.entry.groups, () => this.changed(), {
				date: this.date,
				projects,
				compact: true,
				newProject: () => {},
				reloadProjects: () => {},
			}),
		);
		// Put the cursor in "Add a task" of the first visible card.
		const add = body.querySelector<HTMLInputElement>(".daybook-card:not(.is-collapsed) .daybook-task-new input[type=text]");
		add?.focus();
	}

	/** Lays the popover over its card, wider than the card where there's room. */
	private place(): void {
		const h = this.host.getBoundingClientRect();
		const a = this.anchor.getBoundingClientRect();
		const width = Math.min(h.width, Math.max(a.width, 460));
		let left = a.left - h.left;
		if (left + width > h.width) left = Math.max(0, h.width - width);
		this.el.setCssStyles({ top: `${a.top - h.top}px`, left: `${left}px`, width: `${width}px` });
	}

	private changed(): void {
		this.dirty = true;
		this.saveSoon();
	}

	async flush(): Promise<void> {
		this.saveSoon.cancel();
		if (!this.dirty) return this.saving;
		this.dirty = false;
		const groups = structuredClone(this.entry.groups);
		this.saving = this.saving
			.then(() =>
				this.plugin.store.write(this.path, (old) => {
					// Only the tasks change here; keep goals, tags and diary as they are in the file.
					const current = parseDay(old);
					current.groups = groups;
					return applyDay(old, current);
				}),
			)
			.catch((e: unknown) => {
				console.error("Daybook: could not save", this.path, e);
				new Notice(`Daybook could not save ${this.path}.`);
			});
		return this.saving;
	}

	async close(): Promise<void> {
		if (this.closing) return;
		this.closing = true;
		await this.flush();
		this.opts.onClose();
	}
}
