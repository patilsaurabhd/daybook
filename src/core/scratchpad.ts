// The Scratchpad: quick tasks and free-text ideas that belong to no day.
//
//   Daybook/Scratchpad.md
//   ## Tasks
//
//   - [ ] Look into a new bank
//
//   ### Home
//
//   - [ ] Fix the shelf
//   	- [ ] Buy screws
//
//   ## Notes
//
//   Ideas, links, half-formed plans…
//
// Tasks use the same format as day notes (cards, nesting). Notes belong to a
// day; the Scratchpad belongs to no day. Only "## Tasks" and "## Notes" are
// rewritten; anything else in the note is kept.

import {
	CarriedCard,
	MOVED_TO_SCRATCHPAD,
	TASKS_HEADING,
	TaskGroup,
	TaskList,
	addCarried,
	emptyGroup,
	newTask,
	parseTaskGroups,
	removeTaskBlock,
	serializeTaskGroups,
	takeOpenTasks,
	takeTaskBlock,
} from "./day";
import { joinFrontmatter, readSection, splitFrontmatter, writeSection } from "./markdown";

export const SCRATCHPAD_NOTES_HEADING = "Notes";

export interface Scratchpad {
	/** Always at least one group; groups[0] holds tasks that aren't in a card. */
	groups: TaskGroup[];
	notes: string;
}

export function emptyScratchpad(): Scratchpad {
	return { groups: [emptyGroup(null)], notes: "" };
}

export function parseScratchpad(text: string): Scratchpad {
	const { body } = splitFrontmatter(text);
	return {
		groups: parseTaskGroups(readSection(body, TASKS_HEADING) ?? ""),
		notes: readSection(body, SCRATCHPAD_NOTES_HEADING) ?? "",
	};
}

/** Writes Tasks and Notes into the note (a new one if `text` is ""), keeping everything else. */
export function applyScratchpad(text: string, pad: Scratchpad): string {
	const { frontmatter, body } = splitFrontmatter(text);
	let next = writeSection(body.trim() === "" ? "" : body, TASKS_HEADING, serializeTaskGroups(pad.groups), SCRATCHPAD_NOTES_HEADING);
	next = writeSection(next, SCRATCHPAD_NOTES_HEADING, pad.notes);
	if (frontmatter !== null && !next.startsWith("\n")) next = "\n" + next;
	return joinFrontmatter(frontmatter, next);
}

/** Quick add: a task at the end of the main (unnamed) card. */
export function addToScratchpad(pad: Scratchpad, text: string): void {
	const task = text.trim();
	if (task) addCarried(pad, [{ name: null, tasks: [newTask(task)] }]);
}

// ---- Moving tasks ----

/**
 * Scratchpad -> a day: takes a task and all its subtasks out of the
 * Scratchpad (nothing left behind), ready for addCarried on the day,
 * where it goes into the card with the same name.
 */
export function takeFromScratchpad(pad: Scratchpad, group: number, index: number): CarriedCard[] {
	return removeTaskBlock(pad, group, index);
}

/**
 * A day -> the Scratchpad: like carry-over, the task and its unfinished
 * subtasks move, and the day keeps them marked "[>] … (moved to Scratchpad)".
 */
export function sendTaskToScratchpad(day: TaskList, group: number, index: number, pad: Scratchpad): number {
	return addCarried(pad, takeTaskBlock(day, group, index, MOVED_TO_SCRATCHPAD));
}

/** Carry-over review: the picked unfinished tasks go to the Scratchpad instead of today. */
export function sendOpenTasksToScratchpad(day: TaskList, only: Map<string, string>, pad: Scratchpad): number {
	return addCarried(pad, takeOpenTasks(day, only, MOVED_TO_SCRATCHPAD));
}

/** Unfinished Scratchpad tasks (for the sidebar list and its count). */
export function scratchpadOpenCount(pad: Scratchpad): number {
	return pad.groups.reduce((n, g) => n + g.tasks.filter((t) => !t.done && !t.carried && t.text.trim() !== "").length, 0);
}
