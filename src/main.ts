import { Platform, Plugin, WorkspaceLeaf, debounce } from "obsidian";
import { todayKey } from "./core/dates";
import { DEFAULT_SETTINGS, DaybookSettings, Selection } from "./core/types";
import { VaultStore } from "./obsidian/store";
import { ProjectStore } from "./obsidian/projects";
import { EventStore } from "./obsidian/events";
import { RecurringStore } from "./obsidian/recurring";
import { DaybookSettingTab } from "./obsidian/settingsTab";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./ui/calendarView";
import { DaybookView, VIEW_TYPE_DAYBOOK } from "./ui/daybookView";
import { newEvent } from "./ui/eventActions";
import { RulesModal, openAddRule } from "./ui/recurringModal";

export default class DaybookPlugin extends Plugin {
	settings: DaybookSettings = structuredClone(DEFAULT_SETTINGS);
	store!: VaultStore;
	projects!: ProjectStore;
	events!: EventStore;
	recurring!: RecurringStore;
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

		this.addRibbonIcon("calendar-days", "Open today", () => {
			void this.open({ level: "day", date: todayKey() });
		});

		this.addCommand({
			id: "open-today",
			name: "Open today",
			callback: () => void this.open({ level: "day", date: todayKey() }),
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
