// List editing for plain text boxes: Enter continues a bullet or numbered
// list, Tab / Shift+Tab nest and un-nest items. Pure functions over
// (text, selection) so they work with any text box and can be tested.

export interface TextEdit {
	text: string;
	start: number; // selection start after the edit
	end: number; // selection end after the edit
}

// indent, marker ("-", "*", "+", "1.", "1)"), space, optional checkbox
const ITEM_RE = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/;

const INDENT = "\t";

function lineBounds(text: string, pos: number): [number, number] {
	const start = text.lastIndexOf("\n", pos - 1) + 1;
	const nl = text.indexOf("\n", pos);
	return [start, nl < 0 ? text.length : nl];
}

/** Handles Enter. Returns null when the caret isn't in a list item (let the box do its default). */
export function listEnter(text: string, start: number, end: number): TextEdit | null {
	if (start !== end) return null;
	const [ls, le] = lineBounds(text, start);
	const line = text.slice(ls, le);
	const m = ITEM_RE.exec(line);
	if (!m || start < ls + m[0].length) return null;

	const indent = m[1]!;
	// Empty item: end the list (or step out one level if nested).
	if (line.slice(m[0].length).trim() === "") {
		if (indent.length > 0) {
			const outdented = removeOneIndent(line);
			const t = text.slice(0, ls) + outdented + text.slice(le);
			const caret = ls + outdented.length;
			return { text: t, start: caret, end: caret };
		}
		const t = text.slice(0, ls) + text.slice(le);
		return { text: t, start: ls, end: ls };
	}

	const marker = m[3] !== undefined ? `${Number(m[3]) + 1}${m[4]}` : m[2]!;
	const checkbox = m[6] ? "[ ] " : "";
	const prefix = `\n${indent}${marker}${m[5]}${checkbox}`;
	const t = text.slice(0, start) + prefix + text.slice(end);
	const caret = start + prefix.length;
	return { text: renumberAfter(t, caret), start: caret, end: caret };
}

/** Handles Tab / Shift+Tab on list lines. Returns null if no selected line is a list item. */
export function listIndent(text: string, start: number, end: number, outdent: boolean): TextEdit | null {
	const [ls] = lineBounds(text, start);
	const [, le] = lineBounds(text, Math.max(start, end - (end > start && text[end - 1] === "\n" ? 1 : 0)));
	const lines = text.slice(ls, le).split("\n");
	if (!lines.some((l) => ITEM_RE.test(l))) return null;

	let delta0 = 0; // change in length on the first line (moves the selection start)
	let total = 0;
	const out = lines.map((l, i) => {
		if (!ITEM_RE.test(l)) return l;
		let next: string;
		if (outdent) {
			next = removeOneIndent(l);
		} else {
			// A numbered item that becomes nested starts its own list at 1.
			next = INDENT + l.replace(/^(\s*)\d+([.)])/, "$11$2");
		}
		const diff = next.length - l.length;
		if (i === 0) delta0 = diff;
		total += diff;
		return next;
	});
	const t = text.slice(0, ls) + out.join("\n") + text.slice(le);
	const newStart = Math.max(ls, start + delta0);
	const newEnd = start === end ? newStart : end + total;
	return { text: t, start: newStart, end: newEnd };
}

function removeOneIndent(line: string): string {
	if (line.startsWith("\t")) return line.slice(1);
	return line.replace(/^ {1,4}/, "");
}

/** After inserting a numbered item, bumps the numbers of the following siblings. */
function renumberAfter(text: string, caret: number): string {
	const [ls, le] = lineBounds(text, caret);
	const m = ITEM_RE.exec(text.slice(ls, le));
	if (!m || m[3] === undefined) return text;
	const indent = m[1]!;
	let n = Number(m[3]);
	const before = text.slice(0, le);
	const rest = text.slice(le).split("\n"); // rest[0] is "" (the newline itself)
	for (let i = 1; i < rest.length; i++) {
		const l = rest[i]!;
		const mm = ITEM_RE.exec(l);
		if (mm && mm[1] === indent && mm[3] !== undefined) {
			n++;
			rest[i] = l.replace(/^(\s*)\d+/, `$1${n}`);
		} else if (mm && mm[1]!.length > indent.length) {
			continue; // nested child, keep going
		} else if (l.startsWith(indent) && indent.length > 0 && /^\s/.test(l.slice(indent.length))) {
			continue; // continuation line
		} else {
			break;
		}
	}
	return before + rest.join("\n");
}
