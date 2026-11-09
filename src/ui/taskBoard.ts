// The Tasks area of a day: a grid of task cards ("### Name" groups).
//
// - Cards can be added, renamed, collapsed (remembered by name) and removed.
// - Tasks are edited in place: Enter adds/splits, Backspace on empty removes,
//   Tab / Shift+Tab nest and un-nest (subtasks move with their parent).
// - Drag the grip (⋮⋮) to reorder tasks or move them to another card;
//   works with mouse and touch. Alt+↑/↓ does the same from the keyboard.
// - Focus: one card takes most of the space; the others shrink into a side
//   column (click one to switch, drop tasks on it). Focus follows the card name.
// - Projects (day page only): each active project is a row with its panel on
//   the left and its linked cards ("### [[Project]]") on the right; other
//   cards sit in a "General" row. Chips choose what to show.

import { Component, Keymap, Menu, Notice, moment, setIcon } from "obsidian";
import { MoveModal } from "./moveModal";
import { dayPath } from "../core/paths";
import type DaybookPlugin from "../main";
import { DateKey, formatDate, todayKey } from "../core/dates";
import {
	Task,
	TaskGroup,
	TaskPos,
	addCarried,
	applyDay,
	blockEnd,
	emptyDay,
	emptyGroup,
	isOpen,
	moveTask,
	newTask,
	parseDay,
	removeGroup,
	shiftDepth,
	takeTaskBlock,
} from "../core/day";
import {
	CardLink,
	Project,
	findMilestone,
	milestoneCardName,
	parseCardLink,
	projectCardName,
	sameName,
} from "../core/project";
import { ProjectPanel } from "./projectPanel";
import { RulesModal, openAddRule } from "./recurringModal";
import { Rule, ruleId } from "../core/recurring";

/** Project rows are shown only when the board gets this (the day page). */
export interface ProjectContext {
	date: DateKey;
	projects: Project[];
	/** Opened-out day (week/month): one collapsible line per project, no panels. */
	compact?: boolean;
	newProject: () => void;
	reloadProjects: () => void;
	/** A task here was made into a recurring rule: record it so today's copy isn't added twice. */
	recordRule?: (ruleId: string) => void;
}

type Focus = { group: number; index: number | "new" | "title"; caret?: "start" | "end" };

interface DragState {
	from: TaskPos;
	rows: HTMLElement[];
	handle: HTMLElement;
	pointerId: number;
	line: HTMLElement;
	target: TaskPos | null;
	targetCard: HTMLElement | null;
}

export class TaskBoard extends Component {
	private gridEl!: HTMLElement;
	/** Text boxes in on-screen order, for ↑/↓ navigation. */
	private order: HTMLInputElement[] = [];
	private inputs = new Map<string, HTMLInputElement>();
	private drag: DragState | null = null;
	private chipsEl!: HTMLElement;
	private panels: ProjectPanel[] = [];

	constructor(
		private plugin: DaybookPlugin,
		private containerEl: HTMLElement,
		private groups: TaskGroup[],
		private onChange: () => void,
		private projectCtx?: ProjectContext,
	) {
		super();
	}

	onload(): void {
		const head = this.containerEl.createDiv({ cls: "daybook-pane-head" });
		head.createDiv({ cls: "daybook-pane-title", text: "Tasks" });
		const buttons = head.createDiv({ cls: "daybook-pane-actions" });
		if (!this.projectCtx?.compact) {
			const rec = buttons.createEl("button", { cls: "daybook-add-card clickable-icon", attr: { "aria-label": "Recurring tasks" } });
			setIcon(rec, "repeat");
			this.registerDomEvent(rec, "click", () => new RulesModal(this.plugin).open());
		}
		if (this.projectCtx && !this.projectCtx.compact) {
			const ctx = this.projectCtx;
			const proj = buttons.createEl("button", { cls: "daybook-add-card clickable-icon", attr: { "aria-label": "Start a project" } });
			setIcon(proj, "plus");
			proj.createSpan({ text: "Project" });
			this.registerDomEvent(proj, "click", () => ctx.newProject());
		}
		const add = buttons.createEl("button", { cls: "daybook-add-card clickable-icon", attr: { "aria-label": "Add a task card" } });
		setIcon(add, "plus");
		add.createSpan({ text: "Card" });
		this.registerDomEvent(add, "click", () => {
			// With a project chip selected, the new card belongs to that project.
			const key = this.plugin.focusedProject ?? this.plugin.taskFilter;
			const project = this.projectCtx?.projects.find((p) => p.name.toLowerCase() === key);
			this.addCard(project?.name);
		});

		// Chips (All · General · projects) sit under the Tasks heading.
		this.chipsEl = this.containerEl.createDiv({ cls: "daybook-chips" });
		this.chipsEl.hide();
		this.gridEl = this.containerEl.createDiv({ cls: "daybook-board" });
		this.registerDomEvent(this.containerEl.ownerDocument, "keydown", (evt) => {
			if (evt.key === "Escape" && this.drag) this.endDrag(false);
		});
		this.render();
	}

	onunload(): void {
		if (this.drag) this.endDrag(false);
	}

	// ---- Collapsed state (stored in plugin data, by card name) ----

	private isCollapsed(g: TaskGroup): boolean {
		return g.name !== null && g.name !== "" && this.plugin.settings.collapsedCards.includes(g.name.toLowerCase());
	}

	private setCollapsed(name: string, collapsed: boolean): void {
		const key = name.toLowerCase();
		const list = this.plugin.settings.collapsedCards.filter((n) => n !== key);
		if (collapsed && key) list.push(key);
		this.plugin.settings.collapsedCards = list;
		void this.plugin.saveSettings(false);
	}

	// ---- Drawing ----

	/** New project list (after one was added, finished or edited elsewhere). */
	setProjects(projects: Project[]): void {
		if (!this.projectCtx) return;
		this.projectCtx.projects = projects;
		this.render();
	}

	/** True while typing in a project panel (don't redraw under the user). */
	panelHasFocus(): boolean {
		return this.panels.some((p) => p.hasFocus());
	}

	private render(focus?: Focus): void {
		const board = this.gridEl;
		for (const panel of this.panels) this.removeChild(panel);
		this.panels = [];
		board.empty();
		board.removeClass("has-focus");
		this.order = [];
		this.inputs.clear();

		const hidden = (group: TaskGroup, gi: number) =>
			// Hide the ungrouped card when it's empty and named cards exist.
			gi === 0 && group.tasks.length === 0 && group.preamble.length === 0 && this.groups.length > 1;

		const projects = this.projectCtx?.projects ?? [];
		const soloProject = this.focusedProject(projects);
		const focused = this.focusedIndex();
		// Chips only make sense when everything is on show.
		this.renderChips(this.projectCtx?.compact || soloProject || focused >= 0 ? [] : projects);

		if (focused >= 0) {
			board.addClass("has-focus");
			const grid = board.createDiv({ cls: "daybook-cards is-focus-mode" });
			const focusedGroup = this.groups[focused]!;
			this.renderCard(grid, focusedGroup, focused, true);
			// The side column lists only cards from the same project (or only general cards).
			const scope = this.scopeOf(focusedGroup, projects);
			const rail = grid.createDiv({ cls: "daybook-cards-rail" });
			const scopeProject = projects.find((p) => p.name.toLowerCase() === scope);
			rail.createDiv({ cls: "daybook-lane-label daybook-rail-label", text: scopeProject?.name ?? (scope ? scope : "General") });
			if (scopeProject) rail.setCssProps({ "--daybook-project-colour": scopeProject.colour });
			this.groups.forEach((group, gi) => {
				if (gi !== focused && !hidden(group, gi) && this.scopeOf(group, projects) === scope) this.renderRailCard(rail, group, gi);
			});
		} else if (soloProject) {
			// One project fills the Tasks area: milestones left, its cards right.
			board.addClass("has-focus");
			this.renderProjectLane(board, soloProject, projects, true, true);
		} else if (this.projectCtx?.compact) {
			this.renderCompactProjects(board, projects, hidden);
		} else if (projects.length > 0) {
			this.renderLanes(board, projects, hidden);
		} else {
			this.renderGeneral(board, []);
		}

		board.createDiv({ cls: "daybook-drop-line" }).hide();

		if (focus) this.focus(focus);
	}

	// ---- Projects ----

	private projectOf(group: TaskGroup, projects: Project[]): Project | null {
		const link = parseCardLink(group.name);
		return link ? (projects.find((p) => sameName(p.name, link.project)) ?? null) : null;
	}

	/** Which group a card belongs to: its project's name (lower case), or "" for general. */
	private scopeOf(group: TaskGroup, projects: Project[]): string {
		const link = parseCardLink(group.name);
		if (!link) return "";
		const p = projects.find((x) => sameName(x.name, link.project));
		return (p?.name ?? link.project).toLowerCase();
	}

	/** Display name for a linked card: milestone text, own title, or project name. */
	private linkLabel(link: CardLink): string {
		if (link.milestoneId) {
			const project = this.projectCtx?.projects.find((p) => sameName(p.name, link.project));
			const m = project ? findMilestone(project, link.milestoneId) : null;
			return m?.text || link.alias || link.project;
		}
		return link.title || link.project;
	}

	private renderChips(projects: Project[]): void {
		const el = this.chipsEl;
		el.empty();
		el.toggle(projects.length > 0);
		if (projects.length === 0) return;
		const valid = ["all", "general", ...projects.map((p) => p.name.toLowerCase())];
		if (!valid.includes(this.plugin.taskFilter)) this.plugin.taskFilter = "all";

		const chip = (value: string, label: string, colour?: string) => {
			const b = el.createEl("button", { cls: "daybook-filter-chip", attr: { "aria-pressed": String(this.plugin.taskFilter === value) } });
			b.toggleClass("is-active", this.plugin.taskFilter === value);
			if (colour) b.createSpan({ cls: "daybook-chip-dot is-filled" }).setCssProps({ "--daybook-cat-color": colour });
			b.createSpan({ text: label });
			b.addEventListener("click", () => {
				this.plugin.taskFilter = value;
				this.render();
			});
		};
		chip("all", "All");
		chip("general", "General");
		for (const p of projects) chip(p.name.toLowerCase(), p.name, p.colour);
	}

	/** Whether a project row is open (milestones and cards showing). */
	private isExpanded(project: Project): boolean {
		const key = project.name.toLowerCase();
		if (this.plugin.taskFilter === key) return true; // its own chip: always open
		if (this.plugin.settings.dayLayout === "both") return this.plugin.bothExpanded.has(key);
		return !this.plugin.settings.collapsedProjects.includes(key);
	}

	private toggleProject(project: Project): void {
		const key = project.name.toLowerCase();
		const open = this.isExpanded(project);
		if (this.plugin.settings.dayLayout === "both") {
			if (open) this.plugin.bothExpanded.delete(key);
			else this.plugin.bothExpanded.add(key);
		} else {
			const list = this.plugin.settings.collapsedProjects.filter((n) => n !== key);
			if (open) list.push(key);
			this.plugin.settings.collapsedProjects = list;
			void this.plugin.saveSettings(false);
		}
		if (open && this.plugin.taskFilter === key) this.plugin.taskFilter = "all";
		this.render();
	}

	/** The layout (Tasks / Both) changed: project rows open or close accordingly. */
	relayout(): void {
		this.render();
	}

	private renderLanes(board: HTMLElement, projects: Project[], hidden: (g: TaskGroup, gi: number) => boolean): void {
		const filter = this.plugin.taskFilter;

		// General cards on top; projects sit together at the bottom (above
		// Notes), so a fresh day is mostly open space.
		if (filter === "all" || filter === "general") this.renderGeneral(board, projects);

		const block = board.createDiv({ cls: "daybook-projects" });
		// Only a project is shown (its chip): no General above, so no gap either.
		block.toggleClass("is-alone", filter !== "all" && filter !== "general");
		block.createDiv({ cls: "daybook-projects-head" }).createDiv({ cls: "daybook-lane-label", text: "Projects" });

		for (const project of projects) {
			if (filter !== "all" && filter !== project.name.toLowerCase()) continue;
			this.renderProjectLane(block, project, projects, this.isExpanded(project), false);
		}
	}

	/**
	 * General cards: the day's main (unnamed) card, tall and a little wider,
	 * with any other general cards in a grid beside it.
	 */
	private renderGeneral(board: HTMLElement, projects: Project[]): void {
		const lane = board.createDiv({ cls: "daybook-lane daybook-lane-general" });
		const main = lane.createDiv({ cls: "daybook-general-main" });
		if (this.groups[0]) {
			this.renderCard(main, this.groups[0], 0, false);
			// Clicking the empty part of the main card starts a new task.
			main.addEventListener("click", (evt) => {
				const t = evt.target as HTMLElement;
				if (t.hasClass("daybook-card") || t.hasClass("daybook-task-list")) this.focus({ group: 0, index: "new" });
			});
		}
		const others = lane.createDiv({ cls: "daybook-cards daybook-general-others" });
		this.groups.forEach((group, gi) => {
			if (gi > 0 && !this.projectOf(group, projects)) this.renderCard(others, group, gi, false);
		});
		this.renderAddTile(others, undefined);
	}

	/** One project's row: panel on the left, its cards (when open) on the right. */
	private renderProjectLane(parent: HTMLElement, project: Project, projects: Project[], expanded: boolean, focused: boolean): void {
		const ctx = this.projectCtx!;
		const lane = parent.createDiv({ cls: "daybook-lane" });
		lane.toggleClass("is-collapsed", !expanded);
		lane.toggleClass("is-focused", focused);
		lane.setCssProps({ "--daybook-project-colour": project.colour });
		const panelHost = lane.createDiv({ cls: "daybook-lane-panel" });

		let linked = 0;
		let openToday = 0;
		const milestoneCards = new Set<string>();
		const mine: number[] = [];
		this.groups.forEach((group, gi) => {
			if (this.projectOf(group, projects) !== project) return;
			linked++;
			openToday += group.tasks.filter(isOpen).length;
			const id = parseCardLink(group.name)?.milestoneId;
			if (id) milestoneCards.add(id);
			mine.push(gi);
		});

		if (expanded) {
			const grid = lane.createDiv({ cls: "daybook-cards" });
			for (const gi of mine) this.renderCard(grid, this.groups[gi]!, gi, false);
			this.renderAddTile(grid, project.name);
		}

		const panel = new ProjectPanel(this.plugin, panelHost, project, {
			date: ctx.date,
			hasTodayCard: linked > 0,
			expanded,
			onToggle: () => this.toggleProject(project),
			focused,
			onFocus: () => this.setProjectFocus(focused ? null : project),
			openToday,
			addTodayCard: () => this.addProjectCard(project.name),
			milestoneCards,
			openMilestoneCard: (id, text) => this.addMilestoneCard(project.name, id, text),
			onStatusChange: () => ctx.reloadProjects(),
		});
		this.panels.push(panel);
		this.addChild(panel);
	}

	/** The project shown on its own (⤢ on its panel), if it's still active today. */
	private focusedProject(projects: Project[]): Project | null {
		const key = this.plugin.focusedProject;
		if (!key || !this.projectCtx || this.projectCtx.compact) return null;
		return projects.find((p) => p.name.toLowerCase() === key) ?? null;
	}

	private setProjectFocus(project: Project | null): void {
		this.plugin.focusedProject = project ? project.name.toLowerCase() : null;
		this.plugin.focusedCard = null;
		this.render();
	}

	/** Lines open in the opened-out day (lower-case project names); start closed. */
	private compactOpen = new Set<string>();

	/**
	 * Opened-out day: general cards, then a line per project that has cards
	 * today (or is active). ▸ shows that project's cards indented below it.
	 */
	private renderCompactProjects(board: HTMLElement, projects: Project[], hidden: (g: TaskGroup, gi: number) => boolean): void {
		const general = board.createDiv({ cls: "daybook-cards" });
		const byProject = new Map<string, { name: string; colour: string; groups: number[] }>();
		for (const p of projects) byProject.set(p.name.toLowerCase(), { name: p.name, colour: p.colour, groups: [] });
		this.groups.forEach((group, gi) => {
			const link = parseCardLink(group.name);
			if (!link) {
				if (!hidden(group, gi)) this.renderCard(general, group, gi, false);
				return;
			}
			const key = link.project.toLowerCase();
			const entry = byProject.get(key) ?? { name: link.project, colour: "var(--text-faint)", groups: [] };
			entry.groups.push(gi);
			byProject.set(key, entry);
		});

		for (const [key, entry] of byProject) {
			const open = this.compactOpen.has(key);
			const openTasks = entry.groups.reduce((n, gi) => n + this.groups[gi]!.tasks.filter(isOpen).length, 0);
			const line = board.createDiv({ cls: "daybook-project-line" });
			line.setCssProps({ "--daybook-project-colour": entry.colour });
			const head = line.createDiv({
				cls: "daybook-project-line-head",
				attr: { role: "button", tabindex: "0", "aria-expanded": String(open), "aria-label": `${open ? "Hide" : "Show"} ${entry.name} cards` },
			});
			setIcon(head.createSpan({ cls: "daybook-layout-icon" }), open ? "chevron-down" : "chevron-right");
			head.createSpan({ cls: "daybook-project-dot" });
			head.createSpan({ cls: "daybook-project-name", text: entry.name });
			head.createSpan({
				cls: "daybook-project-summary",
				text: entry.groups.length === 0 ? "no cards today" : openTasks ? `${openTasks} open` : "all done",
			});
			const flip = () => {
				if (open) this.compactOpen.delete(key);
				else this.compactOpen.add(key);
				this.render();
			};
			head.addEventListener("click", flip);
			head.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					flip();
				}
			});
			if (open) {
				const grid = line.createDiv({ cls: "daybook-cards daybook-project-line-cards" });
				for (const gi of entry.groups) this.renderCard(grid, this.groups[gi]!, gi, false);
				this.renderAddTile(grid, entry.name);
			}
		}
	}

	/** Dashed "+ Card" tile at the end of a row. */
	private renderAddTile(grid: HTMLElement, project: string | undefined): void {
		const tile = grid.createDiv({
			cls: "daybook-add-tile",
			attr: { role: "button", tabindex: "0", "aria-label": project ? `Add a card to ${project}` : "Add a general card" },
		});
		setIcon(tile.createSpan({ cls: "daybook-layout-icon" }), "plus");
		tile.createSpan({ text: "Card" });
		tile.addEventListener("click", () => this.addCard(project));
		tile.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				this.addCard(project);
			}
		});
	}

	/** Shows a project's row (switching the chip to "All" if it's filtered out). */
	private revealProject(name: string): void {
		const key = name.toLowerCase();
		this.compactOpen.add(key);
		const f = this.plugin.taskFilter;
		if (f !== "all" && f !== key) this.plugin.taskFilter = "all";
		// Make sure the row is open so the new card is visible.
		if (this.plugin.settings.dayLayout === "both") this.plugin.bothExpanded.add(key);
		else if (this.plugin.settings.collapsedProjects.includes(key)) {
			this.plugin.settings.collapsedProjects = this.plugin.settings.collapsedProjects.filter((n) => n !== key);
			void this.plugin.saveSettings(false);
		}
	}

	/** Adds today's task card for a project (or focuses the existing one). */
	addProjectCard(name: string): void {
		let gi = this.groups.findIndex((g) => {
			const link = parseCardLink(g.name);
			return link !== null && sameName(link.project, name) && !link.milestoneId;
		});
		if (gi < 0) {
			this.groups.push(emptyGroup(projectCardName(name)));
			gi = this.groups.length - 1;
			this.onChange();
		}
		this.revealProject(name);
		this.render({ group: gi, index: "new" });
	}

	/** Adds (or focuses) the day's card for a milestone. */
	addMilestoneCard(project: string, id: string, text: string): void {
		let gi = this.groups.findIndex((g) => {
			const link = parseCardLink(g.name);
			return link !== null && sameName(link.project, project) && link.milestoneId === id;
		});
		if (gi < 0) {
			this.groups.push(emptyGroup(milestoneCardName(project, id, text)));
			gi = this.groups.length - 1;
			this.onChange();
		}
		this.revealProject(project);
		this.render({ group: gi, index: "new" });
	}

	/** Redraws the project panels only (keeps the cursor in task boxes). */
	refreshPanels(): void {
		for (const panel of this.panels) panel.refresh();
	}

	private focusedIndex(): number {
		const key = this.plugin.focusedCard;
		if (!key) return -1;
		if (key === LOOSE_KEY) return this.groups.length ? 0 : -1;
		return this.groups.findIndex((g) => g.name !== null && g.name.trim().toLowerCase() === key);
	}

	/** Expands a card (or, with null, shows all cards again). */
	private setFocus(group: TaskGroup | null): void {
		this.plugin.focusedCard = group ? focusKey(group) : null;
		this.render();
	}

	/** ⤢ / "Show all" button for a card's header (or the unnamed card's corner). */
	private focusButton(parent: HTMLElement, group: TaskGroup, focused: boolean): HTMLElement {
		const btn = parent.createDiv({
			cls: "clickable-icon daybook-card-focus",
			attr: { role: "button", tabindex: "0", "aria-label": focused ? "Show all cards" : "Expand this card" },
		});
		setIcon(btn, focused ? "minimize-2" : "maximize-2");
		if (focused) btn.createSpan({ text: "Show all" });
		const toggle = () => this.setFocus(focused ? null : group);
		btn.addEventListener("click", toggle);
		btn.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				toggle();
			}
		});
		return btn;
	}

	/** A card shrunk into the side column while another card is focused. */
	private renderRailCard(rail: HTMLElement, group: TaskGroup, gi: number): void {
		const card = rail.createDiv({ cls: "daybook-card is-collapsed is-railed", attr: { "data-group": String(gi) } });
		const link = parseCardLink(group.name);
		const label = group.name === null ? "Tasks" : (link ? this.linkLabel(link) : group.name.trim()) || "Untitled";
		const btn = card.createDiv({
			cls: "daybook-rail-btn",
			attr: { role: "button", tabindex: "0", "aria-label": `Expand ${label}` },
		});
		btn.createSpan({ cls: "daybook-rail-name", text: label });
		btn.createSpan({ cls: "daybook-card-count", text: countText(group) });
		btn.addEventListener("click", () => this.setFocus(group));
		btn.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				this.setFocus(group);
			}
		});
	}

	private renderCard(grid: HTMLElement, group: TaskGroup, gi: number, focused: boolean): void {
		const card = grid.createDiv({ cls: "daybook-card", attr: { "data-group": String(gi) } });
		const collapsed = !focused && this.isCollapsed(group);
		card.toggleClass("is-collapsed", collapsed);
		card.toggleClass("is-focused", focused);
		card.toggleClass("is-loose", group.name === null);

		if (group.name !== null) {
			this.renderCardHeader(card, group, gi, collapsed, focused);
		} else if (focused) {
			// The unnamed card, expanded: a slim bar with "Show all".
			const bar = card.createDiv({ cls: "daybook-card-header daybook-loose-header" });
			bar.createSpan({ cls: "daybook-loose-title", text: "Tasks" });
			this.focusButton(bar, group, true);
		} else if (this.groups.length > 0) {
			// The unnamed card can expand too: ⤢ in its corner.
			this.focusButton(card, group, false).addClass("daybook-loose-focus");
		}

		const list = card.createDiv({ cls: "daybook-task-list" });
		if (focused) {
			// Clicking the empty space of an expanded card starts a new task.
			card.addEventListener("click", (evt) => {
				const t = evt.target as HTMLElement;
				if (t === card || t === list) this.focus({ group: gi, index: "new" });
			});
		}
		group.tasks.forEach((task, ti) => this.renderTask(list, task, gi, ti, collapsed));

		// Typing here creates a new task in this card.
		const adder = list.createDiv({ cls: "daybook-task daybook-task-new", attr: { "data-group": String(gi) } });
		adder.createSpan({ cls: "daybook-task-handle-space" });
		adder.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { disabled: "true", "aria-hidden": "true" } });
		const add = adder.createEl("input", {
			type: "text",
			cls: "daybook-task-text",
			attr: { placeholder: "Add a task", "aria-label": "Add a task" },
		});
		add.addEventListener("input", () => {
			if (add.value.trim() === "") return;
			group.tasks.push(newTask(add.value));
			this.onChange();
			this.render({ group: gi, index: group.tasks.length - 1 });
		});
		add.addEventListener("keydown", (evt) => this.navigate(evt, add));
		this.inputs.set(`${gi}:new`, add);
		if (!collapsed) this.order.push(add);
	}

	private renderCardHeader(card: HTMLElement, group: TaskGroup, gi: number, collapsed: boolean, focused: boolean): void {
		const header = card.createDiv({ cls: "daybook-card-header" });

		const toggle = header.createDiv({
			cls: "daybook-card-toggle clickable-icon",
			attr: { role: "button", tabindex: "0", "aria-expanded": String(!collapsed), "aria-label": collapsed ? "Expand card" : "Collapse card" },
		});
		setIcon(toggle, collapsed ? "chevron-right" : "chevron-down");
		if (focused) toggle.hide(); // no collapsing while focused
		const flip = () => {
			if (!group.name) return;
			this.setCollapsed(group.name, !this.isCollapsed(group));
			this.render();
		};
		toggle.addEventListener("click", flip);
		toggle.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				flip();
			}
		});

		const link = parseCardLink(group.name);
		if (link?.milestoneId) {
			// A milestone's card: titled by the milestone; its tasks tick the milestone.
			const label = header.createSpan({ cls: "daybook-card-title daybook-card-title-link", attr: { "aria-label": `Tasks for milestone ${this.linkLabel(link)}` } });
			setIcon(label.createSpan({ cls: "daybook-layout-icon" }), "flag");
			label.createSpan({ text: this.linkLabel(link) });
		} else if (link) {
			// A project card: the link stays, the title after it is editable.
			const project = link.project;
			setIcon(header.createSpan({ cls: "daybook-layout-icon daybook-card-link-icon", attr: { "aria-label": `Card in ${project}` } }), "briefcase");
			const title = header.createEl("input", {
				type: "text",
				cls: "daybook-card-title",
				attr: { placeholder: project, "aria-label": `Card name (in ${project})` },
			});
			title.value = link.title;
			title.addEventListener("input", () => {
				group.name = projectCardName(project, title.value);
				this.onChange();
			});
			title.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					this.focus({ group: gi, index: group.tasks.length ? 0 : "new", caret: "end" });
				}
			});
			this.inputs.set(`${gi}:title`, title);
		} else {
			const title = header.createEl("input", {
				type: "text",
				cls: "daybook-card-title",
				attr: { placeholder: "Card name", "aria-label": "Card name" },
			});
			title.value = group.name ?? "";
			let nameBefore = group.name ?? "";
			title.addEventListener("input", () => {
				group.name = title.value;
				this.onChange();
			});
			title.addEventListener("change", () => {
				// Keep the collapsed state when a collapsed card is renamed.
				if (nameBefore && this.plugin.settings.collapsedCards.includes(nameBefore.toLowerCase())) {
					this.setCollapsed(nameBefore, false);
					if (title.value.trim()) this.setCollapsed(title.value.trim(), true);
				}
				if (focused) this.plugin.focusedCard = title.value.trim().toLowerCase() || null;
				nameBefore = title.value;
			});
			title.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					if (this.isCollapsed(group)) title.blur();
					else this.focus({ group: gi, index: group.tasks.length ? 0 : "new", caret: "end" });
				}
			});
			this.inputs.set(`${gi}:title`, title);
		}

		header.createSpan({ cls: "daybook-card-count", text: countText(group) });

		this.focusButton(header, group, focused);

		const more = header.createDiv({ cls: "clickable-icon daybook-card-menu", attr: { role: "button", tabindex: "0", "aria-label": "Card options" } });
		setIcon(more, "more-horizontal");
		more.addEventListener("click", (evt) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle(group.tasks.length ? "Remove card (tasks move to the top)" : "Remove card")
					.setIcon("trash")
					.onClick(() => {
						if (group.name) this.setCollapsed(group.name, false);
						if (focused) this.plugin.focusedCard = null;
						removeGroup(this.groups, gi);
						this.onChange();
						this.render();
					}),
			);
			menu.showAtMouseEvent(evt);
		});
	}

	private renderTask(list: HTMLElement, task: Task, gi: number, ti: number, collapsed: boolean): void {
		const row = list.createDiv({ cls: "daybook-task", attr: { "data-group": String(gi), "data-index": String(ti) } });
		row.toggleClass("is-done", task.done);
		row.setCssProps({ "--daybook-depth": String(task.depth) });

		const handle = row.createDiv({ cls: "daybook-task-handle", attr: { "aria-label": "Drag to move" } });
		setIcon(handle, "grip-vertical");
		handle.addEventListener("pointerdown", (evt) => this.startDrag(evt, handle, row, { group: gi, index: ti }));

		if (this.plugin.unsavedRuleTasks.has(task)) {
			row.addClass("is-from-rule");
			const mark = row.createSpan({ cls: "daybook-rule-mark", attr: { "aria-label": "From a recurring task. Saved when you edit this day." } });
			setIcon(mark, "repeat");
		}
		if (task.carried) {
			// Moved to a later day: an arrow instead of a checkbox. Clicking it undoes the mark.
			row.addClass("is-carried");
			const mark = row.createDiv({
				cls: "daybook-carried-mark clickable-icon",
				attr: {
					role: "button",
					tabindex: "0",
					"aria-label": `${task.movedTo ? `Moved to ${movedLabel(task.movedTo)}` : "Moved to a later day"}. Click to keep it here instead.`,
				},
			});
			setIcon(mark, "corner-up-right");
			mark.addEventListener("click", () => {
				task.carried = false;
				delete task.movedTo;
				this.onChange();
				this.render();
			});
		} else {
			const box = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox", attr: { "aria-label": "Done" } });
			box.checked = task.done;
			box.addEventListener("change", () => {
				task.done = box.checked;
				row.toggleClass("is-done", task.done);
				this.onChange();
			});
		}

		const input = row.createEl("input", { type: "text", cls: "daybook-task-text", attr: { "aria-label": "Task" } });
		input.value = task.text;
		input.addEventListener("input", () => {
			task.text = input.value;
			this.onChange();
		});
		input.addEventListener("keydown", (evt) => this.onTaskKey(evt, gi, ti, input));
		this.inputs.set(`${gi}:${ti}`, input);
		if (!collapsed) this.order.push(input);

		// Where a moved task went: "→ Fri 13 Nov", click to go there.
		if (task.carried && task.movedTo) {
			const to = task.movedTo;
			const link = row.createSpan({ cls: "daybook-moved-to", text: `→ ${movedLabel(to)}`, attr: { role: "link", tabindex: "0", "aria-label": `Open ${movedLabel(to)}` } });
			link.addEventListener("click", () => void this.plugin.open({ level: "day", date: to }));
			link.addEventListener("keydown", (e) => {
				if (e.key === "Enter") void this.plugin.open({ level: "day", date: to });
			});
		}

		if (task.children.length) {
			row.createSpan({
				cls: "daybook-task-extra",
				text: `+${task.children.length}`,
				attr: { "aria-label": "Lines under this task in the note" },
			});
		}

		// ⋯ task menu (also right-click on the grip).
		const more = row.createDiv({ cls: "clickable-icon daybook-task-menu", attr: { role: "button", tabindex: "0", "aria-label": "Task options" } });
		setIcon(more, "more-horizontal");
		const open = (evt: MouseEvent) => {
			evt.preventDefault();
			this.showTaskMenu(evt, task, gi, ti);
		};
		more.addEventListener("click", open);
		handle.addEventListener("contextmenu", open);
	}

	private showTaskMenu(evt: MouseEvent, task: Task, gi: number, ti: number): void {
		const group = this.groups[gi]!;
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Move to date…")
				.setIcon("calendar-days")
				.setDisabled(!isOpen(task))
				.onClick(() => this.moveToDate(gi, ti)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Make recurring…")
				.setIcon("repeat")
				.setDisabled(!task.text.trim())
				.onClick(() => {
					const from = this.projectCtx?.date ?? todayKey();
					const prefill: Rule = { text: task.text.trim(), freq: { kind: "daily" }, card: group.name, from, paused: false };
					openAddRule(this.plugin, (rule) => this.projectCtx?.recordRule?.(ruleId(rule)), prefill);
				}),
		);
		menu.showAtMouseEvent(evt);
	}

	private focus(f: Focus): void {
		const input = this.inputs.get(`${f.group}:${f.index}`);
		if (!input) return;
		input.focus();
		const pos = f.caret === "start" ? 0 : input.value.length;
		input.setSelectionRange(pos, pos);
	}

	// ---- Cards ----

	// ---- Move to date ----

	private moveToDate(gi: number, ti: number): void {
		const task = this.groups[gi]?.tasks[ti];
		if (!task || !isOpen(task)) return;
		const from = this.projectCtx?.date ?? todayKey();
		new MoveModal(this.plugin.app, task.text, from, this.plugin.settings.firstDayOfWeek, (date) => void this.moveBlockTo(gi, ti, task, date)).open();
	}

	/**
	 * Adds the task (and its unfinished subtasks) to the chosen day's note under
	 * the same card, then marks it [>] here. The other day is written first, so
	 * nothing is marked as moved if that fails.
	 */
	private async moveBlockTo(gi: number, ti: number, task: Task, date: DateKey): Promise<void> {
		if (this.groups[gi]?.tasks[ti] !== task) return; // the list changed meanwhile
		const preview = takeTaskBlock({ ...emptyDay(), groups: structuredClone(this.groups) }, gi, ti);
		if (preview.length === 0) return;
		try {
			await this.plugin.store.write(dayPath(this.plugin.settings.rootFolder, date), (old) => {
				const target = parseDay(old);
				addCarried(target, preview);
				return applyDay(old, target);
			});
		} catch (e) {
			console.error("Daybook: could not move task", e);
			new Notice("Daybook could not move the task.");
			return;
		}
		takeTaskBlock({ ...emptyDay(), groups: this.groups }, gi, ti, date);
		this.onChange();
		this.render();
		new Notice(`Moved to ${formatDate(date, { weekday: "short", day: "numeric", month: "short" }, moment.locale())}.`);
	}

	/** New card; in a project when `project` is given. */
	private addCard(project?: string): void {
		this.groups.push(emptyGroup(project ? projectCardName(project) : ""));
		this.onChange();
		if (project) this.revealProject(project);
		this.render({ group: this.groups.length - 1, index: "title" });
	}

	// ---- Keyboard ----

	private navigate(evt: KeyboardEvent, input: HTMLInputElement): boolean {
		if (evt.altKey || (evt.key !== "ArrowUp" && evt.key !== "ArrowDown")) return false;
		const i = this.order.indexOf(input);
		const next = this.order[evt.key === "ArrowUp" ? i - 1 : i + 1];
		if (!next) return false;
		evt.preventDefault();
		next.focus();
		next.setSelectionRange(next.value.length, next.value.length);
		return true;
	}

	private onTaskKey(evt: KeyboardEvent, gi: number, ti: number, input: HTMLInputElement): void {
		if (evt.isComposing) return;
		const tasks = this.groups[gi]!.tasks;

		// Mod+Shift+M: move this task to another day.
		if (Keymap.isModifier(evt, "Mod") && evt.shiftKey && evt.key.toLowerCase() === "m") {
			evt.preventDefault();
			this.moveToDate(gi, ti);
			return;
		}
		if (evt.altKey && (evt.key === "ArrowUp" || evt.key === "ArrowDown")) {
			evt.preventDefault();
			this.moveByKey(gi, ti, evt.key === "ArrowUp" ? -1 : 1);
			return;
		}
		if (this.navigate(evt, input)) return;

		const task = tasks[ti]!;
		if (evt.key === "Tab" && !evt.metaKey && !evt.ctrlKey) {
			evt.preventDefault(); // keep focus here even when it can't nest further
			if (shiftDepth(tasks, ti, evt.shiftKey ? -1 : 1)) {
				this.onChange();
				this.render({ group: gi, index: ti, caret: "end" });
			}
		} else if (evt.key === "Enter") {
			evt.preventDefault();
			// Split at the caret, like a normal list editor. If the task has
			// subtasks, the new one becomes the first subtask.
			const caret = input.selectionStart ?? input.value.length;
			const hasSubtasks = (tasks[ti + 1]?.depth ?? -1) > task.depth;
			task.text = input.value.slice(0, caret);
			tasks.splice(ti + 1, 0, newTask(input.value.slice(caret), hasSubtasks ? task.depth + 1 : task.depth));
			this.onChange();
			this.render({ group: gi, index: ti + 1, caret: "start" });
		} else if (evt.key === "Backspace" && input.value === "" && task.depth > 0) {
			evt.preventDefault(); // empty subtask: step out a level first
			shiftDepth(tasks, ti, -1);
			this.onChange();
			this.render({ group: gi, index: ti });
		} else if (
			evt.key === "Backspace" &&
			input.value === "" &&
			task.children.length === 0 &&
			blockEnd(tasks, ti) === ti + 1
		) {
			evt.preventDefault();
			tasks.splice(ti, 1);
			this.onChange();
			this.render(ti > 0 ? { group: gi, index: ti - 1 } : { group: gi, index: tasks.length ? 0 : "new" });
		}
	}

	/** Alt+↑/↓: move within the card, or into the neighbouring card at its edge. */
	private moveByKey(gi: number, ti: number, dir: -1 | 1): void {
		const tasks = this.groups[gi]!.tasks;
		let to: TaskPos;
		const end = blockEnd(tasks, ti);
		if (dir === -1 && ti > 0) to = { group: gi, index: ti - 1 };
		else if (dir === 1 && end < tasks.length) to = { group: gi, index: blockEnd(tasks, end) };
		else {
			const ng = this.neighbourGroup(gi, dir);
			if (ng === null) return;
			to = { group: ng, index: dir === -1 ? this.groups[ng]!.tasks.length : 0 };
		}
		const at = moveTask(this.groups, { group: gi, index: ti }, to);
		this.onChange();
		this.render({ group: at.group, index: at.index });
	}

	private neighbourGroup(gi: number, dir: -1 | 1): number | null {
		for (let g = gi + dir; g >= 0 && g < this.groups.length; g += dir) {
			if (!this.isCollapsed(this.groups[g]!)) return g;
		}
		return null;
	}

	// ---- Dragging (pointer events: mouse, pen and touch) ----

	private startDrag(evt: PointerEvent, handle: HTMLElement, row: HTMLElement, from: TaskPos): void {
		if (evt.button !== 0 || this.drag) return;
		evt.preventDefault();
		handle.setPointerCapture(evt.pointerId);
		const line = this.gridEl.querySelector<HTMLElement>(".daybook-drop-line")!;
		// The task and its subtasks move together.
		const end = blockEnd(this.groups[from.group]!.tasks, from.index);
		const rows = [row];
		for (let i = from.index + 1; i < end; i++) {
			const r = this.gridEl.querySelector<HTMLElement>(`.daybook-task[data-group="${from.group}"][data-index="${i}"]`);
			if (r) rows.push(r);
		}
		this.drag = { from, rows, handle, pointerId: evt.pointerId, line, target: null, targetCard: null };
		for (const r of rows) r.addClass("is-dragging");
		this.gridEl.addClass("is-dragging");

		const move = (e: PointerEvent) => this.onDragMove(e);
		const up = () => this.endDrag(true);
		const cancel = () => this.endDrag(false);
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up, { once: true });
		handle.addEventListener("pointercancel", cancel, { once: true });
		this.dragCleanup = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
			handle.removeEventListener("pointercancel", cancel);
		};
	}

	private dragCleanup: (() => void) | null = null;

	private onDragMove(evt: PointerEvent): void {
		const drag = this.drag;
		if (!drag) return;
		const doc = this.gridEl.ownerDocument;
		const el = doc.elementFromPoint(evt.clientX, evt.clientY) as HTMLElement | null;
		this.autoScroll(evt.clientY);

		drag.targetCard?.removeClass("is-drop-target");
		drag.targetCard = null;
		drag.target = null;
		drag.line.hide();
		if (!el || !this.gridEl.contains(el)) return;

		const card = el.closest<HTMLElement>(".daybook-card");
		if (!card) return;
		const gi = Number(card.getAttr("data-group"));
		const group = this.groups[gi];
		if (!group) return;

		// Collapsed card: drop anywhere on it to add at the end.
		if (card.hasClass("is-collapsed")) {
			drag.target = { group: gi, index: group.tasks.length };
			drag.targetCard = card;
			card.addClass("is-drop-target");
			return;
		}

		const row = el.closest<HTMLElement>(".daybook-task");
		let index: number;
		if (row && row.hasAttribute("data-index")) {
			const r = row.getBoundingClientRect();
			index = Number(row.getAttr("data-index")) + (evt.clientY > r.top + r.height / 2 ? 1 : 0);
		} else if (el.closest(".daybook-card-header")) {
			index = 0;
		} else {
			index = group.tasks.length;
		}
		drag.target = { group: gi, index };
		this.showLine(card, gi, index);
	}

	/** Draws the drop line above row `index` of a card (or below its last row). */
	private showLine(card: HTMLElement, gi: number, index: number): void {
		const line = this.drag!.line;
		const rows = Array.from(card.querySelectorAll<HTMLElement>(`.daybook-task[data-group="${gi}"]`));
		const before = rows[index]; // the adder row is last, so "end" lands above it
		if (!before) return;
		const gridRect = this.gridEl.getBoundingClientRect();
		const r = before.getBoundingClientRect();
		line.setCssStyles({
			top: `${r.top - gridRect.top - 1}px`,
			left: `${r.left - gridRect.left}px`,
			width: `${r.width}px`,
		});
		line.show();
	}

	private autoScroll(y: number): void {
		const scroller = scrollParent(this.gridEl);
		if (!scroller) return;
		const r = scroller.getBoundingClientRect();
		const edge = 40;
		if (y < r.top + edge) scroller.scrollBy(0, -12);
		else if (y > r.bottom - edge) scroller.scrollBy(0, 12);
	}

	private endDrag(drop: boolean): void {
		const drag = this.drag;
		if (!drag) return;
		this.drag = null;
		this.dragCleanup?.();
		this.dragCleanup = null;
		if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
		for (const r of drag.rows) r.removeClass("is-dragging");
		drag.targetCard?.removeClass("is-drop-target");
		this.gridEl.removeClass("is-dragging");
		drag.line.hide();

		if (!drop || !drag.target) return;
		const { from, target } = drag;
		const end = blockEnd(this.groups[from.group]!.tasks, from.index);
		const noop = from.group === target.group && target.index >= from.index && target.index <= end;
		if (noop) return;
		moveTask(this.groups, from, target);
		this.onChange();
		this.render();
	}
}

/** Nearest ancestor that scrolls (the tasks pane on desktop, the page on phones). */
function scrollParent(el: HTMLElement): HTMLElement | null {
	for (let p = el.parentElement; p; p = p.parentElement) {
		const overflow = getComputedStyle(p).overflowY;
		if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight) return p;
	}
	return null;
}

function countText(group: TaskGroup): string {
	const open = group.tasks.filter(isOpen).length;
	const total = group.tasks.filter((t) => t.text.trim()).length;
	return total === 0 ? "Empty" : open === 0 ? "All done" : `${open} open`;
}

/** Focus key for the unnamed card (it has no heading to remember it by). */
const LOOSE_KEY = "\u0001tasks";

function focusKey(group: TaskGroup): string {
	return group.name === null ? LOOSE_KEY : group.name.trim().toLowerCase();
}

/** "Fri 13 Nov" for a moved task's new day. */
function movedLabel(date: string): string {
	return formatDate(date, { weekday: "short", day: "numeric", month: "short" }, moment.locale());
}
