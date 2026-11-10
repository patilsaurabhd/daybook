// Reading and writing your habit list (Daybook/Habits.md), and reading which
// habits were ticked on given days from Obsidian's metadata index.

import { App, TFile, normalizePath } from "obsidian";
import { DateKey } from "../core/dates";
import { Habit, applyHabits, habitKey, parseHabits } from "../core/habit";
import { dayPath, habitsPath } from "../core/paths";
import { VaultStore } from "./store";

export class HabitStore {
	constructor(
		private app: App,
		private store: VaultStore,
		private root: () => string,
	) {}

	path(): string {
		return normalizePath(habitsPath(this.root()));
	}

	async list(): Promise<Habit[]> {
		const text = await this.store.read(this.path());
		return text === null ? [] : parseHabits(text);
	}

	/** Changes the list (the note is created with the first habit). */
	async change(update: (habits: Habit[]) => void): Promise<void> {
		await this.store.write(this.path(), (old) => {
			const habits = parseHabits(old);
			update(habits);
			return applyHabits(old, habits);
		});
	}

	/** Ticked habit keys per day, from the "habits" property (no files opened). */
	ticks(dates: DateKey[]): Map<DateKey, string[]> {
		const out = new Map<DateKey, string[]>();
		for (const date of dates) {
			const file = this.app.vault.getAbstractFileByPath(normalizePath(dayPath(this.root(), date)));
			if (!(file instanceof TFile)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const keys = habitKeys(fm?.habits);
			if (keys.length) out.set(date, keys);
		}
		return out;
	}
}

/** A "habits" property as keys: a list, or one comma-separated text. Names may contain spaces. */
function habitKeys(value: unknown): string[] {
	const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	return items.filter((v): v is string => typeof v === "string").map(habitKey).filter(Boolean);
}
