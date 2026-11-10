// Reading and writing the Scratchpad note (Daybook/Scratchpad.md).

import { normalizePath } from "obsidian";
import { Scratchpad, applyScratchpad, emptyScratchpad, parseScratchpad, scratchpadOpenCount } from "../core/scratchpad";
import { scratchpadPath } from "../core/paths";
import { VaultStore } from "./store";

export class ScratchpadStore {
	constructor(
		private store: VaultStore,
		private root: () => string,
	) {}

	path(): string {
		return normalizePath(scratchpadPath(this.root()));
	}

	exists(): boolean {
		return this.store.exists(this.path());
	}

	/** The Scratchpad as it is now (empty if the note doesn't exist yet; nothing is created). */
	async read(): Promise<Scratchpad> {
		const text = await this.store.read(this.path());
		return text === null ? emptyScratchpad() : parseScratchpad(text);
	}

	/**
	 * Changes the Scratchpad: re-reads the note, applies `update`, writes it
	 * back. The note is only created once there's something in it.
	 * `fromElsewhere`: an open Scratchpad view should reload (see VaultStore.write).
	 */
	async change(update: (pad: Scratchpad) => void, opts: { fromElsewhere?: boolean; writer?: object } = {}): Promise<void> {
		if (!this.exists()) {
			const pad = emptyScratchpad();
			update(pad);
			if (scratchpadOpenCount(pad) === 0 && pad.groups.every((g) => g.tasks.length === 0) && pad.notes.trim() === "") return;
		}
		await this.store.write(
			this.path(),
			(old) => {
				const pad = old === "" ? emptyScratchpad() : parseScratchpad(old);
				update(pad);
				return applyScratchpad(old, pad);
			},
			opts,
		);
	}
}
