// One editable day: tags, goals, tasks (left) and diary (right).
// Edits are saved shortly after you stop typing; the file is created on the
// first keystroke, never just by looking at a day.

import { Component, Menu, Notice, debounce, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, formatDate, todayKey } from "../core/dates";
import { CarriedCard, DayEntry, addCarried, applyDay, emptyDay, listOpenTasks, openTasks, parseDay, takeOpenTasks } from "../core/day";
import { CarryModal } from "./carryModal";
import { addRuleTasks, pendingRules } from "../core/recurring";
import { CategoryModal, addCategory, tagFromName } from "./categoryModal";
import { dayKeyFromPath, dayPath } from "../core/paths";
import { lastDayBefore } from "../obsidian/store";
import { MarkdownBox, MarkdownBoxOptions } from "./markdownBox";
import { TaskBoard } from "./taskBoard";
import { PromptModal } from "./promptModal";
import { Project, cardAllDone, cleanProjectName, findMilestone, parseCardLink, sameName } from "../core/project";

const SAVE_DELAY_MS = 600;

export class DayCard extends Component {
	readonly path: string;
	private entry: DayEntry = emptyDay();
	private projects: Project[] = [];
	private board: TaskBoard | null = null;
	private dirty = false;
	private saving: Promise<void> = Promise.resolve();
	/** Child components drawn by render(); replaced on every redraw. */
	private parts: Component[] = [];
	private listening = false;
	private readonly saveSoon = debounce(() => void this.flush(), SAVE_DELAY_MS, true);

	constructor(
		private plugin: DaybookPlugin,
		private containerEl: HTMLElement,
		readonly date: DateKey,
	) {
		super();
		this.path = dayPath(plugin.settings.rootFolder, date);
	}

	/** Reads the note (if any) and draws the card. */
	async init(): Promise<void> {
		const text = await this.plugin.store.read(this.path);
		this.entry = text === null ? emptyDay() : parseDay(text);
		await this.addDueRules();
		this.projects = await this.plugin.projects.activeOn(this.date);
		await this.findCarrySource();
		if (this.carrySource && this.plugin.settings.autoCarry && this.date === todayKey()) {
			await this.carryOver(); // opted in: do it straight away
			return;
		}
		this.render();
	}

	// ---- Recurring tasks ----

	/** Tasks from rules shown on this day but not saved yet. */
	private ruleTasks: object[] = [];

	/**
	 * Today and later: rules due this day show up as tasks. They're saved with
	 * the day's first edit (and recorded, so they're never added twice).
	 * Past days are left as they were.
	 */
	private async addDueRules(): Promise<void> {
		this.ruleTasks = [];
		if (this.date < todayKey()) return;
		const rules = await this.plugin.recurring.rules();
		const due = pendingRules(this.entry, rules, this.date);
		this.ruleTasks = addRuleTasks(this.entry, due);
		for (const t of this.ruleTasks) this.plugin.unsavedRuleTasks.add(t);
	}

	/** After a save, tasks from rules are ordinary tasks: drop the "not saved yet" mark. */
	private markRuleTasksSaved(): void {
		if (this.ruleTasks.length === 0) return;
		for (const t of this.ruleTasks) this.plugin.unsavedRuleTasks.delete(t);
		this.ruleTasks = [];
		this.containerEl.querySelectorAll(".daybook-task.is-from-rule").forEach((row) => {
			row.removeClass("is-from-rule");
			row.querySelector(".daybook-rule-mark")?.remove();
		});
	}

	// ---- Carrying unfinished tasks from the last day written ----

	private carrySource: { key: string; path: string; count: number } | null = null;

	/** Today (or a future day): the last earlier day note with unfinished tasks. */
	private async findCarrySource(): Promise<void> {
		this.carrySource = null;
		if (this.date < todayKey() || this.plugin.carryDismissed.has(this.date)) return;
		const root = this.plugin.settings.rootFolder;
		const prev = lastDayBefore(this.plugin.app, this.date, (p) => dayKeyFromPath(root, p));
		if (!prev) return;
		const text = await this.plugin.store.read(prev.path);
		const count = text === null ? 0 : openTasks(parseDay(text)).length;
		if (count > 0) this.carrySource = { ...prev, count };
	}

	private renderCarryBar(parent: HTMLElement): void {
		const src = this.carrySource;
		if (!src) return;
		const bar = parent.createDiv({ cls: "daybook-carry" });
		setIcon(bar.createSpan({ cls: "daybook-layout-icon" }), "corner-down-right");
		const from = formatDate(src.key, { weekday: "short", day: "numeric", month: "short" }, moment.locale());
		bar.createSpan({ cls: "daybook-carry-text", text: `${src.count} unfinished from ${from}` });
		const go = bar.createEl("button", { cls: "mod-cta daybook-carry-btn", text: "Review" });
		go.addEventListener("click", () => void this.reviewCarry());
		const no = bar.createDiv({ cls: "clickable-icon", attr: { role: "button", tabindex: "0", "aria-label": "Not now" } });
		setIcon(no, "x");
		no.addEventListener("click", () => {
			this.plugin.carryDismissed.add(this.date);
			this.carrySource = null;
			bar.remove();
		});
	}

	/** Shows what would move and lets the user pick; nothing moves until confirmed. */
	private async reviewCarry(): Promise<void> {
		const src = this.carrySource;
		if (!src) return;
		const text = await this.plugin.store.read(src.path);
		const cards = text === null ? [] : listOpenTasks(parseDay(text));
		if (cards.length === 0) {
			this.carrySource = null;
			this.render();
			return;
		}
		const from = formatDate(src.key, { weekday: "short", day: "numeric", month: "short" }, moment.locale());
		new CarryModal(this.plugin.app, from, cards, (picked) => void this.carryOver(picked)).open();
	}

	/**
	 * Moves unfinished tasks here (same cards), marking them [>] on the old day.
	 * `only` limits it to the tasks picked in the review; without it (automatic
	 * carry-over) all of them move.
	 */
	private async carryOver(only?: Map<string, string>): Promise<void> {
		const src = this.carrySource;
		if (!src) return;
		this.carrySource = null;
		this.plugin.carryDismissed.add(this.date); // handled for today; leftovers stay put
		let cards: CarriedCard[] = [];
		try {
			await this.plugin.store.write(src.path, (old) => {
				const e = parseDay(old);
				cards = takeOpenTasks(e, only, this.date); // the old day notes where they went
				return cards.length ? applyDay(old, e) : old;
			});
			const n = addCarried(this.entry, cards);
			if (n > 0) {
				this.dirty = true;
				await this.flush();
				const from = formatDate(src.key, { weekday: "short", day: "numeric", month: "short" }, moment.locale());
				new Notice(`Carried over ${n} task${n === 1 ? "" : "s"} from ${from}.`);
			}
		} catch (e) {
			console.error("Daybook: could not carry tasks over", e);
			new Notice("Daybook could not carry the tasks over.");
		}
		this.render();
	}

	onunload(): void {
		this.saveSoon.cancel();
		this.syncMilestonesSoon.cancel();
	}

	addChild<T extends Component>(child: T): T {
		this.parts.push(child);
		return super.addChild(child);
	}

	/** Applies the Tasks / Both / Diary layout; the visible part takes the freed space. */
	applyLayout(): void {
		const layout = this.plugin.settings.dayLayout;
		this.containerEl.toggleClass("is-diary-hidden", layout === "tasks");
		this.containerEl.toggleClass("is-tasks-hidden", layout === "diary");
		this.board?.relayout();
	}

	/** True while the user is typing in this card. */
	hasFocus(): boolean {
		const active = this.containerEl.ownerDocument.activeElement;
		return active !== null && this.containerEl.contains(active);
	}

	isDirty(): boolean {
		return this.dirty;
	}

	private readonly syncMilestonesSoon = debounce(() => void this.syncMilestones(), 500, true);

	/**
	 * A milestone's card ticks the milestone when all its tasks are done (and
	 * unticks it if one is reopened). Only runs after edits, never on load.
	 */
	private async syncMilestones(): Promise<void> {
		const changes = new Map<Project, { id: string; done: boolean; text: string }[]>();
		for (const group of this.entry.groups) {
			const link = parseCardLink(group.name);
			if (!link?.milestoneId) continue;
			const allDone = cardAllDone(group.tasks);
			if (allDone === null) continue;
			const project = this.projects.find((p) => sameName(p.name, link.project));
			const milestone = project ? findMilestone(project, link.milestoneId) : null;
			if (!project || !milestone || milestone.done === allDone) continue;
			milestone.done = allDone; // panels share these objects
			const list = changes.get(project) ?? [];
			list.push({ id: link.milestoneId, done: allDone, text: milestone.text });
			changes.set(project, list);
		}
		if (changes.size === 0) return;
		this.board?.refreshPanels();
		for (const [project, list] of changes) {
			try {
				await this.plugin.projects.update(project.name, (p) => {
					for (const c of list) {
						const m = findMilestone(p, c.id);
						if (m) m.done = c.done;
					}
				});
				for (const c of list) if (c.done) new Notice(`Milestone done: ${c.text}`);
			} catch (e) {
				console.error("Daybook: could not update milestone", e);
			}
		}
	}

	/** Re-reads the project notes (after one changed) and redraws the project rows. */
	async reloadProjects(force = false): Promise<void> {
		if (!this.board || (!force && this.board.panelHasFocus())) return;
		this.projects = await this.plugin.projects.activeOn(this.date);
		this.board.setProjects(this.projects);
	}

	private newProject(): void {
		new PromptModal(this.plugin.app, "Start a project", "Project name", "Start", (raw) => {
			const name = cleanProjectName(raw);
			if (!name) return;
			void (async () => {
				try {
					await this.plugin.projects.create(name, this.date);
					await this.reloadProjects(true);
					this.board?.addProjectCard(name);
				} catch (e) {
					console.error("Daybook: could not create project", e);
					new Notice(`Daybook could not create the project "${name}".`);
				}
			})();
		}).open();
	}

	/** Re-reads the file after an outside change, unless the user is mid-edit. */
	async reloadFromDisk(): Promise<void> {
		if (this.dirty || this.hasFocus()) return;
		await this.init();
	}

	/** Writes pending edits now. Safe to call any time. */
	async flush(): Promise<void> {
		this.saveSoon.cancel();
		if (!this.dirty) return this.saving;
		this.dirty = false;
		const snapshot = structuredClone(this.entry);
		this.saving = this.saving
			.then(() => this.plugin.store.write(this.path, (old) => applyDay(old, snapshot)))
			.then(() => this.markRuleTasksSaved())
			.catch((e: unknown) => {
				console.error("Daybook: could not save", this.path, e);
				new Notice(`Daybook could not save ${this.path}.`);
			});
		return this.saving;
	}

	private changed(): void {
		this.dirty = true;
		this.saveSoon();
		this.syncMilestonesSoon();
	}

	// ---- Drawing ----

	private render(): void {
		const el = this.containerEl;
		for (const child of this.parts) this.removeChild(child);
		this.parts = [];
		this.board = null;
		el.empty();
		el.addClass("daybook-day");
		this.applyLayout();
		if (!this.listening) {
			this.listening = true;
			// Leaving the card saves straight away.
			this.registerDomEvent(el, "focusout", () => void this.flush());
		}

		// Top: Goals, one line until you write more. The day's tags sit on the
		// right of its heading, with a + to add more.
		const top = el.createDiv({ cls: "daybook-top" });
		const goals = top.createDiv({ cls: "daybook-goals" });
		const goalsHead = goals.createDiv({ cls: "daybook-goals-head" });
		goalsHead.createDiv({ cls: "daybook-pane-title", text: "Goals" });
		this.tagsEl = goalsHead.createDiv({ cls: "daybook-tags-inline" });
		this.renderTags();
		this.addBox(goals, {
			value: this.entry.goals,
			placeholder: "Goals for the day…",
			label: "Goals for the day",
			minRows: 1,
			onChange: (v) => {
				this.entry.goals = v;
				this.changed();
			},
		});

		const panes = el.createDiv({ cls: "daybook-panes" });

		const tasksPane = panes.createDiv({ cls: "daybook-pane daybook-pane-tasks" });
		this.renderCarryBar(tasksPane);
		this.board = this.addChild(
			new TaskBoard(this.plugin, tasksPane, this.entry.groups, () => this.changed(), {
				date: this.date,
				projects: this.projects,
				newProject: () => this.newProject(),
				reloadProjects: () => void this.reloadProjects(true),
				recordRule: (id) => {
					if (!this.entry.recurring.includes(id)) this.entry.recurring.push(id);
					this.changed();
				},
			}),
		);

		const diaryPane = panes.createDiv({ cls: "daybook-pane daybook-pane-diary" });
		diaryPane.createDiv({ cls: "daybook-pane-title", text: "Diary" });
		this.addBox(diaryPane, {
			value: this.entry.diary,
			placeholder: "How was the day? Paste or drop images here",
			label: "Diary",
			minRows: 8,
			onChange: (v) => {
				this.entry.diary = v;
				this.changed();
			},
			images: { store: this.plugin.store, beforeSave: () => this.ensureNoteExists() },
		});

		this.renderNotes(el.createDiv({ cls: "daybook-notes" }));
	}

	/** Scratchpad strip along the bottom; collapsible (remembered). */
	private renderNotes(strip: HTMLElement): void {
		const head = strip.createDiv({
			cls: "daybook-notes-head",
			attr: { role: "button", tabindex: "0" },
		});
		const chevron = head.createSpan({ cls: "daybook-notes-chevron" });
		head.createSpan({ cls: "daybook-pane-title", text: "Notes" });
		const hint = head.createSpan({ cls: "daybook-notes-hint" });
		const body = strip.createDiv({ cls: "daybook-notes-body" });

		const sync = () => {
			const collapsed = this.plugin.settings.notesCollapsed;
			strip.toggleClass("is-collapsed", collapsed);
			setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
			head.setAttr("aria-expanded", String(!collapsed));
			head.setAttr("aria-label", collapsed ? "Show notes" : "Hide notes");
			hint.setText(collapsed && this.entry.notes.trim() ? "has notes" : "");
		};
		const flip = () => {
			this.plugin.settings.notesCollapsed = !this.plugin.settings.notesCollapsed;
			void this.plugin.saveSettings(false);
			sync();
		};
		head.addEventListener("click", flip);
		head.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				flip();
			}
		});
		sync();

		this.addBox(body, {
			value: this.entry.notes,
			placeholder: "Scratchpad: numbers, links, ideas…",
			label: "Notes",
			minRows: 3,
			onChange: (v) => {
				this.entry.notes = v;
				this.changed();
			},
			images: { store: this.plugin.store, beforeSave: () => this.ensureNoteExists() },
		});
	}

	private addBox(parent: HTMLElement, opts: Omit<MarkdownBoxOptions, "sourcePath">): void {
		const box = new MarkdownBox(this.plugin.app, parent, { ...opts, sourcePath: this.path });
		this.addChild(box);
	}

	/** Writes the note now (creating it if needed), e.g. before adding an attachment to it. */
	private async ensureNoteExists(): Promise<void> {
		if (!this.plugin.store.exists(this.path)) this.dirty = true;
		await this.flush();
	}

	/** Category buttons (from settings) plus a box for any other tags. */
	private tagsEl!: HTMLElement;

	/** The day's tags as chips (× removes), and a + menu to add more. */
	private renderTags(): void {
		const row = this.tagsEl;
		row.empty();
		const categories = this.plugin.settings.categories.filter((c) => c.tag.trim() !== "");
		const categoryOf = (tag: string) => categories.find((c) => same(c.tag, tag));

		for (const tag of this.entry.tags) {
			const cat = categoryOf(tag);
			const chip = row.createSpan({ cls: "daybook-tag-chip" });
			chip.toggleClass("is-category", cat !== undefined);
			if (cat) chip.setCssProps({ "--daybook-cat-color": cat.color });
			chip.createSpan({ cls: "daybook-chip-dot" });
			chip.createSpan({ text: cat ? cat.name || cat.tag : tag });
			const x = chip.createSpan({ cls: "daybook-tag-remove", attr: { role: "button", tabindex: "0", "aria-label": `Remove tag ${tag}` } });
			setIcon(x, "x");
			const remove = () => this.setTag(tag, false);
			x.addEventListener("click", remove);
			x.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					remove();
				}
			});
		}

		const plus = row.createDiv({
			cls: "clickable-icon daybook-tag-add",
			attr: { role: "button", tabindex: "0", "aria-label": this.entry.tags.length ? "Add a tag" : "Tag this day" },
		});
		setIcon(plus, "plus");
		// Until the day has a tag, spell it out so the + is noticed.
		if (this.entry.tags.length === 0) {
			plus.addClass("has-label");
			plus.createSpan({ text: "Tags" });
		}
		const open = (evt: MouseEvent | KeyboardEvent) => {
			const menu = new Menu();
			for (const cat of categories) {
				const on = this.entry.tags.some((t) => same(t, cat.tag));
				menu.addItem((i) =>
					i
						.setTitle(cat.name || cat.tag)
						.setChecked(on)
						.onClick(() => this.setTag(cat.tag, !on)),
				);
			}
			if (categories.length) menu.addSeparator();
			menu.addItem((i) =>
				i
					.setTitle("Other tag…")
					.setIcon("hash")
					.onClick(() =>
						new PromptModal(this.plugin.app, "Tag this day", "family", "Add", (raw) => {
							for (const t of raw.split(/[,\s]+/)) {
								const tag = t.replace(/^#/, "").trim();
								if (tag) this.setTag(tag, true);
							}
						}).open(),
					),
			);
			menu.addItem((i) =>
				i
					.setTitle("New category…")
					.setIcon("palette")
					.onClick(() =>
						new CategoryModal(this.plugin, async (name, colour) => {
							const tag = tagFromName(name);
							if (!tag) return;
							// Tag the day and save first: adding the category redraws the page.
							if (!this.entry.tags.some((t) => same(t, tag))) this.entry.tags.push(tag);
							this.dirty = true;
							await this.flush();
							await addCategory(this.plugin, name, colour);
						}).open(),
					),
			);
			if (evt instanceof MouseEvent) menu.showAtMouseEvent(evt);
			else {
				const r = plus.getBoundingClientRect();
				menu.showAtPosition({ x: r.left, y: r.bottom });
			}
		};
		plus.addEventListener("click", open);
		plus.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				open(e);
			}
		});
	}

	private setTag(tag: string, on: boolean): void {
		const has = this.entry.tags.some((t) => same(t, tag));
		if (on && !has) this.entry.tags = [...this.entry.tags, tag];
		else if (!on && has) this.entry.tags = this.entry.tags.filter((t) => !same(t, tag));
		else return;
		this.changed();
		this.renderTags();
	}
}

function same(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}
