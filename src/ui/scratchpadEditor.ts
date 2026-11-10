// Editing the Scratchpad: the same task cards as a day page (Enter, Tab,
// drag, ⋯ Move to date…), plus Notes on the full page. Used by the full
// page and, compactly, by the sidebar section under the calendar.
//
// Saves shortly after a change; reloads when Scratchpad.md changes elsewhere,
// but never while you're typing here or have unsaved changes.
// Daybook/Scratchpad.md is only created once something is written.

import { Component, Notice, TFile, debounce } from "obsidian";
import type DaybookPlugin from "../main";
import { Scratchpad, addToScratchpad, emptyScratchpad, scratchpadOpenCount } from "../core/scratchpad";
import { TaskBoard } from "./taskBoard";
import { MarkdownBox } from "./markdownBox";

const SAVE_DELAY_MS = 600;

export interface ScratchpadEditorOptions {
	/** Full page: Notes beside the tasks. Sidebar: tasks only. */
	notes: boolean;
	/** Told the number of open tasks whenever it may have changed. */
	onCount?: (open: number) => void;
}

export class ScratchpadEditor extends Component {
	private pad: Scratchpad = emptyScratchpad();
	private dirty = false;
	private saving: Promise<void> = Promise.resolve();
	private parts: (TaskBoard | MarkdownBox)[] = [];
	private seenVersion = -1;
	private readonly saveSoon = debounce(() => void this.flush(), SAVE_DELAY_MS, true);

	constructor(
		private plugin: DaybookPlugin,
		private host: HTMLElement,
		private opts: ScratchpadEditorOptions,
	) {
		super();
	}

	onload(): void {
		// Save when focus leaves the tasks or notes.
		this.registerDomEvent(this.host, "focusout", () => void this.flush());
		this.register(
			this.plugin.onChange(() => {
				if (this.plugin.scratchpadVersion !== this.seenVersion) void this.reloadFromDisk();
			}),
		);
		void this.readNote();
	}

	onunload(): void {
		this.saveSoon.cancel();
		void this.flush();
	}

	/** Quick add: a task at the end of the main card, saved straight away. */
	async quickAdd(text: string): Promise<void> {
		if (!text.trim()) return;
		await this.flush();
		addToScratchpad(this.pad, text);
		this.dirty = true;
		await this.flush();
		this.render();
	}

	private async readNote(): Promise<void> {
		this.seenVersion = this.plugin.scratchpadVersion;
		this.pad = await this.plugin.scratchpad.read();
		this.render();
	}

	private async reloadFromDisk(): Promise<void> {
		this.seenVersion = this.plugin.scratchpadVersion;
		if (this.dirty) return;
		const active = activeDocument.activeElement;
		if (active && this.host.contains(active)) return; // don't redraw under the cursor
		// Our own save: nothing new to show.
		const path = this.plugin.scratchpad.path();
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile && this.plugin.store.isOwnWrite(path, await this.plugin.app.vault.cachedRead(file), this)) return;
		await this.readNote();
	}

	private render(): void {
		for (const part of this.parts) this.removeChild(part);
		this.parts = [];
		const host = this.host;
		host.empty();
		this.opts.onCount?.(scratchpadOpenCount(this.pad));

		const boardMode = {
			scratchpad: true,
			moveOut: (group: number, index: number, text: string, date: string) => this.moveOut(group, index, text, date),
		};

		if (!this.opts.notes) {
			host.addClass("daybook-pad-board");
			this.parts.push(this.addChild(new TaskBoard(this.plugin, host, this.pad.groups, () => this.changed(), undefined, boardMode)));
			return;
		}

		const panes = host.createDiv({ cls: "daybook-panes" });
		const tasksPane = panes.createDiv({ cls: "daybook-pane daybook-pane-tasks" });
		this.parts.push(this.addChild(new TaskBoard(this.plugin, tasksPane, this.pad.groups, () => this.changed(), undefined, boardMode)));

		const notesPane = panes.createDiv({ cls: "daybook-pane daybook-pane-diary" });
		notesPane.createDiv({ cls: "daybook-pane-title", text: "Notes" });
		const notes = new MarkdownBox(this.plugin.app, notesPane.createDiv(), {
			value: this.pad.notes,
			placeholder: "Brainstorm here: ideas, links, plans… Paste or drop images too.",
			label: "Scratchpad notes",
			sourcePath: this.plugin.scratchpad.path(),
			minRows: 10,
			onChange: (v) => {
				this.pad.notes = v;
				this.changed();
			},
			images: {
				store: this.plugin.store,
				beforeSave: async () => {
					// The note must exist before an image is attached to it.
					if (!this.plugin.scratchpad.exists()) this.dirty = true;
					await this.flush();
				},
			},
		});
		this.parts.push(this.addChild(notes));
	}

	/** A task leaves for a day: save what's typed first, then move, then show the result. */
	private async moveOut(group: number, index: number, text: string, date: string): Promise<void> {
		await this.flush();
		await this.plugin.moveFromScratchpad(group, index, text, date);
		await this.readNote();
	}

	private changed(): void {
		this.dirty = true;
		this.opts.onCount?.(scratchpadOpenCount(this.pad));
		this.saveSoon();
	}

	/** Writes pending changes now. Only the parts this editor shows are replaced. */
	async flush(): Promise<void> {
		this.saveSoon.cancel();
		if (!this.dirty) return this.saving;
		this.dirty = false;
		const snapshot = structuredClone(this.pad);
		const withNotes = this.opts.notes;
		this.saving = this.saving
			.then(() =>
				this.plugin.scratchpad.change(
					(pad) => {
						pad.groups = snapshot.groups;
						if (withNotes) pad.notes = snapshot.notes;
					},
					{ writer: this }, // the sidebar and the full page each reload the other's saves
				),
			)
			.catch((e: unknown) => {
				console.error("Daybook: could not save the scratchpad", e);
				new Notice("Daybook could not save the scratchpad.");
			});
		return this.saving;
	}
}
