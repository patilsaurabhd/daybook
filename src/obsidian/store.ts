// All vault reading/writing lives here, so the planner core never touches Obsidian.

import { App, TFile, TFolder, normalizePath } from "obsidian";
import { normaliseTags } from "../core/year";

export class VaultStore {
	/** Last text Daybook wrote per path, so we can ignore our own modify events. */
	private lastWritten = new Map<string, string>();

	constructor(private app: App) {}

	exists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
	}

	/** Returns the file's text, or null if it doesn't exist yet. */
	async read(path: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) return null;
		return this.app.vault.cachedRead(file);
	}

	/**
	 * Rewrites a file through `update(oldText)`. The file (and its folders)
	 * is created on first write. Uses vault.process so the read-modify-write
	 * is atomic with respect to other edits.
	 *
	 * With `{ fromElsewhere: true }` (a command or another view writing to a
	 * note that may be open), the change isn't treated as the open page's own
	 * save, so that page reloads and shows it.
	 */
	async write(path: string, update: (oldText: string) => string, opts: { fromElsewhere?: boolean } = {}): Promise<void> {
		const p = normalizePath(path);
		const remember = (text: string) => {
			if (opts.fromElsewhere) this.lastWritten.delete(p);
			else this.lastWritten.set(p, text);
		};
		const existing = this.app.vault.getAbstractFileByPath(p);
		if (existing instanceof TFile) {
			await this.app.vault.process(existing, (old) => {
				const next = update(old);
				remember(next);
				return next;
			});
			return;
		}
		const next = update("");
		await this.ensureFolder(p.split("/").slice(0, -1).join("/"));
		remember(next);
		await this.app.vault.create(p, next);
	}

	/** True if `text` is exactly what Daybook last wrote to `path`. */
	isOwnWrite(path: string, text: string): boolean {
		return this.lastWritten.get(normalizePath(path)) === text;
	}

	/**
	 * Saves an image (or any file) as an attachment of `notePath`, following
	 * the user's "Default location for new attachments" setting. Returns the
	 * Markdown embed to insert, e.g. "![[Pasted image 2026....png]]".
	 */
	async saveAttachment(name: string, data: ArrayBuffer, notePath: string): Promise<string> {
		const path = normalizePath(await this.app.fileManager.getAvailablePathForAttachment(name, notePath));
		await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
		const file = await this.app.vault.createBinary(path, data);
		return "!" + this.app.fileManager.generateMarkdownLink(file, notePath);
	}

	async ensureFolder(folder: string): Promise<void> {
		if (!folder) return;
		let current = "";
		for (const part of folder.split("/")) {
			current = current ? `${current}/${part}` : part;
			const found = this.app.vault.getAbstractFileByPath(current);
			if (found instanceof TFolder) continue;
			if (found) throw new Error(`Daybook: "${current}" exists but is not a folder.`);
			try {
				await this.app.vault.createFolder(current);
			} catch (e) {
				// Another write may have created it in the meantime.
				if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw e;
			}
		}
	}
}

/**
 * Tags of every day note in a year, from Obsidian's metadata index (no file
 * reads). Days without a note are absent from the map.
 */
export function yearDayTags(app: App, root: string, year: number, dayKeyOf: (path: string) => string | null): Map<string, string[]> {
	const prefix = normalizePath(`${root}/${year}`) + "/";
	const result = new Map<string, string[]>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(prefix)) continue;
		const key = dayKeyOf(file.path);
		if (!key) continue;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		result.set(key, normaliseTags(fm?.tags ?? fm?.tag));
	}
	return result;
}

/** The latest day note before `date` (any gap allowed), or null. */
export function lastDayBefore(app: App, date: string, dayKeyOf: (path: string) => string | null): { key: string; path: string } | null {
	let best: { key: string; path: string } | null = null;
	for (const file of app.vault.getMarkdownFiles()) {
		const key = dayKeyOf(file.path);
		if (key && key < date && (!best || key > best.key)) best = { key, path: file.path };
	}
	return best;
}
