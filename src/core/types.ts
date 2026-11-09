// Shared planner types (no Obsidian imports).

import { DateKey, Weekday } from "./dates";

export type ZoomLevel = "day" | "week" | "month" | "year";

/** Day view layout: tasks only, tasks + diary side by side, or diary only. */
export type DayLayout = "tasks" | "both" | "diary";

export interface Selection {
	level: ZoomLevel;
	date: DateKey;
}

export interface Category {
	name: string;
	color: string; // CSS colour, e.g. "#4caf50"
	tag: string; // tag in the day note's properties, without "#"
}

export interface DaybookSettings {
	rootFolder: string;
	firstDayOfWeek: Weekday;
	categories: Category[];
	/** Day view layout (switched from the view header). */
	dayLayout: DayLayout;
	/** Week view layout: day cards, reflection, or both. */
	weekLayout: DayLayout;
	/** Month view layout, same choices. */
	monthLayout: DayLayout;
	/** Year view layout: grid, reflection, or both. */
	yearLayout: DayLayout;
	/** Carry unfinished tasks to today automatically when it's opened. */
	autoCarry: boolean;
	/** Day view: Notes scratchpad collapsed. */
	notesCollapsed: boolean;
	/** Tasks layout: projects (lower-case names) the user collapsed. */
	collapsedProjects: string[];
	/** Task card names (lower case) that are collapsed. */
	collapsedCards: string[];
}

export const DEFAULT_SETTINGS: DaybookSettings = {
	rootFolder: "Daybook",
	firstDayOfWeek: 1,
	categories: [
		{ name: "Work", color: "#4f86c6", tag: "work" },
		{ name: "Health", color: "#5aa469", tag: "health" },
		{ name: "Rest", color: "#d9a441", tag: "rest" },
	],
	dayLayout: "both",
	weekLayout: "tasks",
	monthLayout: "tasks",
	yearLayout: "tasks",
	notesCollapsed: false,
	autoCarry: false,
	collapsedProjects: [],
	collapsedCards: [],
};
