// Week, month and year notes: "## Goals" and "## Reflection".
//
//   ## Goals
//
//   1. Finish the week view
//   2. Three runs
//
//   ## Reflection
//
//   Free text...

import { joinFrontmatter, readSection, splitFrontmatter, writeSection } from "./markdown";
import { GOALS_HEADING } from "./day";

export const REFLECTION_HEADING = "Reflection";

export interface PeriodEntry {
	goals: string;
	reflection: string;
}

export function emptyPeriod(): PeriodEntry {
	return { goals: "", reflection: "" };
}

export function parsePeriod(text: string): PeriodEntry {
	const { body } = splitFrontmatter(text);
	return {
		goals: readSection(body, GOALS_HEADING) ?? "",
		reflection: readSection(body, REFLECTION_HEADING) ?? "",
	};
}

/** Writes the Goals and Reflection sections, leaving everything else as it is. */
export function applyPeriod(text: string, entry: PeriodEntry): string {
	const { frontmatter, body } = splitFrontmatter(text);
	let next = writeSection(body.trim() === "" ? "" : body, GOALS_HEADING, entry.goals, REFLECTION_HEADING);
	next = writeSection(next, REFLECTION_HEADING, entry.reflection);
	if (frontmatter !== null && !next.startsWith("\n")) next = "\n" + next;
	return joinFrontmatter(frontmatter, next);
}

/** The first goal in a goals section, as plain text ("1. **Ship** it" -> "Ship it"). */
export function firstGoal(goals: string): string {
	for (const line of goals.split("\n")) {
		const text = line
			.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
			.replace(/^\[[ xX>]\]\s+/, "")
			.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
			.replace(/\[\[([^\]]+)\]\]/g, "$1")
			.replace(/[*_`~=]/g, "")
			.trim();
		if (text) return text;
	}
	return "";
}
