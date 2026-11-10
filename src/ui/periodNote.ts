// The note behind a week, month or year: its Goals and Reflection boxes.
// Saves shortly after typing; the note is created on the first keystroke.

import { Component, Notice, debounce } from "obsidian";
import type DaybookPlugin from "../main";
import { PeriodEntry, applyPeriod, emptyPeriod, parsePeriod } from "../core/period";
import { MarkdownBox } from "./markdownBox";

const SAVE_DELAY_MS = 600;

interface Slot {
	field: keyof PeriodEntry;
	el: HTMLElement;
	title: string;
	placeholder: string;
	minRows: number;
	images: boolean;
	box: MarkdownBox | null;
}

export class PeriodNote extends Component {
	private entry: PeriodEntry = emptyPeriod();
	private dirty = false;
	private saving: Promise<void> = Promise.resolve();
	private slots: Slot[] = [];
	private readonly saveSoon = debounce(() => void this.flush(), SAVE_DELAY_MS, true);

	constructor(
		private plugin: DaybookPlugin,
		readonly path: string,
	) {
		super();
	}

	onunload(): void {
		this.saveSoon.cancel();
	}

	/** Reads the note. Call before adding boxes. */
	async read(): Promise<void> {
		const text = await this.plugin.store.read(this.path);
		this.entry = text === null ? emptyPeriod() : parsePeriod(text);
	}

	/** Adds an editable box for one section of the note. */
	addBox(parent: HTMLElement, field: keyof PeriodEntry, title: string, placeholder: string, opts: { minRows?: number; images?: boolean } = {}): void {
		const el = parent.createDiv({ cls: `daybook-period-${field}` });
		this.registerDomEvent(el, "focusout", () => void this.flush());
		const slot: Slot = { field, el, title, placeholder, minRows: opts.minRows ?? 1, images: opts.images ?? false, box: null };
		this.slots.push(slot);
		this.drawSlot(slot);
	}

	private drawSlot(slot: Slot): void {
		if (slot.box) this.removeChild(slot.box);
		slot.el.empty();
		slot.el.createDiv({ cls: "daybook-pane-title", text: slot.title });
		slot.box = this.addChild(
			new MarkdownBox(this.plugin.app, slot.el.createDiv(), {
				value: this.entry[slot.field],
				placeholder: slot.placeholder,
				label: slot.title,
				sourcePath: this.path,
				minRows: slot.minRows,
				onChange: (v) => {
					this.entry[slot.field] = v;
					this.dirty = true;
					this.saveSoon();
				},
				images: slot.images
					? {
							store: this.plugin.store,
							beforeSave: async () => {
								if (!this.plugin.store.exists(this.path)) this.dirty = true;
								await this.flush();
							},
						}
					: undefined,
			}),
		);
	}

	/** Reloads after an outside edit, unless the user is typing here. */
	async onFileChanged(path: string): Promise<void> {
		if (path !== this.path || this.dirty) return;
		const active = activeDocument.activeElement;
		if (active && this.slots.some((s) => s.el.contains(active))) return;
		const text = await this.plugin.store.read(path);
		if (text !== null && this.plugin.store.isOwnWrite(path, text, this)) return;
		await this.read();
		for (const slot of this.slots) this.drawSlot(slot);
	}

	async flush(): Promise<void> {
		this.saveSoon.cancel();
		if (!this.dirty) return this.saving;
		this.dirty = false;
		const snapshot = { ...this.entry };
		this.saving = this.saving
			.then(() =>
				this.plugin.store.write(this.path, (old) => {
					// Only replace the sections this note shows; keep the rest of the file.
					const current = parsePeriod(old);
					for (const slot of this.slots) current[slot.field] = snapshot[slot.field];
					return applyPeriod(old, current);
				}, { writer: this }),
			)
			.catch((e: unknown) => {
				console.error("Daybook: could not save", this.path, e);
				new Notice(`Daybook could not save ${this.path}.`);
			});
		return this.saving;
	}
}
