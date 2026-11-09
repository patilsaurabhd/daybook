// Event notes (Daybook/Events/*.md). Reading uses Obsidian's metadata index,
// so looking events up for a view never opens files.

import { App, TFile, normalizePath } from "obsidian";
import { DateKey } from "../core/dates";
import { DayEvent, applyEvent, eventFromProps, parseEvent } from "../core/event";
import { eventPath, eventsFolder } from "../core/paths";
import { cleanProjectName } from "../core/project";
import { VaultStore } from "./store";

export class EventStore {
	constructor(
		private app: App,
		private store: VaultStore,
		private root: () => string,
	) {}

	folder(): string {
		return normalizePath(eventsFolder(this.root()));
	}

	pathOf(name: string): string {
		return normalizePath(eventPath(this.root(), name));
	}

	isEventPath(path: string): boolean {
		const f = this.folder();
		return path.startsWith(f + "/") && path.endsWith(".md") && !path.slice(f.length + 1).includes("/");
	}

	private files(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter((f) => this.isEventPath(f.path));
	}

	/** All events with valid dates, from the metadata index. */
	all(): DayEvent[] {
		const out: DayEvent[] = [];
		for (const f of this.files()) {
			const e = eventFromProps(f.basename, this.app.metadataCache.getFileCache(f)?.frontmatter);
			if (e) out.push(e);
		}
		return out;
	}

	/** Creates an event note; a taken name gets " 2", " 3"… Returns the name used. */
	async create(rawName: string, start: DateKey, end: DateKey, category: string): Promise<string> {
		const base = cleanProjectName(rawName) || "Event";
		let name = base;
		for (let n = 2; this.store.exists(this.pathOf(name)); n++) name = `${base} ${n}`;
		await this.store.write(this.pathOf(name), (old) => applyEvent(old, { name, start, end, category }));
		return name;
	}

	async update(name: string, change: (e: DayEvent) => void): Promise<void> {
		await this.store.write(this.pathOf(name), (old) => {
			const e = parseEvent(name, old) ?? { name, start: "", end: "", category: "" };
			change(e);
			return applyEvent(old, e);
		});
	}

	/** Moves the note to the trash (following the user's "deleted files" setting). */
	async remove(name: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.pathOf(name));
		if (file instanceof TFile) await this.app.fileManager.trashFile(file);
	}

	async open(name: string, newTab: boolean): Promise<void> {
		await this.app.workspace.openLinkText(this.pathOf(name), "", newTab);
	}
}
