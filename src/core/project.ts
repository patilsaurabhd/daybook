// Projects: work that spans many days. Each project is its own note:
//
//   Daybook/Projects/Website redesign.md
//   ---
//   status: active          (active | done)
//   started: 2026-11-09
//   finished: ""
//   colour: "#3e7bfa"
//   ---
//
//   ## Milestones
//
//   - [x] Wireframes
//   - [ ] Launch
//
//   ## Notes
//
// A day's task card belongs to a project when its heading links to it:
// "### [[Website redesign]]".

import { DateKey } from "./dates";
import { Task, parseTasks, serializeTasks } from "./day";
import {
	joinFrontmatter,
	readSection,
	readYamlString,
	setYamlKey,
	splitFrontmatter,
	writeSection,
	yamlStringLines,
} from "./markdown";

export type ProjectStatus = "active" | "done";

export interface Project {
	/** File name without ".md"; also the link text. */
	name: string;
	status: ProjectStatus;
	/** Start date, or "" if not set. */
	started: DateKey;
	/** Date it was finished, or "". */
	finished: DateKey;
	colour: string;
	milestones: Task[];
}

export const MILESTONES_HEADING = "Milestones";
export const PROJECT_NOTES_HEADING = "Notes";

export const PROJECT_COLOURS = ["#3e7bfa", "#30a46c", "#e5484d", "#f76b15", "#8e4ec6", "#12a594", "#d6409f", "#ab6400"];

export function parseProject(name: string, text: string): Project {
	const { frontmatter, body } = splitFrontmatter(text);
	const status = readYamlString(frontmatter, "status").toLowerCase();
	const date = (key: string) => {
		const v = readYamlString(frontmatter, key);
		return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
	};
	return {
		name,
		status: status === "done" || status === "finished" ? "done" : "active",
		started: date("started"),
		finished: date("finished"),
		colour: readYamlString(frontmatter, "colour") || readYamlString(frontmatter, "color") || PROJECT_COLOURS[0]!,
		milestones: parseTasks(readSection(body, MILESTONES_HEADING) ?? "").tasks,
	};
}

/** Writes status, dates, colour and milestones; the rest of the note is kept. */
export function applyProject(text: string, p: Project): string {
	let { frontmatter, body } = splitFrontmatter(text);
	frontmatter = setYamlKey(frontmatter, "status", yamlStringLines("status", p.status));
	frontmatter = setYamlKey(frontmatter, "started", yamlStringLines("started", p.started));
	frontmatter = setYamlKey(frontmatter, "finished", yamlStringLines("finished", p.finished));
	frontmatter = setYamlKey(frontmatter, "colour", yamlStringLines("colour", p.colour));
	const fresh = body.trim() === "";
	body = writeSection(fresh ? "" : body, MILESTONES_HEADING, serializeTasks(p.milestones), PROJECT_NOTES_HEADING);
	if (fresh) body = writeSection(body, PROJECT_NOTES_HEADING, "");
	if (!body.startsWith("\n")) body = "\n" + body;
	return joinFrontmatter(frontmatter, body);
}

export function newProject(name: string, started: DateKey, colour: string): Project {
	return { name, status: "active", started, finished: "", colour, milestones: [] };
}

/** A project shows on a day from its start until the day it was finished. */
export function isActiveOn(p: Project, date: DateKey): boolean {
	if (p.started && date < p.started) return false;
	if (p.status === "done") return p.finished !== "" && date <= p.finished;
	return true;
}

export function progress(p: Project): { done: number; total: number } {
	const real = p.milestones.filter((m) => m.text.trim() !== "");
	return { done: real.filter((m) => m.done).length, total: real.length };
}

/**
 * What a task-card heading links to. Three forms:
 *   [[Website]]                          the project's general card
 *   [[Website]] Design                   a named project card
 *   [[Website#^wireframes|Wireframes]]   the card for one milestone
 */
export interface CardLink {
	project: string;
	milestoneId: string | null;
	/** Text after the link ("Design"), or "". */
	title: string;
	alias: string | null;
}

const CARD_LINK_RE = /^\[\[([^\]|#^]+)(?:#\^([A-Za-z0-9-]+)|#[^\]|]*)?(?:\|([^\]]*))?\]\]\s*(.*)$/;

export function parseCardLink(cardName: string | null): CardLink | null {
	if (!cardName) return null;
	const m = CARD_LINK_RE.exec(cardName.trim());
	if (!m) return null;
	return { project: m[1]!.trim(), milestoneId: m[2] ?? null, alias: m[3]?.trim() ?? null, title: m[4]!.trim() };
}

/** If a card heading links to a note, that note's name. */
export function linkedProject(cardName: string | null): string | null {
	return parseCardLink(cardName)?.project ?? null;
}

/** Heading for a project card, optionally with its own title. */
export function projectCardName(project: string, title = ""): string {
	const t = title.replace(/\s+/g, " ").trim();
	return t ? `[[${project}]] ${t}` : `[[${project}]]`;
}

/** Heading for a milestone's card (block link, shown as the milestone text). */
export function milestoneCardName(project: string, id: string, text: string): string {
	const alias = text.replace(/[[\]|]/g, " ").replace(/\s+/g, " ").trim();
	return alias ? `[[${project}#^${id}|${alias}]]` : `[[${project}#^${id}]]`;
}

/** Kept for older callers: the plain project card heading. */
export function projectLink(name: string): string {
	return projectCardName(name);
}

/** Gives a milestone a block id (from its text) if it has none; returns the id. */
export function ensureMilestoneId(p: Project, index: number): string {
	const m = p.milestones[index]!;
	if (m.id) return m.id;
	const base =
		m.text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 24) || "milestone";
	const taken = new Set(p.milestones.map((x) => x.id).filter(Boolean));
	let id = base;
	for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
	m.id = id;
	return id;
}

export function findMilestone(p: Project, id: string): Task | null {
	return p.milestones.find((m) => m.id === id) ?? null;
}

/** For a milestone card: true when it has tasks and all are done; null if it has none. */
export function cardAllDone(tasks: Task[]): boolean | null {
	const real = tasks.filter((t) => t.text.trim() !== "" && !t.carried);
	if (real.length === 0) return null;
	return real.every((t) => t.done);
}

/** Makes a name safe to use as a file name and link. */
export function cleanProjectName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function sameName(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}
