// The day note: a tags property, then "## Goals", "## Tasks" and "## Diary".
//
//   ---
//   tags:
//     - work
//   ---
//
//   ## Goals
//
//   1. Ship stage one
//      - week view
//
//   ## Tasks
//
//   - [ ] Tasks before any "###" heading are ungrouped
//
//   ### Work
//
//   - [ ] Write tests
//   - [x] Coffee
//
//   ## Diary
//
//   Free text...
//
//   ## Notes          (quick notes for the day; only added once something is written)
//
//   Quick notes...

import {
	joinFrontmatter,
	readSection,
	readYamlList,
	readYamlString,
	hasYamlKey,
	removeYamlKey,
	setYamlKey,
	splitFrontmatter,
	writeSection,
	yamlListLines,
} from "./markdown";

export const GOALS_HEADING = "Goals";
export const TASKS_HEADING = "Tasks";
export const DIARY_HEADING = "Diary";
export const NOTES_HEADING = "Notes";

export interface Task {
	done: boolean;
	text: string;
	/** Nesting level: 0 = top level, 1 = subtask, ... */
	depth: number;
	/** Non-task lines under this task (notes, plain bullets), kept verbatim. */
	children: string[];
	/** Obsidian block id ("^abc" at the end of the line), so the task can be linked to. */
	id?: string;
	/** Moved to a later day ("- [>] task"); not counted as open or done. */
	carried?: boolean;
	/**
	 * Where a moved task went: a date, written "(moved to [[2026-11-13]])",
	 * or MOVED_TO_SCRATCHPAD, written "(moved to Scratchpad)".
	 */
	movedTo?: string;
}

/** A task card: a "### Name" block inside Tasks. The first group (name null) holds ungrouped tasks. */
export interface TaskGroup {
	name: string | null;
	tasks: Task[];
	/** Non-task lines before the group's first task, kept verbatim. */
	preamble: string[];
	/** One level of indentation as written in the note ("\t" or spaces). */
	indent: string;
}

export interface DayEntry {
	tags: string[];
	/** Free Markdown (lists allowed). */
	goals: string;
	/** Always at least one group; groups[0] is the ungrouped one. */
	groups: TaskGroup[];
	diary: string;
	/** Quick notes for the day (the Notes box). */
	notes: string;
	/** Recurring rules already added to this day (property "recurring"), so they're never added twice. */
	recurring: string[];
	/** Habits done this day (property "habits"), as habit keys (lower-case names). */
	habits: string[];
	/** Habits added for this day only (property "habits-extra"), as typed. */
	habitsExtra: string[];
}

/** Anything with task cards: a day note, or the Scratchpad. */
export type TaskList = Pick<DayEntry, "groups">;

export function emptyGroup(name: string | null): TaskGroup {
	return { name, tasks: [], preamble: [], indent: "\t" };
}

export function emptyDay(): DayEntry {
	return { tags: [], goals: "", groups: [emptyGroup(null)], diary: "", notes: "", recurring: [], habits: [], habitsExtra: [] };
}

export function newTask(text: string, depth = 0): Task {
	return { done: false, text, depth, children: [] };
}

/** movedTo value for a task sent to the Scratchpad. */
export const MOVED_TO_SCRATCHPAD = "scratchpad";

/** "(moved to [[2026-11-13]])" or "(moved to Scratchpad)" at the end of a moved task. */
const MOVED_RE = /\s*\(moved to (?:\[\[(\d{4}-\d{2}-\d{2})(?:\|[^\]]*)?\]\]|(Scratchpad))\)$/;

const TASK_RE = /^([ \t]*)[-*+] \[([ xX>])\](?: (.*))?$/;

/** The indentation unit a note uses for nested tasks (tab, or the smallest space indent). */
function detectIndent(lines: string[]): string {
	let spaces = Infinity;
	for (const line of lines) {
		const ws = TASK_RE.exec(line)?.[1];
		if (!ws) continue;
		if (ws.startsWith("\t")) return "\t";
		spaces = Math.min(spaces, ws.length);
	}
	return spaces === Infinity ? "\t" : " ".repeat(Math.max(2, spaces));
}

function depthOf(ws: string, indent: string): number {
	const tabs = (ws.match(/\t/g) ?? []).length;
	const spaces = ws.length - tabs;
	const unit = indent === "\t" ? 4 : indent.length;
	return tabs + Math.floor(spaces / unit);
}

export function parseTasks(section: string): { tasks: Task[]; preamble: string[]; indent: string } {
	const lines = section.split("\n");
	const indent = detectIndent(lines);
	const tasks: Task[] = [];
	const preamble: string[] = [];
	for (const line of lines) {
		const m = TASK_RE.exec(line);
		if (m) {
			const prev = tasks[tasks.length - 1];
			// Keep nesting valid: never deeper than one level below the task above.
			const depth = Math.min(depthOf(m[1]!, indent), prev ? prev.depth + 1 : 0);
			const raw = (m[3] ?? "").trim();
			const idMatch = /(?:^|\s)\^([A-Za-z0-9-]+)$/.exec(raw);
			let text = idMatch ? raw.slice(0, idMatch.index).trim() : raw;
			const movedMatch = MOVED_RE.exec(text);
			if (movedMatch) text = text.slice(0, movedMatch.index).trim();
			const mark = m[2]!;
			const task: Task = { done: mark === "x" || mark === "X", text, depth, children: [] };
			if (mark === ">") task.carried = true;
			if (movedMatch) task.movedTo = movedMatch[1] ?? MOVED_TO_SCRATCHPAD;
			if (idMatch) task.id = idMatch[1]!;
			tasks.push(task);
		} else if (tasks.length > 0) {
			tasks[tasks.length - 1]!.children.push(line);
		} else if (line.trim() !== "") {
			preamble.push(line);
		}
	}
	// Blank lines directly after a task are spacing, not content.
	for (const t of tasks) {
		while (t.children.length && t.children[t.children.length - 1]!.trim() === "") t.children.pop();
	}
	return { tasks, preamble, indent };
}

export function serializeTasks(tasks: Task[], preamble: string[] = [], indent = "\t"): string {
	const lines = [...preamble];
	for (const t of tasks) {
		const text = t.text.replace(/\s*\n\s*/g, " ").trim();
		if (text === "" && t.children.length === 0) continue; // drop empty rows
		const id = t.id ? ` ^${t.id}` : "";
		const moved = !t.carried || !t.movedTo ? "" : t.movedTo === MOVED_TO_SCRATCHPAD ? " (moved to Scratchpad)" : ` (moved to [[${t.movedTo}]])`;
		const mark = t.carried ? ">" : t.done ? "x" : " ";
		lines.push(`${indent.repeat(t.depth)}- [${mark}] ${text}${moved}${id}`.trimEnd());
		lines.push(...t.children);
	}
	return lines.join("\n");
}

const GROUP_RE = /^###\s+(.*?)\s*#*\s*$/;
const UNTITLED = "Untitled";

/** Splits the Tasks section into groups at "###" headings. */
export function parseTaskGroups(section: string): TaskGroup[] {
	const chunks: { name: string | null; lines: string[] }[] = [{ name: null, lines: [] }];
	for (const line of section.split("\n")) {
		const m = GROUP_RE.exec(line);
		if (m) chunks.push({ name: m[1]!.trim(), lines: [] });
		else chunks[chunks.length - 1]!.lines.push(line);
	}
	return chunks.map((c) => {
		const { tasks, preamble, indent } = parseTasks(c.lines.join("\n"));
		return { name: c.name, tasks, preamble, indent };
	});
}

export function serializeTaskGroups(groups: TaskGroup[]): string {
	const blocks: string[] = [];
	for (const g of groups) {
		const body = serializeTasks(g.tasks, g.preamble, g.indent);
		if (g.name === null) {
			if (body) blocks.push(body);
		} else {
			const name = g.name.replace(/\s+/g, " ").trim() || UNTITLED;
			blocks.push(body ? `### ${name}\n\n${body}` : `### ${name}`);
		}
	}
	return blocks.join("\n\n");
}

export interface TaskPos {
	group: number;
	index: number;
}

/** Index just past task i and all its subtasks. */
export function blockEnd(tasks: Task[], i: number): number {
	const depth = tasks[i]?.depth ?? 0;
	let j = i + 1;
	while (j < tasks.length && tasks[j]!.depth > depth) j++;
	return j;
}

/**
 * Moves a task together with its subtasks. `to.index` is the insert position
 * in the target group as it looks *before* the move ("drop above row 3" is 3).
 * The moved block is re-levelled to fit where it lands.
 */
export function moveTask(groups: TaskGroup[], from: TaskPos, to: TaskPos): TaskPos {
	const src = groups[from.group];
	const dst = groups[to.group];
	if (!src || !dst || !src.tasks[from.index]) return from;
	const end = blockEnd(src.tasks, from.index);
	const count = end - from.index;
	let index = Math.max(0, Math.min(to.index, dst.tasks.length));
	if (from.group === to.group) {
		if (index > from.index && index < end) return from; // inside itself
		if (index >= end) index -= count;
	}
	const block = src.tasks.splice(from.index, count);
	const prev = dst.tasks[index - 1];
	const next = dst.tasks[index];
	let top = prev ? Math.min(block[0]!.depth, prev.depth + 1) : 0;
	if (next && next.depth > top) top = next.depth; // don't orphan the task below
	const shift = top - block[0]!.depth;
	for (const t of block) t.depth += shift;
	dst.tasks.splice(index, 0, ...block);
	return { group: to.group, index };
}

/** Tab / Shift+Tab: nest or un-nest a task with its subtasks. Returns false if not possible. */
export function shiftDepth(tasks: Task[], i: number, delta: 1 | -1): boolean {
	const t = tasks[i];
	if (!t) return false;
	if (delta === 1 && (i === 0 || t.depth > tasks[i - 1]!.depth)) return false;
	if (delta === -1 && t.depth === 0) return false;
	const end = blockEnd(tasks, i);
	for (let k = i; k < end; k++) tasks[k]!.depth += delta;
	return true;
}

/** Removes a card; its tasks move to the end of the ungrouped card. */
export function removeGroup(groups: TaskGroup[], index: number): void {
	if (index <= 0 || index >= groups.length) return;
	const [g] = groups.splice(index, 1);
	groups[0]!.tasks.push(...g!.tasks);
	groups[0]!.preamble.push(...g!.preamble);
}

export function allTasks(entry: TaskList): Task[] {
	return entry.groups.flatMap((g) => g.tasks);
}

function cleanTag(tag: string): string {
	return tag.trim().replace(/^#/, "").replace(/\s+/g, "-");
}

export function parseDay(text: string): DayEntry {
	const { frontmatter, body } = splitFrontmatter(text);
	const groups = parseTaskGroups(readSection(body, TASKS_HEADING) ?? "");
	return {
		tags: readYamlList(frontmatter, "tags").map(cleanTag).filter(Boolean),
		// Older notes kept a one-line `goal` property; read it if there's no Goals section.
		goals: readSection(body, GOALS_HEADING) ?? readYamlString(frontmatter, "goal"),
		groups,
		diary: readSection(body, DIARY_HEADING) ?? "",
		notes: readSection(body, NOTES_HEADING) ?? "",
		recurring: readYamlList(frontmatter, "recurring"),
		habits: readYamlList(frontmatter, "habits").map((h) => h.trim().toLowerCase()),
		habitsExtra: readYamlList(frontmatter, "habits-extra"),
	};
}

/**
 * Writes `entry` into an existing note's text (or a new one if `text` is "").
 * Only the tags property and the Goals/Tasks/Diary sections are replaced;
 * everything else in the file is left untouched.
 */
export function applyDay(text: string, entry: DayEntry): string {
	let { frontmatter, body } = splitFrontmatter(text);
	frontmatter = setYamlKey(frontmatter, "tags", yamlListLines("tags", entry.tags.map(cleanTag).filter(Boolean)));
	frontmatter = removeYamlKey(frontmatter, "goal"); // moved into the Goals section
	// Only written once a recurring task has been added to this day.
	if (entry.recurring.length || hasYamlKey(frontmatter, "recurring")) {
		frontmatter = setYamlKey(frontmatter, "recurring", yamlListLines("recurring", [...new Set(entry.recurring)]));
	}
	// Habit ticks: only written once a habit has been ticked (or the key exists).
	if (entry.habits.length || hasYamlKey(frontmatter, "habits")) {
		frontmatter = setYamlKey(frontmatter, "habits", yamlListLines("habits", [...new Set(entry.habits)]));
	}
	if (entry.habitsExtra.length || hasYamlKey(frontmatter, "habits-extra")) {
		frontmatter = setYamlKey(frontmatter, "habits-extra", yamlListLines("habits-extra", [...new Set(entry.habitsExtra)]));
	}
	if (body.trim() === "") body = "";
	body = writeSection(body, GOALS_HEADING, entry.goals, TASKS_HEADING);
	body = writeSection(body, TASKS_HEADING, serializeTaskGroups(entry.groups));
	body = writeSection(body, DIARY_HEADING, entry.diary);
	// Notes is optional: only written once used (or if the note already has it).
	if (entry.notes.trim() !== "" || readSection(body, NOTES_HEADING) !== null) {
		body = writeSection(body, NOTES_HEADING, entry.notes);
	}
	if (!body.startsWith("\n")) body = "\n" + body; // blank line after the properties
	return joinFrontmatter(frontmatter, body);
}

/** Not done, not moved to another day, and not an empty row. */
export function isOpen(t: Task): boolean {
	return !t.done && !t.carried && t.text.trim() !== "";
}

export function openTasks(entry: TaskList): Task[] {
	return allTasks(entry).filter(isOpen);
}

// ---- Carrying unfinished tasks to a later day ----

/** Open tasks taken from one card, ready to add to the same card on another day. */
export interface CarriedCard {
	/** Card heading (null = ungrouped). Project and milestone cards keep their link. */
	name: string | null;
	tasks: Task[];
}

/** Key for one task in a day ("group:index"), used to pick tasks to carry. */
export function taskKey(group: number, index: number): string {
	return `${group}:${index}`;
}

/** Unfinished tasks of a day, card by card, for a "what would move" preview. */
export interface OpenCard {
	name: string | null;
	tasks: { key: string; text: string; depth: number }[];
}

export function listOpenTasks(entry: TaskList): OpenCard[] {
	const out: OpenCard[] = [];
	entry.groups.forEach((group, gi) => {
		const tasks = group.tasks.flatMap((t, ti) => (isOpen(t) ? [{ key: taskKey(gi, ti), text: t.text, depth: t.depth }] : []));
		if (tasks.length) out.push({ name: group.name, tasks });
	});
	return out;
}

/**
 * Takes open tasks out of a day: they're returned (nesting kept) and marked
 * "carried" ([>]) in `entry`. With `only`, just those tasks (by taskKey, and
 * only if their text still matches) are taken; the rest stay open.
 */
export function takeOpenTasks(entry: TaskList, only?: Map<string, string>, movedTo?: string): CarriedCard[] {
	const out: CarriedCard[] = [];
	for (const [gi, group] of entry.groups.entries()) {
		const moved: Task[] = [];
		for (const [ti, t] of group.tasks.entries()) {
			if (!isOpen(t)) continue;
			if (only && only.get(taskKey(gi, ti)) !== t.text) continue;
			moved.push({ done: false, text: t.text, depth: t.depth, children: [...t.children] });
			t.carried = true;
			if (movedTo) t.movedTo = movedTo;
		}
		if (moved.length === 0) continue;
		// Re-level: a subtask whose parent stayed behind moves up.
		let prev = -1;
		for (const t of moved) {
			t.depth = Math.min(t.depth, prev + 1);
			prev = t.depth;
		}
		out.push({ name: group.name, tasks: moved });
	}
	return out;
}

/**
 * Takes a task and all its subtasks (done or not) out of a list entirely,
 * with no [>] left behind. Used when a task leaves the Scratchpad.
 */
export function removeTaskBlock(list: TaskList, group: number, index: number): CarriedCard[] {
	const g = list.groups[group];
	const task = g?.tasks[index];
	if (!g || !task) return [];
	const block = g.tasks.splice(index, blockEnd(g.tasks, index) - index);
	const shift = block[0]!.depth;
	return [
		{
			name: g.name,
			// Leaving keeps done/undone and block ids, but not any old "moved" mark.
			tasks: block.map(({ carried: _c, movedTo: _m, ...t }) => ({ ...t, depth: t.depth - shift, children: [...t.children] })),
		},
	];
}

/**
 * "Move to date": takes one task and its unfinished subtasks out of a day
 * (marked [>], like carry-over), ready to add to another day's same card.
 */
export function takeTaskBlock(entry: TaskList, group: number, index: number, movedTo?: string): CarriedCard[] {
	const tasks = entry.groups[group]?.tasks;
	const task = tasks?.[index];
	if (!tasks || !task || !isOpen(task)) return [];
	const only = new Map<string, string>();
	for (let i = index; i < blockEnd(tasks, index); i++) only.set(taskKey(group, i), tasks[i]!.text);
	return takeOpenTasks(entry, only, movedTo);
}

/**
 * Adds carried tasks to the matching cards (by heading), creating cards as
 * needed. A task that's already open in the day (same text, e.g. today's
 * recurring "Stretch") isn't added a second time.
 */
export function addCarried(entry: TaskList, cards: CarriedCard[]): number {
	let count = 0;
	const open = new Set(allTasks(entry).filter(isOpen).map((t) => t.text.trim().toLowerCase()));
	for (const card of cards) {
		// Skip a duplicate top-level task together with its subtasks.
		const tasks: Task[] = [];
		let skipping = false;
		for (const t of card.tasks) {
			if (t.depth === 0) skipping = open.has(t.text.trim().toLowerCase());
			if (!skipping) tasks.push(t);
		}
		if (tasks.length === 0) continue;
		let group =
			card.name === null
				? entry.groups[0]!
				: entry.groups.find((g) => g.name !== null && g.name.trim().toLowerCase() === card.name!.trim().toLowerCase());
		if (!group) {
			group = emptyGroup(card.name);
			entry.groups.push(group);
		}
		// Drop trailing empty rows so the carried tasks follow real ones.
		while (group.tasks.length && group.tasks[group.tasks.length - 1]!.text.trim() === "") group.tasks.pop();
		group.tasks.push(...tasks);
		count += tasks.length;
	}
	return count;
}
