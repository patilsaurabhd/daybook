// Reading and writing the recurring-task rules (Daybook/Recurring.md).

import { normalizePath } from "obsidian";
import { Rule, applyRules, parseRules } from "../core/recurring";
import { recurringPath } from "../core/paths";
import { VaultStore } from "./store";

export class RecurringStore {
	constructor(
		private store: VaultStore,
		private root: () => string,
	) {}

	path(): string {
		return normalizePath(recurringPath(this.root()));
	}

	async rules(): Promise<Rule[]> {
		const text = await this.store.read(this.path());
		return text === null ? [] : parseRules(text);
	}

	/** Rewrites the rule list (the note is created with the first rule). */
	async change(update: (rules: Rule[]) => void): Promise<void> {
		await this.store.write(this.path(), (old) => {
			const rules = parseRules(old);
			update(rules);
			return applyRules(old, rules);
		});
	}
}
