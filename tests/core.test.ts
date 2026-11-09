// Tests for the portable planner core. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, addMonthsToKey, isoWeek, startOfWeek, weekIdFor, isDateKey } from "../src/core/dates";
import { dayPath, monthPath, weekPath, yearPath, dayKeyFromPath } from "../src/core/paths";
import { monthGrid } from "../src/core/calendar";
import { applyDay, emptyDay, moveTask, parseDay, parseTaskGroups, removeGroup, serializeTaskGroups, shiftDepth } from "../src/core/day";
import { listEnter, listIndent } from "../src/core/lists";

test("dates", () => {
	assert.equal(addDays("2026-12-31", 1), "2027-01-01");
	assert.equal(addDays("2026-03-01", -1), "2026-02-28");
	assert.equal(addMonthsToKey("2026-01-31", 1), "2026-02-28");
	assert.equal(startOfWeek("2026-11-09", 1), "2026-11-09"); // Monday
	assert.equal(startOfWeek("2026-11-09", 0), "2026-11-08"); // Sunday start
	assert.deepEqual(isoWeek("2026-11-09"), { year: 2026, week: 46 });
	assert.deepEqual(isoWeek("2027-01-01"), { year: 2026, week: 53 });
	assert.deepEqual(isoWeek("2024-12-30"), { year: 2025, week: 1 });
	// Sunday-start row Sun 8 Nov .. Sat 14 Nov is still week 46.
	assert.deepEqual(weekIdFor("2026-11-08", 0), { year: 2026, week: 46 });
	assert.equal(isDateKey("2026-02-30"), false);
});

test("paths", () => {
	assert.equal(dayPath("Daybook", "2026-11-09"), "Daybook/2026/11/2026-11-09.md");
	assert.equal(monthPath("Daybook", 2026, 11), "Daybook/2026/11/2026-11.md");
	assert.equal(yearPath("Daybook", 2026), "Daybook/2026/2026.md");
	assert.equal(weekPath("Daybook", { year: 2026, week: 46 }), "Daybook/2026/Weeks/2026-W46.md");
	assert.equal(dayPath("/Plans/Daybook/", "2026-01-02"), "Plans/Daybook/2026/01/2026-01-02.md");
	assert.equal(dayKeyFromPath("Daybook", "Daybook/2026/11/2026-11-09.md"), "2026-11-09");
	assert.equal(dayKeyFromPath("Daybook", "Other/2026-11-09.md"), null);
});

test("month grid", () => {
	const g = monthGrid(2026, 11, 1);
	assert.equal(g[0]!.days[0]!.key, "2026-10-26");
	assert.equal(g[0]!.week.week, 44);
	assert.ok(g.every((w) => w.days.length === 7));
	assert.equal(g[g.length - 1]!.days.some((d) => d.key === "2026-11-30"), true);
});

test("new day file layout", () => {
	const e = emptyDay();
	e.tags = ["work"];
	e.goals = "1. Ship stage one\n\t- week view\n2. Gym";
	e.groups[0]!.tasks = [
		{ done: false, text: "Write tests", depth: 0, children: [] },
		{ done: true, text: "Coffee", depth: 0, children: [] },
		{ done: false, text: "", depth: 0, children: [] },
	];
	e.diary = "A good day.";
	const text = applyDay("", e);
	assert.equal(
		text,
		[
			"---",
			"tags:",
			"  - work",
			"---",
			"",
			"## Goals",
			"",
			"1. Ship stage one",
			"\t- week view",
			"2. Gym",
			"",
			"## Tasks",
			"",
			"- [ ] Write tests",
			"- [x] Coffee",
			"",
			"## Diary",
			"",
			"A good day.",
			"",
		].join("\n"),
	);
	const back = parseDay(text);
	assert.deepEqual(back.tags, ["work"]);
	assert.equal(back.goals, "1. Ship stage one\n\t- week view\n2. Gym");
	assert.equal(back.groups[0]!.tasks.length, 2);
	assert.equal(back.groups[0]!.tasks[1]!.done, true);
	assert.equal(back.diary, "A good day.");
});

test("editing keeps the user's other content", () => {
	const original = [
		"---",
		"mood: 7",
		"tags: [work, \"#health\"]",
		"---",
		"# Monday",
		"",
		"Intro line",
		"",
		"## Tasks",
		"",
		"Some note before tasks",
		"- [ ] Parent",
		"    - [ ] Child",
		"- [X] Done one",
		"",
		"## Diary",
		"",
		"Old diary",
		"",
		"## Links",
		"",
		"- [[Something]]",
		"",
	].join("\n");
	const e = parseDay(original);
	assert.deepEqual(e.tags, ["work", "health"]);
	assert.equal(e.groups[0]!.tasks[1]!.text, "Child");
	assert.equal(e.groups[0]!.tasks[1]!.depth, 1);
	assert.deepEqual(e.groups[0]!.preamble, ["Some note before tasks"]);
	e.diary = "New diary";
	e.groups[0]!.tasks[0]!.done = true;
	const out = applyDay(original, e);
	assert.match(out, /mood: 7/);
	assert.match(out, /# Monday\n\nIntro line/);
	assert.match(out, /Some note before tasks\n- \[x\] Parent\n {4}- \[ \] Child\n- \[x\] Done one/);
	assert.match(out, /## Diary\n\nNew diary\n\n## Links\n\n- \[\[Something\]\]\n$/);
	// Round trip is stable.
	assert.equal(applyDay(out, parseDay(out)), out);
});

test("missing sections are appended", () => {
	const out = applyDay("Just a note\n", { ...emptyDay(), diary: "Hi" });
	assert.match(out, /^---\ntags: \[\]\n---\n\nJust a note\n\n## Goals\n\n## Tasks\n\n## Diary\n\nHi\n$/);
});

test("old goal property moves into a Goals section before Tasks", () => {
	const old = "---\ntags: []\ngoal: Ship it\n---\n\n## Tasks\n\n- [ ] a\n\n## Diary\n\nx\n";
	const e = parseDay(old);
	assert.equal(e.goals, "Ship it");
	const out = applyDay(old, e);
	assert.equal(out, "---\ntags: []\n---\n\n## Goals\n\nShip it\n\n## Tasks\n\n- [ ] a\n\n## Diary\n\nx\n");
});

test("list editing", () => {
	// Enter continues bullets and numbers
	let r = listEnter("- one", 5, 5)!;
	assert.equal(r.text, "- one\n- ");
	assert.equal(r.start, 8);
	r = listEnter("1. one\n2. two", 6, 6)!;
	assert.equal(r.text, "1. one\n2. \n3. two");
	r = listEnter("- [x] done", 10, 10)!;
	assert.equal(r.text, "- [x] done\n- [ ] ");
	// Enter on an empty item ends the list; nested empty item steps out
	assert.equal(listEnter("- one\n- ", 8, 8)!.text, "- one\n");
	assert.equal(listEnter("- one\n\t- ", 9, 9)!.text, "- one\n- ");
	// Not a list: leave it alone
	assert.equal(listEnter("plain", 5, 5), null);
	// Tab nests, numbered nested item restarts at 1; Shift+Tab undoes
	r = listIndent("1. a\n2. b", 9, 9, false)!;
	assert.equal(r.text, "1. a\n\t1. b");
	assert.equal(listIndent(r.text, 10, 10, true)!.text, "1. a\n1. b");
	assert.equal(listIndent("plain", 0, 0, false), null);
});

test("task cards (### groups)", () => {
	const section = "- [ ] loose\n\n### Work\n\n- [ ] a\n- [x] b\n\n### Home\n- [ ] c\n\n### Empty";
	const g = parseTaskGroups(section);
	assert.deepEqual(g.map((x) => x.name), [null, "Work", "Home", "Empty"]);
	assert.deepEqual(g[1]!.tasks.map((t) => t.text), ["a", "b"]);
	const out = serializeTaskGroups(g);
	assert.equal(out, "- [ ] loose\n\n### Work\n\n- [ ] a\n- [x] b\n\n### Home\n\n- [ ] c\n\n### Empty");
	assert.equal(serializeTaskGroups(parseTaskGroups(out)), out);

	// Move within a card (down) and across cards
	moveTask(g, { group: 1, index: 0 }, { group: 1, index: 2 });
	assert.deepEqual(g[1]!.tasks.map((t) => t.text), ["b", "a"]);
	moveTask(g, { group: 1, index: 1 }, { group: 2, index: 0 });
	assert.deepEqual(g[2]!.tasks.map((t) => t.text), ["a", "c"]);
	moveTask(g, { group: 0, index: 0 }, { group: 3, index: 99 });
	assert.deepEqual(g[3]!.tasks.map((t) => t.text), ["loose"]);

	// Removing a card keeps its tasks
	removeGroup(g, 2);
	assert.deepEqual(g.map((x) => x.name), [null, "Work", "Empty"]);
	assert.deepEqual(g[0]!.tasks.map((t) => t.text), ["a", "c"]);

	// Day file with cards round-trips
	const e = emptyDay();
	e.groups = parseTaskGroups("### Work\n\n- [ ] x");
	const text = applyDay("", e);
	assert.match(text, /## Tasks\n\n### Work\n\n- \[ \] x\n\n## Diary/);
	assert.equal(applyDay(text, parseDay(text)), text);
});

test("nested tasks", () => {
	const g = parseTaskGroups("- [ ] A\n    - [ ] A1\n        - [x] A1a\n    note under A1\n- [ ] B");
	const t = g[0]!.tasks;
	assert.deepEqual(t.map((x) => [x.text, x.depth]), [["A", 0], ["A1", 1], ["A1a", 2], ["B", 0]]);
	assert.deepEqual(t[2]!.children, ["    note under A1"]);
	// Written back with the note's own indent (4 spaces)
	assert.equal(serializeTaskGroups(g), "- [ ] A\n    - [ ] A1\n        - [x] A1a\n    note under A1\n- [ ] B");

	// Tab nests B under A (after A's subtasks it becomes depth 1)
	assert.equal(shiftDepth(t, 3, 1), true);
	assert.equal(t[3]!.depth, 1);
	assert.equal(shiftDepth(t, 0, 1), false); // first task can't nest
	// Shift+Tab on A1 takes A1a with it
	shiftDepth(t, 1, -1);
	assert.deepEqual(t.map((x) => x.depth), [0, 0, 1, 1]);

	// Dragging a parent moves its subtasks too
	const g2 = parseTaskGroups("- [ ] P\n\t- [ ] c1\n\t- [ ] c2\n- [ ] Q\n\n### Other\n\n- [ ] Z");
	moveTask(g2, { group: 0, index: 0 }, { group: 1, index: 1 });
	assert.deepEqual(g2[0]!.tasks.map((x) => x.text), ["Q"]);
	assert.deepEqual(g2[1]!.tasks.map((x) => [x.text, x.depth]), [["Z", 0], ["P", 0], ["c1", 1], ["c2", 1]]);
	// A subtask dropped at the top of a card becomes top level
	moveTask(g2, { group: 1, index: 3 }, { group: 0, index: 0 });
	assert.deepEqual(g2[0]!.tasks.map((x) => [x.text, x.depth]), [["c2", 0], ["Q", 0]]);
	// Can't drop a block inside itself
	const g3 = parseTaskGroups("- [ ] P\n\t- [ ] c");
	moveTask(g3, { group: 0, index: 0 }, { group: 0, index: 1 });
	assert.deepEqual(g3[0]!.tasks.map((x) => x.text), ["P", "c"]);
});

test("compact card summary", async () => {
	const { summarizeDay } = await import("../src/core/summary");
	const e = parseDay("---\ntags: [work, misc]\n---\n\n## Tasks\n\n- [ ] a\n\t- [x] a1\n\n### Home\n\n- [ ] b\n- [ ] c\n- [ ]\n\n## Diary\n\nhi\n");
	const cats = [
		{ name: "Work", color: "#00f", tag: "work" },
		{ name: "Rest", color: "#f00", tag: "rest" },
	];
	const s = summarizeDay(e, 3, cats);
	assert.deepEqual(s.rows.map((r) => [r.text, r.depth, r.pos.group, r.pos.index]), [["a", 0, 0, 0], ["a1", 1, 0, 1], ["b", 0, 1, 0]]);
	assert.equal(s.more, 1);
	assert.equal(s.open, 3);
	assert.equal(s.done, 1);
	assert.equal(s.hasDiary, true);
	assert.deepEqual(s.categories.map((c) => c.name), ["Work"]);
	assert.equal(summarizeDay(null, 3, cats).rows.length, 0);
});

test("week/month/year note", async () => {
	const { applyPeriod, parsePeriod } = await import("../src/core/period");
	const created = applyPeriod("", { goals: "1. Ship\n\t- tests", reflection: "" });
	assert.equal(created, "## Goals\n\n1. Ship\n\t- tests\n\n## Reflection\n");
	assert.deepEqual(parsePeriod(created), { goals: "1. Ship\n\t- tests", reflection: "" });
	// Existing note: goals go before Reflection, other content kept
	const existing = "---\nmood: ok\n---\n\nIntro\n\n## Reflection\n\nGood week\n";
	const e = parsePeriod(existing);
	assert.equal(e.reflection, "Good week");
	e.goals = "Run";
	assert.equal(applyPeriod(existing, e), "---\nmood: ok\n---\n\nIntro\n\n## Goals\n\nRun\n\n## Reflection\n\nGood week\n");
});

test("day notes scratchpad", () => {
	const plain = applyDay("", { ...emptyDay(), diary: "d" });
	assert.doesNotMatch(plain, /## Notes/); // not added until used
	const withNotes = applyDay(plain, { ...parseDay(plain), notes: "call Sam 555-0101" });
	assert.match(withNotes, /## Diary\n\nd\n\n## Notes\n\ncall Sam 555-0101\n$/);
	assert.equal(parseDay(withNotes).notes, "call Sam 555-0101");
	// Emptying it keeps the heading (it was there), and nothing else is touched
	assert.match(applyDay(withNotes, { ...parseDay(withNotes), notes: "" }), /## Diary\n\nd\n\n## Notes\n$/);
});

test("sketch svg round trip", async () => {
	const { sketchToSvg, sketchFromSvg, strokePath, bounds } = await import("../src/core/sketch");
	const sketch = {
		strokes: [
			{ color: "auto", width: 4, points: [[10, 10], [20, 15], [30, 10]] as [number, number][] },
			{ color: "#e5484d", width: 2, points: [[50, 40]] as [number, number][] },
		],
	};
	assert.equal(strokePath(sketch.strokes[0]!.points), "M10 10Q20 15 25 12.5L30 10");
	assert.deepEqual(bounds(sketch.strokes), { x: 8, y: 8, w: 43, h: 33 });
	const svg = sketchToSvg(sketch);
	assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="-4 -4 67 57" width="67" height="57">/);
	assert.match(svg, /<path class="ink" stroke-width="4" d="M10 10/);
	assert.match(svg, /<path stroke="#e5484d"/);
	assert.deepEqual(sketchFromSvg(svg), sketch);
	assert.equal(sketchFromSvg("<svg><path d='M0 0'/></svg>"), null);
});

test("projects", async () => {
	const P = await import("../src/core/project");
	const { projectPath } = await import("../src/core/paths");
	assert.equal(projectPath("Daybook", "Website"), "Daybook/Projects/Website.md");
	const p = P.newProject("Website", "2026-11-09", "#3e7bfa");
	p.milestones = [
		{ done: true, text: "Wireframes", depth: 0, children: [] },
		{ done: false, text: "Launch", depth: 0, children: [] },
	];
	const text = P.applyProject("", p);
	assert.equal(
		text,
		'---\nstatus: active\nstarted: 2026-11-09\nfinished: ""\ncolour: "#3e7bfa"\n---\n\n## Milestones\n\n- [x] Wireframes\n- [ ] Launch\n\n## Notes\n',
	);
	const back = P.parseProject("Website", text);
	assert.deepEqual(back, p);
	assert.deepEqual(P.progress(back), { done: 1, total: 2 });

	// Active from its start date until the day it's finished
	assert.equal(P.isActiveOn(back, "2026-11-08"), false);
	assert.equal(P.isActiveOn(back, "2026-12-01"), true);
	back.status = "done";
	back.finished = "2026-11-20";
	assert.equal(P.isActiveOn(back, "2026-11-20"), true);
	assert.equal(P.isActiveOn(back, "2026-11-21"), false);

	// Editing keeps the user's notes
	const edited = P.applyProject(text + "\nMy notes here\n", back);
	assert.match(edited, /status: done/);
	assert.match(edited, /## Notes\n\nMy notes here\n$/);

	assert.equal(P.linkedProject("[[Website]]"), "Website");
	assert.equal(P.linkedProject("[[Website|Site]]"), "Website");
	assert.equal(P.linkedProject("Work"), null);
	assert.equal(P.cleanProjectName(" App: v2 / launch "), "App v2 launch");
});

test("milestone cards and block ids", async () => {
	const P = await import("../src/core/project");
	assert.deepEqual(P.parseCardLink("[[Website]]"), { project: "Website", milestoneId: null, alias: null, title: "" });
	assert.deepEqual(P.parseCardLink("[[Website]] Design"), { project: "Website", milestoneId: null, alias: null, title: "Design" });
	assert.deepEqual(P.parseCardLink("[[Website#^wireframes|Wireframes]]"), { project: "Website", milestoneId: "wireframes", alias: "Wireframes", title: "" });
	assert.equal(P.parseCardLink("Work"), null);
	assert.equal(P.projectCardName("Website", " Design "), "[[Website]] Design");
	assert.equal(P.milestoneCardName("Website", "wireframes", "Wire|frames"), "[[Website#^wireframes|Wire frames]]");

	// Milestones keep block ids and nesting through a save
	const text = "---\nstatus: active\n---\n\n## Milestones\n\n- [ ] Design ^design\n\t- [ ] Wireframes\n- [ ] Design\n";
	const p = P.parseProject("Website", text);
	assert.equal(p.milestones[0]!.id, "design");
	assert.equal(p.milestones[0]!.text, "Design");
	assert.equal(p.milestones[1]!.depth, 1);
	assert.equal(P.ensureMilestoneId(p, 1), "wireframes");
	assert.equal(P.ensureMilestoneId(p, 2), "design-2");
	assert.match(P.applyProject(text, p), /- \[ \] Design \^design\n\t- \[ \] Wireframes \^wireframes\n- \[ \] Design \^design-2\n/);

	assert.equal(P.cardAllDone([]), null);
	assert.equal(P.cardAllDone([{ done: true, text: "a", depth: 0, children: [] }, { done: false, text: "", depth: 0, children: [] }]), true);
	assert.equal(P.cardAllDone([{ done: true, text: "a", depth: 0, children: [] }, { done: false, text: "b", depth: 0, children: [] }]), false);
});

test("year grid", async () => {
	const Y = await import("../src/core/year");
	const rows = Y.yearRows(2028);
	assert.equal(rows.length, 12);
	assert.equal(rows[1]!.days.length, 29); // leap year
	assert.equal(rows[11]!.days[30], "2028-12-31");
	assert.deepEqual(Y.normaliseTags(["#Work", "health"]), ["work", "health"]);
	assert.deepEqual(Y.normaliseTags("work, rest"), ["work", "rest"]);
	assert.deepEqual(Y.normaliseTags(null), []);
	const cats = [
		{ name: "Work", color: "#00f", tag: "work" },
		{ name: "Rest", color: "#f00", tag: "rest" },
	];
	assert.deepEqual(Y.categoriesFor(["rest", "work", "x"], cats).map((c) => c.name), ["Work", "Rest"]);
	const counts = Y.countByCategory(new Map([["2026-01-01", ["work"]], ["2026-01-02", ["work", "rest"]]]), cats);
	assert.deepEqual([...counts], [["work", 2], ["rest", 1]]);
	assert.equal(Y.boxFill([]), null);
	assert.equal(Y.boxFill(["#00f"]), "#00f");
	assert.equal(Y.boxFill(["#00f", "#f00"]), "linear-gradient(135deg, #00f 0% 50%, #f00 50% 100%)");
});

test("carry over unfinished tasks", async () => {
	const D = await import("../src/core/day");
	const yesterday = D.parseDay(
		"## Tasks\n\n- [ ] loose\n- [x] done\n\n### Work\n\n- [x] parent done\n\t- [ ] child open\n- [ ] report\n\t- [ ] draft\n\n### [[Website]]\n\n- [>] already moved\n- [ ] deploy\n",
	);
	const cards = D.takeOpenTasks(yesterday);
	assert.deepEqual(cards.map((c) => [c.name, c.tasks.map((t) => [t.text, t.depth])]), [
		[null, [["loose", 0]]],
		["Work", [["child open", 0], ["report", 0], ["draft", 1]]],
		["[[Website]]", [["deploy", 0]]],
	]);
	// Old day keeps the tasks, marked [>]
	const old = D.applyDay("", yesterday);
	assert.match(old, /- \[>\] loose\n- \[x\] done/);
	assert.match(old, /\t- \[>\] child open/);
	assert.equal(D.openTasks(D.parseDay(old)).length, 0);
	// Second carry finds nothing
	assert.equal(D.takeOpenTasks(D.parseDay(old)).length, 0);

	const today = D.parseDay("## Tasks\n\n### work\n\n- [ ] new today\n");
	assert.equal(D.addCarried(today, cards), 5);
	assert.deepEqual(today.groups.map((g) => g.name), [null, "work", "[[Website]]"]);
	assert.deepEqual(today.groups[1]!.tasks.map((t) => t.text), ["new today", "child open", "report", "draft"]);
});

test("first goal line", async () => {
	const { firstGoal } = await import("../src/core/period");
	assert.equal(firstGoal("\n1. **Ship** the [[Website|site]]\n2. Run"), "Ship the site");
	assert.equal(firstGoal("- [ ] Read ==more=="), "Read more");
	assert.equal(firstGoal(""), "");
});

test("selective carry over", async () => {
	const D = await import("../src/core/day");
	const day = D.parseDay("## Tasks\n\n- [ ] a\n- [ ] b\n\t- [ ] b1\n\n### Work\n\n- [x] done\n- [ ] c\n");
	const preview = D.listOpenTasks(day);
	assert.deepEqual(preview, [
		{ name: null, tasks: [{ key: "0:0", text: "a", depth: 0 }, { key: "0:1", text: "b", depth: 0 }, { key: "0:2", text: "b1", depth: 1 }] },
		{ name: "Work", tasks: [{ key: "1:1", text: "c", depth: 0 }] },
	]);
	// Pick "b1" (without its parent) and "c"; a stale pick is ignored.
	const cards = D.takeOpenTasks(day, new Map([["0:2", "b1"], ["1:1", "c"], ["0:0", "renamed"]]));
	assert.deepEqual(cards.map((c) => [c.name, c.tasks.map((t) => [t.text, t.depth])]), [
		[null, [["b1", 0]]],
		["Work", [["c", 0]]],
	]);
	assert.deepEqual(D.openTasks(day).map((t) => t.text), ["a", "b"]);
});

test("events", async () => {
	const E = await import("../src/core/event");
	const e = E.eventFromProps("Germany", { start: "2026-03-05", end: "2026-03-01", category: "#Travel" })!;
	assert.deepEqual(e, { name: "Germany", start: "2026-03-01", end: "2026-03-05", category: "travel" }); // order fixed
	assert.equal(E.eventFromProps("x", { start: "nope" }), null);
	assert.deepEqual(E.eventFromProps("One day", { start: "2026-06-10" }), { name: "One day", start: "2026-06-10", end: "2026-06-10", category: "" });
	assert.equal(E.lengthInDays(e), 5);
	assert.deepEqual(E.dayOf(e, "2026-03-02"), { day: 2, total: 5 });
	assert.equal(E.isOn(e, "2026-03-06"), false);
	const text = E.applyEvent("", e);
	assert.equal(text, "---\nstart: 2026-03-01\nend: 2026-03-05\ncategory: travel\n---\n\n## Notes\n");
	assert.deepEqual(E.parseEvent("Germany", text), e);
	assert.match(E.applyEvent(text + "\nBook train\n", { ...e, end: "2026-03-06" }), /end: 2026-03-06[\s\S]*Book train/);
	const usa = { name: "USA", start: "2026-02-27", end: "2026-03-02", category: "" };
	assert.deepEqual(E.eventsOn([e, usa], "2026-03-01").map((x) => x.name), ["USA", "Germany"]);
	assert.deepEqual(E.eventsOverlapping([e, usa], "2026-03-03", "2026-03-31").map((x) => x.name), ["Germany"]);
	assert.deepEqual(E.eventDates(usa, "2026-03-01", "2026-03-31"), ["2026-03-01", "2026-03-02"]);
	assert.equal(E.eventCategory(e, [{ name: "Travel", color: "#0af", tag: "travel" }])?.name, "Travel");
});

test("tag from category name", async () => {
	// categoryModal imports obsidian, so check the same rule inline.
	const tagFromName = (name: string) =>
		name.trim().toLowerCase().replace(/^#/, "").replace(/[^\p{L}\p{N}_/-]+/gu, "-").replace(/^-+|-+$/g, "");
	assert.equal(tagFromName("Road trips!"), "road-trips");
	assert.equal(tagFromName("#Birthday"), "birthday");
	assert.equal(tagFromName("Café"), "café");
});

test("recurring rules: reading and writing lines", async () => {
	const R = await import("../src/core/recurring");
	assert.deepEqual(R.parseRule("- Pay rent | monthly on 1"), { text: "Pay rent", freq: { kind: "monthly", day: 1 }, card: null, from: "", paused: false });
	assert.deepEqual(R.parseRule("- Team sync | weekly on Thu, mon | card: Work")!.freq, { kind: "weekly", days: [1, 4] });
	assert.equal(R.parseRule("- Team sync | weekly on Thu, mon | card: Work")!.card, "Work");
	assert.deepEqual(R.parseRule("- Backup | every 3 days | from: 2026-11-09 | paused"), {
		text: "Backup",
		freq: { kind: "every", n: 3, unit: "days" },
		card: null,
		from: "2026-11-09",
		paused: true,
	});
	assert.equal(R.parseRule("- Just a note"), null);
	assert.equal(R.parseRule("- Bad | monthly on 32"), null);
	for (const line of [
		"- Pay rent | monthly on 1",
		"- Water plants | weekly on sun",
		"- Passport renewal | yearly on 03-14",
		"- Stretch | daily | card: [[Health]] | from: 2026-11-09",
		"- Backup | every 2 weeks | from: 2026-11-09 | paused",
		"- Report | monthly on last",
		"- Standup | weekdays",
	]) {
		assert.equal(R.formatRule(R.parseRule(line)!), line);
	}
	// The note: only the Recurring section changes
	const note = R.applyRules("", [R.parseRule("- Stretch | daily")!]);
	assert.match(note, /## Recurring\n\n- Stretch \| daily\n$/);
	assert.deepEqual(R.parseRules(note).map((r) => r.text), ["Stretch"]);
	const edited = R.applyRules("My intro\n\n## Recurring\n\n- Old | daily\n\n## Ideas\n\nkeep me\n", [R.parseRule("- New | weekdays")!]);
	assert.equal(edited, "My intro\n\n## Recurring\n\n- New | weekdays\n\n## Ideas\n\nkeep me\n");
});

test("recurring rules: when they're due", async () => {
	const R = await import("../src/core/recurring");
	const rule = (line: string) => R.parseRule(line)!;
	// Month ends: the 31st falls back to the last day of shorter months
	const r31 = rule("- Rent | monthly on 31");
	assert.equal(R.isDue(r31, "2026-01-31"), true);
	assert.equal(R.isDue(r31, "2026-04-30"), true);
	assert.equal(R.isDue(r31, "2026-04-29"), false);
	assert.equal(R.isDue(r31, "2026-02-28"), true);
	assert.equal(R.isDue(r31, "2028-02-29"), true); // leap year
	assert.equal(R.isDue(r31, "2028-02-28"), false);
	assert.equal(R.isDue(rule("- Report | monthly on last"), "2026-11-30"), true);
	// 29 Feb: on 29 Feb in leap years, 28 Feb otherwise
	const leap = rule("- Birthday | yearly on 02-29");
	assert.equal(R.isDue(leap, "2028-02-29"), true);
	assert.equal(R.isDue(leap, "2028-02-28"), false);
	assert.equal(R.isDue(leap, "2027-02-28"), true);
	// Weekday names, independent of the first-day-of-week setting
	const weekly = rule("- Plants | weekly on sun, wed");
	assert.equal(R.isDue(weekly, "2026-11-08"), true); // Sunday
	assert.equal(R.isDue(weekly, "2026-11-11"), true); // Wednesday
	assert.equal(R.isDue(weekly, "2026-11-09"), false); // Monday
	assert.equal(R.isDue(rule("- Standup | weekdays"), "2026-11-14"), false); // Saturday
	// Every N, counted from "from"; nothing before "from"; paused never due
	const every = rule("- Backup | every 3 days | from: 2026-11-09");
	assert.deepEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-12"].map((d) => R.isDue(every, d)), [false, true, false, true]);
	assert.equal(R.isDue(rule("- X | every 2 weeks | from: 2026-11-09"), "2026-11-23"), true);
	assert.equal(R.isDue(rule("- X | daily | paused"), "2026-11-09"), false);
	assert.equal(R.nextDue(r31, "2026-11-09"), "2026-11-30");
	assert.equal(
		R.describe(r31, (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]!, (m) => String(m)),
		"Every month on the 31st (or the last day)",
	);
});

test("recurring rules: added to a day once", async () => {
	const R = await import("../src/core/recurring");
	const D = await import("../src/core/day");
	const rules = ["- Stretch | daily", "- Rent | monthly on 9 | card: Home", "- Gym | weekly on sat"].map((l) => R.parseRule(l)!);
	const day = D.parseDay("## Tasks\n\n- [>] Stretch\n");
	// "Stretch" is already there (carried over); "Gym" isn't due on a Monday
	assert.deepEqual(R.pendingRules(day, rules, "2026-11-09").map((r) => r.text), ["Rent"]);
	const fresh = D.emptyDay();
	R.addRuleTasks(fresh, R.pendingRules(fresh, rules, "2026-11-09"));
	assert.deepEqual(fresh.groups.map((g) => [g.name, g.tasks.map((t) => t.text)]), [[null, ["Stretch"]], ["Home", ["Rent"]]]);
	const text = D.applyDay("", fresh);
	assert.match(text, /^---\ntags: \[\]\nrecurring:\n  - stretch\n  - rent\n---/);
	// Once recorded, deleting the task doesn't bring it back
	const reread = D.parseDay(text);
	reread.groups = [D.emptyGroup(null)];
	assert.deepEqual(R.pendingRules(reread, rules, "2026-11-09"), []);
	// Days without recurring tasks get no "recurring" property
	assert.doesNotMatch(D.applyDay("", D.emptyDay()), /recurring/);
});

test("carrying doesn't duplicate a task that's already open today", async () => {
	const D = await import("../src/core/day");
	const today = D.parseDay("## Tasks\n\n- [ ] Stretch\n");
	const n = D.addCarried(today, [
		{
			name: null,
			tasks: [
				{ done: false, text: "stretch", depth: 0, children: [] },
				{ done: false, text: "warm up", depth: 1, children: [] },
				{ done: false, text: "Email", depth: 0, children: [] },
			],
		},
	]);
	assert.equal(n, 1);
	assert.deepEqual(today.groups[0]!.tasks.map((t) => [t.text, t.depth]), [["Stretch", 0], ["Email", 0]]);
});

test("repeating events", async () => {
	const E = await import("../src/core/event");
	assert.deepEqual(E.parseRepeat("every 2 weeks"), { unit: "week", n: 2 });
	assert.deepEqual(E.parseRepeat("Yearly"), { unit: "year", n: 1 });
	assert.equal(E.parseRepeat("sometimes"), null);
	assert.equal(E.formatRepeat({ unit: "month", n: 1 }), "monthly");
	assert.equal(E.formatRepeat({ unit: "week", n: 2 }), "every 2 weeks");

	// A 3-day yearly conference keeps its length
	const conf = E.eventFromProps("Conf", { start: "2026-03-30", end: "2026-04-01", repeats: "yearly" })!;
	assert.deepEqual(conf.repeats, { unit: "year", n: 1 });
	assert.deepEqual(
		E.occurrences(conf, "2026-01-01", "2028-12-31").map((o) => [o.start, o.end]),
		[["2026-03-30", "2026-04-01"], ["2027-03-30", "2027-04-01"], ["2028-03-30", "2028-04-01"]],
	);
	// An occurrence reaching into the range from before it counts
	assert.deepEqual(E.occurrences(conf, "2027-04-01", "2027-04-30").map((o) => o.start), ["2027-03-30"]);
	assert.deepEqual(E.occurrences(conf, "2027-04-01", "2027-04-01")[0]!.series, { start: "2026-03-30", end: "2026-04-01" });

	// 29 Feb birthdays fall on 28 Feb; the 31st falls back in short months
	const bday = E.eventFromProps("B", { start: "2028-02-29", repeats: "yearly" })!;
	assert.deepEqual(E.occurrences(bday, "2028-01-01", "2032-12-31").map((o) => o.start), ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
	const monthly = E.eventFromProps("M", { start: "2026-01-31", repeats: "monthly" })!;
	assert.deepEqual(E.occurrences(monthly, "2026-01-01", "2026-04-30").map((o) => o.start), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);

	// Every 2 weeks, until a date; nothing before the first one
	const fortnight = E.eventFromProps("F", { start: "2026-11-09", repeats: "every 2 weeks", until: "2026-12-07" })!;
	assert.deepEqual(E.occurrences(fortnight, "2026-01-01", "2027-12-31").map((o) => o.start), ["2026-11-09", "2026-11-23", "2026-12-07"]);

	// Written to and read back from the note; turning repeat off removes the keys
	const text = E.applyEvent("", fortnight);
	assert.match(text, /repeats: every 2 weeks\nuntil: 2026-12-07\n/);
	assert.deepEqual(E.parseEvent("F", text), fortnight);
	assert.doesNotMatch(E.applyEvent(text, { ...fortnight, repeats: null }), /repeats|until/);

	// One list for views, repeating ones expanded and sorted
	const once = E.eventFromProps("Trip", { start: "2026-11-20", end: "2026-11-22" })!;
	assert.deepEqual(E.expandEvents([fortnight, once], "2026-11-01", "2026-11-30").map((o) => `${o.name} ${o.start}`), ["F 2026-11-09", "Trip 2026-11-20", "F 2026-11-23"]);
});

test("move one task (with its open subtasks) to another day", async () => {
	const D = await import("../src/core/day");
	const from = D.parseDay("## Tasks\n\n- [ ] keep\n\n### Work\n\n- [ ] report\n\t- [x] outline\n\t- [ ] draft\n- [ ] email\n");
	const cards = D.takeTaskBlock(from, 1, 0);
	assert.deepEqual(cards.map((c) => [c.name, c.tasks.map((t) => [t.text, t.depth])]), [["Work", [["report", 0], ["draft", 1]]]]);
	// The source keeps them, marked [>]; done subtasks and other tasks stay as they were
	assert.match(D.applyDay("", from), /- \[>\] report\n\t- \[x\] outline\n\t- \[>\] draft\n- \[ \] email/);
	// Into the same card on the other day (created if needed)
	const to = D.emptyDay();
	D.addCarried(to, cards);
	assert.deepEqual(to.groups.map((g) => [g.name, g.tasks.map((t) => t.text)]), [[null, []], ["Work", ["report", "draft"]]]);
	// Done or already-moved tasks can't be moved
	assert.deepEqual(D.takeTaskBlock(from, 1, 0), []);
	assert.deepEqual(D.takeTaskBlock(from, 1, 1), []);
});

test("moved tasks remember where they went", async () => {
	const D = await import("../src/core/day");
	const day = D.parseDay("## Tasks\n\n- [ ] report ^r1\n\t- [ ] draft\n- [ ] email\n");
	D.takeTaskBlock(day, 0, 0, "2026-11-13");
	const text = D.applyDay("", day);
	assert.match(text, /- \[>\] report \(moved to \[\[2026-11-13\]\]\) \^r1\n\t- \[>\] draft \(moved to \[\[2026-11-13\]\]\)\n- \[ \] email/);
	const back = D.parseDay(text);
	assert.equal(back.groups[0]!.tasks[0]!.text, "report");
	assert.equal(back.groups[0]!.tasks[0]!.movedTo, "2026-11-13");
	assert.equal(back.groups[0]!.tasks[0]!.id, "r1");
	assert.equal(D.applyDay(text, back), text); // stable
	// Carry-over records it too
	const y = D.parseDay("## Tasks\n\n- [ ] a\n");
	D.takeOpenTasks(y, undefined, "2026-11-10");
	assert.match(D.applyDay("", y), /- \[>\] a \(moved to \[\[2026-11-10\]\]\)/);
	// Un-moving drops the note
	back.groups[0]!.tasks[0]!.carried = false;
	assert.match(D.applyDay("", back), /- \[ \] report \^r1\n/);
});
