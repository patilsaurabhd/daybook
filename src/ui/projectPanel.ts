// The left panel of a project row on the day page: name, progress bar and
// (when expanded) the milestone checklist, edited in place and saved to the
// project's own note. Milestones nest with Tab / Shift+Tab, and each can get
// its own task card on the day (the card's tasks tick the milestone).

import { Component, Keymap, Menu, Notice, debounce, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, formatDate } from "../core/dates";
import { blockEnd, newTask, shiftDepth } from "../core/day";
import { Project, ensureMilestoneId, progress } from "../core/project";

const SAVE_DELAY_MS = 600;

export interface ProjectPanelOptions {
	/** The day being shown (used as the finish date). */
	date: DateKey;
	/** Whether this day already has a task card for the project. */
	hasTodayCard: boolean;
	/** Expanded rows show milestones and cards; collapsed rows are one line. */
	expanded: boolean;
	onToggle: () => void;
	/** The project fills the Tasks area on its own. */
	focused: boolean;
	/** ⤢ / "Show all": show only this project, or everything again. */
	onFocus: () => void;
	/** Open tasks on this day in the project's cards (for the collapsed summary). */
	openToday: number;
	addTodayCard: () => void;
	/** Milestone ids that already have a card on this day. */
	milestoneCards: Set<string>;
	/** Create (or jump to) the day's card for a milestone. */
	openMilestoneCard: (milestoneId: string, text: string) => void;
	/** Project status changed (finished/reopened): reload the board. */
	onStatusChange: () => void;
}

export class ProjectPanel extends Component {
	private el!: HTMLElement;
	private listEl: HTMLElement | null = null;
	private progressEl!: HTMLElement;
	private dirty = false;
	private readonly saveSoon = debounce(() => void this.flush(), SAVE_DELAY_MS, true);

	constructor(
		private plugin: DaybookPlugin,
		private parent: HTMLElement,
		private project: Project,
		private opts: ProjectPanelOptions,
	) {
		super();
	}

	get name(): string {
		return this.project.name;
	}

	private get expanded(): boolean {
		return this.opts.expanded;
	}

	onload(): void {
		this.el = this.parent.createDiv({ cls: "daybook-project" });
		this.el.setCssProps({ "--daybook-project-colour": this.project.colour });
		this.registerDomEvent(this.el, "focusout", () => void this.flush());
		this.render();
	}

	onunload(): void {
		this.saveSoon.cancel();
		void this.flush();
	}

	/** Redraw after milestones changed from outside (e.g. auto-ticked by a card). */
	refresh(): void {
		if (!this.hasFocus()) this.render();
	}

	hasFocus(): boolean {
		const a = activeDocument.activeElement;
		return a !== null && this.el.contains(a);
	}

	private render(focusIndex?: number): void {
		const el = this.el;
		el.empty();
		this.listEl = null;
		el.toggleClass("is-expanded", this.expanded);
		el.toggleClass("is-done", this.project.status === "done");

		const head = el.createDiv({ cls: "daybook-project-head" });
		const toggle = head.createDiv({
			cls: "clickable-icon daybook-project-toggle",
			attr: { role: "button", tabindex: "0", "aria-expanded": String(this.expanded), "aria-label": this.expanded ? "Collapse project" : "Expand project" },
		});
		setIcon(toggle, this.expanded ? "chevron-down" : "chevron-right");
		if (this.opts.focused) toggle.hide(); // always open while it fills the area
		const flip = () => {
			void this.flush();
			this.opts.onToggle();
		};
		toggle.addEventListener("click", flip);
		toggle.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				flip();
			}
		});

		head.createSpan({ cls: "daybook-project-dot" });
		const name = head.createSpan({
			cls: "daybook-project-name",
			text: this.project.name,
			attr: { role: "link", tabindex: "0", "aria-label": `Open project note ${this.project.name}` },
		});
		name.addEventListener("click", (e) => void this.plugin.projects.open(this.project.name, Keymap.isModEvent(e) !== false));
		name.addEventListener("keydown", (e) => {
			if (e.key === "Enter") void this.plugin.projects.open(this.project.name, false);
		});

		if (!this.expanded) {
			// One-line summary: milestones and today's open tasks.
			const { done, total } = progress(this.project);
			const bits: string[] = [];
			if (total) bits.push(`${done}/${total} milestones`);
			if (this.opts.openToday) bits.push(`${this.opts.openToday} open today`);
			if (this.project.status === "done") bits.push("finished");
			if (bits.length) head.createSpan({ cls: "daybook-project-summary", text: bits.join(" · ") });
		}

		const focusBtn = head.createDiv({
			cls: "clickable-icon daybook-card-focus daybook-project-focus",
			attr: { role: "button", tabindex: "0", "aria-label": this.opts.focused ? "Show everything again" : "Show only this project" },
		});
		setIcon(focusBtn, this.opts.focused ? "minimize-2" : "maximize-2");
		if (this.opts.focused) focusBtn.createSpan({ text: "Show all" });
		focusBtn.addEventListener("click", () => {
			void this.flush();
			this.opts.onFocus();
		});
		focusBtn.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				void this.flush();
				this.opts.onFocus();
			}
		});

		const more = head.createDiv({ cls: "clickable-icon daybook-project-menu", attr: { role: "button", tabindex: "0", "aria-label": "Project options" } });
		setIcon(more, "more-horizontal");
		more.addEventListener("click", (e) => this.showMenu(e));

		if (!this.expanded) return;

		this.progressEl = el.createDiv({ cls: "daybook-project-progress" });
		this.renderProgress();

		if (this.project.status === "done" && this.project.finished) {
			el.createDiv({
				cls: "daybook-project-status",
				text: `Finished ${formatDate(this.project.finished, { day: "numeric", month: "short" }, moment.locale())}`,
			});
		}

		this.listEl = el.createDiv({ cls: "daybook-milestones" });
		this.renderMilestones(focusIndex);

		if (!this.opts.hasTodayCard && this.project.status === "active") {
			const add = el.createEl("button", { cls: "daybook-project-today" });
			setIcon(add.createSpan({ cls: "daybook-layout-icon" }), "plus");
			add.createSpan({ text: "Today's tasks" });
			add.addEventListener("click", () => this.opts.addTodayCard());
		}
	}

	private renderProgress(): void {
		const { done, total } = progress(this.project);
		const el = this.progressEl;
		el.empty();
		const bar = el.createDiv({ cls: "daybook-progress-bar", attr: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(done) } });
		bar.createDiv({ cls: "daybook-progress-fill" }).setCssProps({ "--daybook-progress": total ? `${Math.round((done / total) * 100)}%` : "0%" });
		el.createSpan({ cls: "daybook-progress-text", text: total ? `${done} of ${total} milestones` : "No milestones yet" });
	}

	private renderMilestones(focusIndex?: number, caret: "start" | "end" = "end"): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();
		const items = this.project.milestones;
		const inputs: HTMLInputElement[] = [];

		items.forEach((m, i) => {
			const row = list.createDiv({ cls: "daybook-milestone" });
			row.toggleClass("is-done", m.done);
			row.setCssProps({ "--daybook-depth": String(m.depth) });
			const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { "aria-label": "Done" } });
			box.checked = m.done;
			box.addEventListener("change", () => {
				m.done = box.checked;
				row.toggleClass("is-done", m.done);
				this.changed();
				void this.flush();
			});
			const input = row.createEl("input", { type: "text", cls: "daybook-task-text", attr: { "aria-label": "Milestone" } });
			input.value = m.text;
			input.addEventListener("input", () => {
				m.text = input.value;
				this.changed();
			});
			input.addEventListener("keydown", (e) => this.onMilestoneKey(e, i, input, inputs));
			inputs.push(input);

			// Task card for this milestone on the day.
			const hasCard = m.id !== undefined && this.opts.milestoneCards.has(m.id);
			const cardBtn = row.createDiv({
				cls: "clickable-icon daybook-milestone-card",
				attr: { role: "button", tabindex: "0", "aria-label": hasCard ? "Go to this milestone's task card" : "Make a task card for this milestone" },
			});
			cardBtn.toggleClass("is-active", hasCard);
			setIcon(cardBtn, hasCard ? "square-check" : "list-plus");
			const openCard = () => {
				if (!m.text.trim()) return;
				const hadId = m.id !== undefined;
				const id = ensureMilestoneId(this.project, i);
				if (!hadId) {
					this.changed();
					void this.flush(); // the link needs the id in the project note
				}
				this.opts.openMilestoneCard(id, m.text);
			};
			cardBtn.addEventListener("click", openCard);
			cardBtn.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					openCard();
				}
			});
		});

		const adder = list.createDiv({ cls: "daybook-milestone daybook-task-new" });
		adder.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { disabled: "true", "aria-hidden": "true" } });
		const add = adder.createEl("input", { type: "text", cls: "daybook-task-text", attr: { placeholder: "Add a milestone", "aria-label": "Add a milestone" } });
		add.addEventListener("input", () => {
			if (!add.value.trim()) return;
			items.push(newTask(add.value));
			this.changed();
			this.renderMilestones(items.length - 1);
		});
		add.addEventListener("keydown", (e) => {
			if (e.key === "ArrowUp" && inputs.length > 1) {
				e.preventDefault();
				inputs[inputs.length - 2]!.focus();
			}
		});
		inputs.push(add);

		if (focusIndex !== undefined) {
			const t = inputs[focusIndex];
			if (t) {
				t.focus();
				const pos = caret === "start" ? 0 : t.value.length;
				t.setSelectionRange(pos, pos);
			}
		}
	}

	/** Same keys as tasks: Enter, Backspace, Tab / Shift+Tab, ↑/↓. */
	private onMilestoneKey(e: KeyboardEvent, i: number, input: HTMLInputElement, inputs: HTMLInputElement[]): void {
		if (e.isComposing) return;
		const items = this.project.milestones;
		const m = items[i]!;
		if (e.key === "Tab" && !e.metaKey && !e.ctrlKey) {
			e.preventDefault();
			if (shiftDepth(items, i, e.shiftKey ? -1 : 1)) {
				this.changed();
				this.renderMilestones(i);
			}
		} else if (e.key === "Enter") {
			e.preventDefault();
			const caret = input.selectionStart ?? input.value.length;
			const hasChildren = (items[i + 1]?.depth ?? -1) > m.depth;
			const rest = input.value.slice(caret);
			m.text = input.value.slice(0, caret);
			items.splice(i + 1, 0, newTask(rest, hasChildren ? m.depth + 1 : m.depth));
			this.changed();
			this.renderMilestones(i + 1, "start");
		} else if (e.key === "Backspace" && input.value === "" && m.depth > 0) {
			e.preventDefault();
			shiftDepth(items, i, -1);
			this.changed();
			this.renderMilestones(i);
		} else if (e.key === "Backspace" && input.value === "" && blockEnd(items, i) === i + 1) {
			e.preventDefault();
			items.splice(i, 1);
			this.changed();
			this.renderMilestones(Math.max(0, i - 1));
		} else if (e.key === "ArrowUp" && inputs[i - 1]) {
			e.preventDefault();
			inputs[i - 1]!.focus();
		} else if (e.key === "ArrowDown" && inputs[i + 1]) {
			e.preventDefault();
			inputs[i + 1]!.focus();
		}
	}

	private showMenu(evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Open project note").setIcon("file-text").onClick(() => void this.plugin.projects.open(this.project.name, false)));
		if (this.project.status === "active") {
			const label = formatDate(this.opts.date, { day: "numeric", month: "short" }, moment.locale());
			menu.addItem((i) =>
				i
					.setTitle(`Finish project (on ${label})`)
					.setIcon("check-circle")
					.onClick(() => void this.setStatus("done")),
			);
		} else {
			menu.addItem((i) => i.setTitle("Reopen project").setIcon("rotate-ccw").onClick(() => void this.setStatus("active")));
		}
		menu.showAtMouseEvent(evt);
	}

	private async setStatus(status: "active" | "done"): Promise<void> {
		await this.flush();
		const date = this.opts.date;
		try {
			await this.plugin.projects.update(this.project.name, (p) => {
				p.status = status;
				p.finished = status === "done" ? date : "";
			});
			new Notice(status === "done" ? `Finished ${this.project.name}. It won't show on later days.` : `Reopened ${this.project.name}.`);
		} catch (e) {
			console.error("Daybook: could not update project", e);
			new Notice(`Daybook could not update ${this.project.name}.`);
		}
		this.opts.onStatusChange();
	}

	private changed(): void {
		this.dirty = true;
		this.renderProgress();
		this.saveSoon();
	}

	async flush(): Promise<void> {
		this.saveSoon.cancel();
		if (!this.dirty) return;
		this.dirty = false;
		const milestones = structuredClone(this.project.milestones);
		try {
			await this.plugin.projects.update(this.project.name, (p) => {
				p.milestones = milestones;
			});
		} catch (e) {
			console.error("Daybook: could not save project", e);
			new Notice(`Daybook could not save ${this.project.name}.`);
		}
	}
}
