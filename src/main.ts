import { Notice, Platform, Plugin, WorkspaceLeaf, debounce, moment } from "obsidian";
import { formatDate, todayKey } from "./core/dates";
import { DEFAULT_SETTINGS, DaybookSettings, Selection } from "./core/types";
import { VaultStore } from "./obsidian/store";
import { ProjectStore } from "./obsidian/projects";
import { EventStore } from "./obsidian/events";
import { RecurringStore } from "./obsidian/recurring";
import { ScratchpadStore } from "./obsidian/scratchpad";
import { DaybookSettingTab } from "./obsidian/settingsTab";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./ui/calendarView";
import { DaybookView, VIEW_TYPE_DAYBOOK } from "./ui/daybookView";
import { ScratchpadView, VIEW_TYPE_SCRATCHPAD } from "./ui/scratchpadView";
import { addToScratchpad, takeFromScratchpad } from "./core/scratchpad";
import { newEvent } from "./ui/eventActions";
import { RulesModal, openAddRule } from "./ui/recurringModal";
import { GoToDateModal } from "./ui/goToDateModal";
import { HelpModal } from "./ui/helpModal";
import { PromptModal } from "./ui/promptModal";
import { CarriedCard, addCarried, applyDay, newTask, parseDay, removeTaskBlock } from "./core/day";
import { dayPath } from "./core/paths";
import { cleanProjectName } from "./core/project";

export default class DaybookPlugin extends Plugin {
	settings: DaybookSettings = structuredClone(DEFAULT_SETTINGS);
	store!: VaultStore;
	projects!: ProjectStore;
	events!: EventStore;
	recurring!: RecurringStore;
	scratchpad!: ScratchpadStore;
	/** Bumped whenever Scratchpad.md changes, so the sidebar and page can redraw. */
	scratchpadVersion = 0;
	/** Tasks added from recurring rules that aren't saved into their day yet. */
	unsavedRuleTasks = new WeakSet<object>();
	/** Bumped whenever the recurring rules change, so open days can redraw. */
	recurringVersion = 0;
	/** Bumped whenever an event note changes, so views know to redraw. */
	eventsVersion = 0;
	/** What the main view is showing; the calendar highlights it. */
	selection: Selection = { level: "day", date: todayKey() };
	/** Day view task filter: "all", "general" or a project name (lower case). Session only. */
	taskFilter = "all";
	/** Days where the carry-over bar was dismissed this session. */
	carryDismissed = new Set<string>();
	/** Year view: the events list is open. Session only. */
	yearEventsOpen = false;
	/** Year view: category tag to highlight, or "all". Session only. */
	yearHighlight = "all";
	/** Both layout: projects opened this time (they start collapsed). Session only. */
	bothExpanded = new Set<string>();
	/** Project shown on its own on the day page (lower-case name). Session only. */
	focusedProject: string | null = null;
	/** Task card in focus (lower-case name), for this session only. */
	focusedCard: string | null = null;
	private listeners = new Set<() => void>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.store = new VaultStore(this.app);
		this.projects = new ProjectStore(this.app, this.store, () => this.settings.rootFolder);
		this.events = new EventStore(this.app, this.store, () => this.settings.rootFolder);
		this.recurring = new RecurringStore(this.store, () => this.settings.rootFolder);
		this.scratchpad = new ScratchpadStore(this.store, () => this.settings.rootFolder);
		const padChanged = debounce(() => {
			this.scratchpadVersion++;
			this.notify();
		}, 300, true);
		const isPad = (path: string) => path === this.scratchpad.path();
		this.registerEvent(this.app.vault.on("modify", (file) => isPad(file.path) && padChanged()));
		this.registerEvent(this.app.vault.on("create", (file) => isPad(file.path) && padChanged()));
		this.registerEvent(this.app.vault.on("delete", (file) => isPad(file.path) && padChanged()));
		const rulesChanged = debounce(() => {
			this.recurringVersion++;
			this.notify();
		}, 300, true);
		const isRules = (path: string) => path === this.recurring.path();
		this.registerEvent(this.app.vault.on("modify", (file) => isRules(file.path) && rulesChanged()));
		this.registerEvent(this.app.vault.on("create", (file) => isRules(file.path) && rulesChanged()));
		this.registerEvent(this.app.vault.on("delete", (file) => isRules(file.path) && rulesChanged()));

		// Event notes changed (here, in the editor, or by sync): tell the views.
		const eventsChanged = debounce(() => {
			this.eventsVersion++;
			this.notify();
		}, 300, true);
		this.registerEvent(this.app.metadataCache.on("changed", (file) => this.events.isEventPath(file.path) && eventsChanged()));
		this.registerEvent(this.app.vault.on("delete", (file) => this.events.isEventPath(file.path) && eventsChanged()));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => (this.events.isEventPath(file.path) || this.events.isEventPath(oldPath)) && eventsChanged()),
		);

		this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));
		this.registerView(VIEW_TYPE_DAYBOOK, (leaf) => new DaybookView(leaf, this));
		this.registerView(VIEW_TYPE_SCRATCHPAD, (leaf) => new ScratchpadView(leaf, this));

		this.addRibbonIcon("calendar-days", "Open today", () => void this.openToday());

		this.addCommand({
			id: "open-today",
			name: "Open today",
			callback: () => void this.openToday(),
		});
		this.addCommand({
			id: "focus-today",
			name: "Focus on today",
			callback: () => void (this.focusMode ? this.exitFocus() : this.enterFocus(todayKey())),
		});
		this.addCommand({
			id: "new-event",
			name: "New event",
			callback: () => newEvent(this, todayKey(), todayKey()),
		});
		this.addCommand({
			id: "recurring-tasks",
			name: "Recurring tasks",
			callback: () => new RulesModal(this).open(),
		});
		this.addCommand({
			id: "add-recurring-task",
			name: "Add recurring task",
			callback: () => openAddRule(this),
		});
		this.addCommand({
			id: "go-to-date",
			name: "Go to date…",
			callback: () => new GoToDateModal(this.app, (date) => void this.open({ level: "day", date })).open(),
		});
		this.addCommand({
			id: "quick-add-task",
			name: "Quick add task to today",
			callback: () => new PromptModal(this.app, "Add a task to today", "Call the bank", "Add", (text) => void this.quickAddTask(text)).open(),
		});
		this.addCommand({
			id: "open-this-week",
			name: "Open this week",
			callback: () => void this.open({ level: "week", date: todayKey() }),
		});
		this.addCommand({
			id: "open-this-month",
			name: "Open this month",
			callback: () => void this.open({ level: "month", date: todayKey() }),
		});
		this.addCommand({
			id: "open-this-year",
			name: "Open this year",
			callback: () => void this.open({ level: "year", date: todayKey() }),
		});
		this.addCommand({
			id: "new-project",
			name: "New project",
			callback: () => new PromptModal(this.app, "Start a project", "Project name", "Start", (name) => void this.newProject(name)).open(),
		});
		this.addCommand({
			id: "help",
			name: "How to use",
			callback: () => new HelpModal(this.app).open(),
		});
		this.addCommand({
			id: "open-scratchpad",
			name: "Open scratchpad",
			callback: () => void this.openScratchpad(),
		});
		this.addCommand({
			id: "quick-add-scratchpad",
			name: "Quick add to scratchpad",
			callback: () =>
				new PromptModal(this.app, "Add to the scratchpad", "An idea or a task for some day", "Add", (text) => void this.quickAddToScratchpad(text)).open(),
		});
		this.addCommand({
			id: "show-calendar",
			name: "Show calendar",
			callback: () => void this.revealCalendar(),
		});

		this.addSettingTab(new DaybookSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			if (this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length === 0) {
				void this.app.workspace.getRightLeaf(false)?.setViewState({ type: VIEW_TYPE_CALENDAR });
			}
		});
	}

	onunload(): void {
		this.exitFocus();
		this.listeners.clear();
	}

	// ---- Focus mode: one day, sidebars hidden, only what's left to do ----

	focusMode = false;
	private sidebarsBefore: { left: boolean; right: boolean } | null = null;

	async enterFocus(date: string): Promise<void> {
		await this.open({ level: "day", date });
		const ws = this.app.workspace;
		if (!this.focusMode) this.sidebarsBefore = { left: ws.leftSplit.collapsed, right: ws.rightSplit.collapsed };
		ws.leftSplit.collapse();
		ws.rightSplit.collapse();
		this.focusMode = true;
		this.notify();
	}

	exitFocus(): void {
		if (!this.focusMode) return;
		this.focusMode = false;
		const ws = this.app.workspace;
		const before = this.sidebarsBefore;
		this.sidebarsBefore = null;
		if (before && !before.left) ws.leftSplit.expand();
		if (before && !before.right) ws.rightSplit.expand();
		this.notify();
	}

	// ---- Change notifications (selection or settings) ----

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	setSelection(selection: Selection): void {
		if (selection.level === this.selection.level && selection.date === this.selection.date) return;
		this.selection = selection;
		this.notify();
	}

	// ---- Opening views ----

	/** Shows `selection` in the main-area Daybook view, reusing an open one if there is one. */
	async open(selection: Selection): Promise<void> {
		const { workspace } = this.app;
		const leaf: WorkspaceLeaf = workspace.getLeavesOfType(VIEW_TYPE_DAYBOOK)[0] ?? workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_DAYBOOK, active: true, state: { ...selection } });
		await workspace.revealLeaf(leaf);
		// On phones the sidebar covers the screen; get it out of the way.
		if (Platform.isMobile) workspace.rightSplit.collapse();
	}

	/** Adds a task to today's main card; today's note is created only now. */
	private async quickAddTask(text: string): Promise<void> {
		const task = text.trim();
		if (!task) return;
		try {
			await this.store.write(
				dayPath(this.settings.rootFolder, todayKey()),
				(old) => {
					const entry = parseDay(old);
					addCarried(entry, [{ name: null, tasks: [newTask(task)] }]);
					return applyDay(old, entry);
				},
				{ fromElsewhere: true }, // today's page may be open: let it reload
			);
			new Notice(`Added to today: ${task}`);
		} catch (e) {
			console.error("Daybook: could not add the task", e);
			new Notice("Daybook could not add the task.");
		}
	}

	/** Opens the Scratchpad page, reusing an open one. */
	async openScratchpad(): Promise<void> {
		const { workspace } = this.app;
		const leaf = workspace.getLeavesOfType(VIEW_TYPE_SCRATCHPAD)[0] ?? workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_SCRATCHPAD, active: true });
		await workspace.revealLeaf(leaf);
		if (Platform.isMobile) workspace.rightSplit.collapse();
	}

	/**
	 * Scratchpad -> a day: the task (found by position and text) and all its
	 * subtasks go into that day's note under the same card, then leave the
	 * Scratchpad with nothing left behind. The day is written first, so a
	 * failed write never loses the task.
	 */
	async moveFromScratchpad(group: number, index: number, text: string, date: string): Promise<boolean> {
		try {
			const pad = await this.scratchpad.read();
			if (pad.groups[group]?.tasks[index]?.text !== text) {
				new Notice("That task changed in the meantime. Try again.");
				return false;
			}
			const cards = takeFromScratchpad(structuredClone(pad), group, index);
			await this.store.write(
				dayPath(this.settings.rootFolder, date),
				(old) => {
					const day = parseDay(old);
					addCarried(day, cards);
					return applyDay(old, day);
				},
				{ fromElsewhere: true }, // that day may be open
			);
			await this.scratchpad.change(
				(p) => {
					if (p.groups[group]?.tasks[index]?.text === text) removeTaskBlock(p, group, index);
				},
				{ fromElsewhere: true },
			);
			new Notice(`Moved to ${formatDate(date, { weekday: "short", day: "numeric", month: "short" }, moment.locale())}.`);
			return true;
		} catch (e) {
			console.error("Daybook: could not move the task", e);
			new Notice("Daybook could not move the task.");
			return false;
		}
	}

	/** Adds tasks taken from a day (already marked there) to the Scratchpad, same cards. */
	async addToScratchpadCards(cards: CarriedCard[]): Promise<void> {
		await this.scratchpad.change((pad) => addCarried(pad, cards), { fromElsewhere: true });
	}

	/** Adds a task to the Scratchpad (the note is created only now). */
	private async quickAddToScratchpad(text: string): Promise<void> {
		const task = text.trim();
		if (!task) return;
		try {
			await this.scratchpad.change((pad) => addToScratchpad(pad, task), { fromElsewhere: true });
			new Notice(`Added to the scratchpad: ${task}`);
		} catch (e) {
			console.error("Daybook: could not add to the scratchpad", e);
			new Notice("Daybook could not add to the scratchpad.");
		}
	}

	/** Creates a project starting today, then shows today (where projects live). */
	private async newProject(raw: string): Promise<void> {
		const name = cleanProjectName(raw);
		if (!name) return;
		try {
			await this.projects.create(name, todayKey());
			await this.open({ level: "day", date: todayKey() });
			new Notice(`Started ${name}. It's at the bottom of today's tasks.`);
		} catch (e) {
			console.error("Daybook: could not create project", e);
			new Notice(`Daybook could not create the project "${name}".`);
		}
	}

	/**
	 * Today's page, with the calendar showing in the right sidebar (opened if
	 * it was collapsed or on another tab). Phones skip the calendar, since the
	 * sidebar would cover the page.
	 */
	async openToday(): Promise<void> {
		if (!Platform.isMobile) await this.revealCalendar();
		await this.open({ level: "day", date: todayKey() }); // focus ends on today's page
	}

	async revealCalendar(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_CALENDAR });
		}
		await workspace.revealLeaf(leaf);
	}

	// ---- Settings ----

	async loadSettings(): Promise<void> {
		const saved = ((await this.loadData()) ?? {}) as Partial<DaybookSettings> & { showDiary?: boolean };
		// Older versions had an on/off diary switch.
		if (saved.dayLayout === undefined && saved.showDiary === false) saved.dayLayout = "tasks";
		delete saved.showDiary;
		this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...saved };
	}

	/** Saves settings; `notify` = false for UI state that doesn't need views redrawn. */
	async saveSettings(notify = true): Promise<void> {
		await this.saveData(this.settings);
		if (notify) this.notify();
	}
}
