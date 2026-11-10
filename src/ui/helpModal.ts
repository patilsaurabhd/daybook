// "How to use" command: a short guide to Daybook.

import { App, Modal } from "obsidian";

const SECTIONS: { title: string; lines: string[] }[] = [
	{
		title: "The calendar",
		lines: [
			"The calendar in the right sidebar opens any day, week (the numbers on the left), month or year (the title).",
			"The Daybook icon in the left ribbon opens today, with the calendar.",
		],
	},
	{
		title: "Four zoom levels",
		lines: [
			"Day: goals, tags, task cards, diary and notes.",
			"Week and month: a small card per day. Click one to edit its tasks in place, or the arrow to open the full day.",
			"Year: every day as a box, coloured by category. Pick a category in the legend to highlight it.",
			"Tasks | Both | Diary at the top switches what the page shows.",
		],
	},
	{
		title: "Task cards",
		lines: [
			"Type in a card to add tasks. Enter adds the next one, Tab nests it, Alt+↑/↓ moves it.",
			"Drag the grip to move a task between cards. The ⋯ menu moves it to another date or makes it recurring.",
			"+ Card adds a card; ⤢ expands one to fill the page.",
		],
	},
	{
		title: "Goals",
		lines: [
			"Each day, week, month and year has its own goals. The level above shows faintly at the top of the page.",
			"Week, month and year also have a reflection box.",
		],
	},
	{
		title: "Recurring tasks",
		lines: [
			"↻ in the Tasks header (or the \"Recurring tasks\" command) adds tasks that come back daily, weekly, monthly or yearly.",
			"They appear on the days they're due and are saved when you first edit that day.",
			"Unfinished tasks from the last day you wrote can be reviewed and carried over to today.",
		],
	},
	{
		title: "Events",
		lines: [
			"Drag across days in the year, month or week view (or use + Event) to add a trip or anything that spans days.",
			"Events can repeat every week, month or year, and show in every view.",
		],
	},
	{
		title: "Scratchpad",
		lines: [
			"Tasks and ideas that don't belong to a day yet. Add them from the Scratchpad section under the calendar, or the \"Quick add to scratchpad\" command.",
			"Open the full page with ↗ in that section (or \"Open scratchpad\") for task cards and free-text notes.",
		],
	},
	{
		title: "Focus mode",
		lines: ["Focus on a day page (or the \"Focus on today\" command) hides everything but today's open tasks and diary. Press Esc to leave."],
	},
	{
		title: "Your notes",
		lines: ["Everything is plain Markdown in the Daybook folder of your vault. Daybook only changes the sections it manages."],
	},
];

export class HelpModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Getting started");
		this.modalEl.addClass("daybook-help-modal");
		for (const section of SECTIONS) {
			this.contentEl.createEl("h4", { text: section.title });
			const list = this.contentEl.createEl("ul");
			for (const line of section.lines) list.createEl("li", { text: line });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
