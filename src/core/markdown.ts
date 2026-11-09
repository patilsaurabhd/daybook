// Minimal Markdown helpers: frontmatter properties and "## Heading" sections.
//
// Everything here edits text surgically: it only touches the keys and
// sections it is asked to, so anything else the user wrote in the file
// (other properties, other headings, notes) is kept as-is.

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface Split {
	frontmatter: string | null; // text between the --- lines, or null if none
	body: string;
}

export function splitFrontmatter(text: string): Split {
	const m = FM_RE.exec(text);
	if (!m) return { frontmatter: null, body: text };
	return { frontmatter: m[1] ?? "", body: text.slice(m[0].length) };
}

export function joinFrontmatter(frontmatter: string | null, body: string): string {
	if (frontmatter === null) return body;
	const fm = frontmatter.replace(/\s+$/, "");
	return `---\n${fm}${fm ? "\n" : ""}---\n${body}`;
}

// ---- YAML (only the small subset Daybook writes and reads) ----

function unquote(raw: string): string {
	const v = raw.trim();
	if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
		try {
			return JSON.parse(v) as string;
		} catch {
			return v.slice(1, -1);
		}
	}
	if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
		return v.slice(1, -1).replace(/''/g, "'");
	}
	// Strip a trailing comment on plain scalars.
	return v.replace(/\s+#.*$/, "");
}

/** Quotes a string for YAML only when it has to. */
export function yamlString(value: string): string {
	if (value === "") return '""';
	const plainSafe =
		/^[^\s\-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
		!/:\s|\s#|:$|\s$/.test(value) &&
		!/^(true|false|yes|no|on|off|null|~|[-+]?\d[\d._]*(e[-+]?\d+)?)$/i.test(value) &&
		!/[\n\r\t]/.test(value);
	return plainSafe ? value : JSON.stringify(value);
}

/** Finds the line range [start, end) a top-level key occupies, including indented children. */
function keyRange(lines: string[], key: string): [number, number] | null {
	const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
	const start = lines.findIndex((l) => re.test(l));
	if (start < 0) return null;
	let end = start + 1;
	while (end < lines.length) {
		const l = lines[end]!;
		if (l.trim() === "" || /^\s/.test(l) || /^-\s/.test(l)) end++;
		else break;
	}
	// Don't swallow trailing blank lines.
	while (end > start + 1 && lines[end - 1]!.trim() === "") end--;
	return [start, end];
}

/** Reads a top-level key as a string ("" if missing). */
export function readYamlString(frontmatter: string | null, key: string): string {
	if (frontmatter === null) return "";
	const lines = frontmatter.split(/\r?\n/);
	const range = keyRange(lines, key);
	if (!range) return "";
	const first = lines[range[0]]!;
	const value = first.slice(first.indexOf(":") + 1);
	return unquote(value);
}

/** Reads a top-level key as a list. Accepts `- a` lists, `[a, b]` and `a, b`. */
export function readYamlList(frontmatter: string | null, key: string): string[] {
	if (frontmatter === null) return [];
	const lines = frontmatter.split(/\r?\n/);
	const range = keyRange(lines, key);
	if (!range) return [];
	const first = lines[range[0]]!;
	const inline = first.slice(first.indexOf(":") + 1).trim();
	let items: string[];
	if (inline.startsWith("[")) {
		items = inline.replace(/^\[|\]$/g, "").split(",");
	} else if (inline) {
		items = inline.split(",");
	} else {
		items = lines
			.slice(range[0] + 1, range[1])
			.map((l) => /^\s*-\s+(.*)$/.exec(l)?.[1])
			.filter((v): v is string => v !== undefined);
	}
	return items.map(unquote).map((s) => s.trim()).filter((s) => s !== "");
}

/** Sets (or adds) a top-level key, replacing its old value lines. */
export function setYamlKey(frontmatter: string | null, key: string, valueLines: string[]): string {
	const lines = frontmatter === null || frontmatter === "" ? [] : frontmatter.split(/\r?\n/);
	const range = keyRange(lines, key);
	if (range) lines.splice(range[0], range[1] - range[0], ...valueLines);
	else lines.push(...valueLines);
	return lines.join("\n");
}

/** Removes a top-level key and its value lines. */
export function removeYamlKey(frontmatter: string | null, key: string): string | null {
	if (frontmatter === null) return null;
	const lines = frontmatter.split(/\r?\n/);
	const range = keyRange(lines, key);
	if (!range) return frontmatter;
	lines.splice(range[0], range[1] - range[0]);
	return lines.join("\n");
}

export function yamlStringLines(key: string, value: string): string[] {
	return [`${key}: ${yamlString(value)}`];
}

export function yamlListLines(key: string, values: string[]): string[] {
	if (values.length === 0) return [`${key}: []`];
	return [`${key}:`, ...values.map((v) => `  - ${yamlString(v)}`)];
}

// ---- Sections ----

interface SectionRange {
	headingLine: number;
	start: number; // first content line
	end: number; // exclusive
}

function findSection(lines: string[], heading: string): SectionRange | null {
	const want = heading.trim().toLowerCase();
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (/^(```|~~~)/.test(line)) inFence = !inFence;
		if (inFence) continue;
		const m = /^##\s+(.*?)\s*#*\s*$/.exec(line);
		if (m && m[1]!.toLowerCase() === want) {
			let end = i + 1;
			let fence = false;
			while (end < lines.length) {
				const l = lines[end]!;
				if (/^(```|~~~)/.test(l)) fence = !fence;
				if (!fence && /^#{1,2}\s/.test(l)) break;
				end++;
			}
			return { headingLine: i, start: i + 1, end };
		}
	}
	return null;
}

/** Returns the section's content without surrounding blank lines, or null if absent. */
export function readSection(body: string, heading: string): string | null {
	const lines = body.split(/\r?\n/);
	const r = findSection(lines, heading);
	if (!r) return null;
	return trimBlankLines(lines.slice(r.start, r.end)).join("\n");
}

/**
 * Replaces a section's content. If the section is missing it is inserted
 * just before the `before` section (when given and present), otherwise
 * appended at the end.
 */
export function writeSection(body: string, heading: string, content: string, before?: string): string {
	const lines = body.split(/\r?\n/);
	const r = findSection(lines, heading);
	const contentLines = content.trim() === "" ? [] : content.replace(/\s+$/, "").split("\n");
	const block = ["", ...contentLines, ...(contentLines.length ? [""] : [])];
	if (r) {
		const hasNext = r.end < lines.length;
		const replacement = hasNext ? block : trimTrailingBlank(block);
		lines.splice(r.start, r.end - r.start, ...replacement);
		return ensureTrailingNewline(lines.join("\n"));
	}
	const next = before ? findSection(lines, before) : null;
	if (next) {
		const insert = [`## ${heading}`, ...(contentLines.length ? block : [""])];
		lines.splice(next.headingLine, 0, ...insert);
		return ensureTrailingNewline(lines.join("\n"));
	}
	const base = trimTrailingBlank(lines);
	const out = [...base, ...(base.length ? [""] : []), `## ${heading}`, ...trimTrailingBlank(block)];
	return ensureTrailingNewline(out.join("\n"));
}

function trimBlankLines(lines: string[]): string[] {
	let s = 0;
	let e = lines.length;
	while (s < e && lines[s]!.trim() === "") s++;
	while (e > s && lines[e - 1]!.trim() === "") e--;
	return lines.slice(s, e);
}

function trimTrailingBlank(lines: string[]): string[] {
	let e = lines.length;
	while (e > 0 && lines[e - 1]!.trim() === "") e--;
	return lines.slice(0, e);
}

function ensureTrailingNewline(text: string): string {
	return text.endsWith("\n") ? text : text + "\n";
}
