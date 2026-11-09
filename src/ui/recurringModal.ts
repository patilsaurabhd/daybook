// Dialogs for recurring tasks: add/edit one rule, and a list to edit, pause,
// resume or delete rules. Nobody has to write rule lines by hand.

import { Modal, Notice, Setting, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { Weekday, formatDate, monthName, todayKey, weekdayName } from "../core/dates";
import { weekdayOrder } from "../core/calendar";
import { Frequency, Rule, describe, formatRule, nextDue } from "../core/recurring";
import { projectCardName } from "../core/project";

type Kind = Frequency["kind"];

const KINDS: { kind: Kind; label: string }[] = [
	{ kind: "daily", label: "Every day" },
	{ kind: "weekdays", label: "Every weekday (Mon–Fri)" },
	{ kind: "weekly", label: "Every week on…" },
	{ kind: "monthly", label: "Every month on…" },
	{ kind: "yearly", label: "Every year on…" },
	{ kind: "every", label: "Every few days or weeks" },
];

export function describeRule(r: Rule): string {
	const locale = moment.locale();
	return describe(r, (d) => weekdayName(d, locale, "short"), (m) => monthName(m, locale, "short"));
}

function nextLabel(r: Rule): string {
	if (r.paused) return "Paused";
	const next = nextDue(r, todayKey());
	if (!next) return "Not due in the next two years";
	return `Next: ${formatDate(next, { weekday: "short", day: "numeric", month: "short", year: next.slice(0, 4) === todayKey().slice(0, 4) ? undefined : "numeric" }, moment.locale())}`;
}

// ---- Add / edit one rule ----

export class RuleModal extends Modal {
	private rule: Rule;
	// Remember choices per kind so switching back and forth doesn't lose them.
	private weekly: Weekday[];
	private monthDay: number | "last" = 1;
	private yearMonth = 1;
	private yearDay = 1;
	private everyN = 2;
	private everyUnit: "days" | "weeks" = "days";
	private detailsEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private otherCardEl!: HTMLElement;

	constructor(
		private plugin: DaybookPlugin,
		initial: Rule | null,
		private onSubmit: (rule: Rule) => void,
	) {
		super(plugin.app);
		const today = todayKey();
		this.rule = initial ? structuredClone(initial) : { text: "", freq: { kind: "daily" }, card: null, from: today, paused: false };
		const [, m, d] = today.split("-").map(Number);
		this.weekly = [new Date().getDay() as Weekday];
		this.monthDay = d!;
		this.yearMonth = m!;
		this.yearDay = d!;
		const f = this.rule.freq;
		if (f.kind === "weekly") this.weekly = [...f.days];
		if (f.kind === "monthly") this.monthDay = f.day;
		if (f.kind === "yearly") [this.yearMonth, this.yearDay] = [f.month, f.day];
		if (f.kind === "every") [this.everyN, this.everyUnit] = [f.n, f.unit];
	}

	onOpen(): void {
		const editing = this.rule.text !== "";
		this.setTitle(editing ? "Edit recurring task" : "Add recurring task");
		const { contentEl } = this;
		this.modalEl.addClass("daybook-rule-modal");

		new Setting(contentEl).setName("Task").addText((t) => {
			t.setPlaceholder("Pay rent")
				.setValue(this.rule.text)
				.onChange((v) => {
					this.rule.text = v;
					this.updateSummary();
				});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});

		new Setting(contentEl).setName("Repeats").addDropdown((d) => {
			for (const k of KINDS) d.addOption(k.kind, k.label);
			d.setValue(this.rule.freq.kind).onChange((v) => {
				this.setKind(v as Kind);
				this.renderDetails();
			});
		});
		this.detailsEl = contentEl.createDiv({ cls: "daybook-rule-details" });
		this.renderDetails();

		this.renderCardChoice(contentEl);

		new Setting(contentEl)
			.setName("Starts on")
			.setDesc("Nothing appears before this day.")
			.addText((t) => {
				t.inputEl.type = "date";
				t.setValue(this.rule.from).onChange((v) => {
					this.rule.from = v;
					this.updateSummary();
				});
			});

		this.summaryEl = contentEl.createDiv({ cls: "daybook-rule-summary" });
		this.updateSummary();

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(editing ? "Save" : "Add")
					.setCta()
					.onClick(() => this.submit()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Builds the frequency from the current choices. */
	private setKind(kind: Kind): void {
		switch (kind) {
			case "daily":
			case "weekdays":
				this.rule.freq = { kind };
				break;
			case "weekly":
				this.rule.freq = { kind, days: [...this.weekly].sort() };
				break;
			case "monthly":
				this.rule.freq = { kind, day: this.monthDay };
				break;
			case "yearly":
				this.rule.freq = { kind, month: this.yearMonth, day: this.yearDay };
				break;
			case "every":
				this.rule.freq = { kind, n: this.everyN, unit: this.everyUnit };
				break;
		}
		this.updateSummary();
	}

	private renderDetails(): void {
		const el = this.detailsEl;
		el.empty();
		const kind = this.rule.freq.kind;
		const locale = moment.locale();

		if (kind === "weekly") {
			const row = el.createDiv({ cls: "daybook-rule-days" });
			for (const d of weekdayOrder(this.plugin.settings.firstDayOfWeek)) {
				const b = row.createEl("button", { cls: "daybook-filter-chip", text: weekdayName(d, locale, "short") });
				const sync = () => b.toggleClass("is-active", this.weekly.includes(d));
				sync();
				b.addEventListener("click", () => {
					this.weekly = this.weekly.includes(d) ? this.weekly.filter((x) => x !== d) : [...this.weekly, d];
					sync();
					this.setKind("weekly");
				});
			}
		} else if (kind === "monthly") {
			new Setting(el)
				.setName("Day of the month")
				.setDesc("Months without that day (like the 31st) use their last day.")
				.addDropdown((d) => {
					for (let i = 1; i <= 31; i++) d.addOption(String(i), String(i));
					d.addOption("last", "Last day");
					d.setValue(String(this.monthDay)).onChange((v) => {
						this.monthDay = v === "last" ? "last" : Number(v);
						this.setKind("monthly");
					});
				});
		} else if (kind === "yearly") {
			new Setting(el)
				.setName("Date")
				.setDesc("In years without a 29th of that month, the 28th is used.")
				.addDropdown((d) => {
					for (let m = 1; m <= 12; m++) d.addOption(String(m), monthName(m, locale));
					d.setValue(String(this.yearMonth)).onChange((v) => {
						this.yearMonth = Number(v);
						this.setKind("yearly");
					});
				})
				.addDropdown((d) => {
					for (let i = 1; i <= 31; i++) d.addOption(String(i), String(i));
					d.setValue(String(this.yearDay)).onChange((v) => {
						this.yearDay = Number(v);
						this.setKind("yearly");
					});
				});
		} else if (kind === "every") {
			new Setting(el)
				.setName("Every")
				.setDesc("Counted from the start date.")
				.addText((t) => {
					t.inputEl.type = "number";
					t.inputEl.min = "1";
					t.inputEl.addClass("daybook-rule-number");
					t.setValue(String(this.everyN)).onChange((v) => {
						this.everyN = Math.max(1, Math.floor(Number(v) || 1));
						this.setKind("every");
					});
				})
				.addDropdown((d) => {
					d.addOption("days", "Days");
					d.addOption("weeks", "Weeks");
					d.setValue(this.everyUnit).onChange((v) => {
						this.everyUnit = v as "days" | "weeks";
						this.setKind("every");
					});
				});
		}
	}

	/** Main card, a project's card, or another named card. */
	private renderCardChoice(contentEl: HTMLElement): void {
		const OTHER = "\u0001other";
		const current = this.rule.card;
		const setting = new Setting(contentEl).setName("Card").setDesc("Which task card it goes into on the day.");
		this.otherCardEl = contentEl.createDiv({ cls: "daybook-rule-other" });
		const showOther = (on: boolean) => {
			this.otherCardEl.empty();
			if (!on) return;
			new Setting(this.otherCardEl).setName("Card name").addText((t) => {
				t.setPlaceholder("Home")
					.setValue(current && !current.startsWith("[[") ? current : "")
					.onChange((v) => (this.rule.card = v.trim() || null));
			});
		};
		setting.addDropdown((d) => {
			d.addOption("", "Main card");
			void this.plugin.projects.all().then((projects) => {
				for (const p of projects) if (p.status === "active") d.addOption(projectCardName(p.name), `Project: ${p.name}`);
				d.addOption(OTHER, "Another card…");
				if (!current) d.setValue("");
				else if (current.startsWith("[[")) {
					if (!d.selectEl.querySelector(`option[value="${CSS.escape(current)}"]`)) d.addOption(current, current);
					d.setValue(current);
				} else {
					d.setValue(OTHER);
					showOther(true);
				}
			});
			d.onChange((v) => {
				if (v === OTHER) {
					this.rule.card = null;
					showOther(true);
				} else {
					this.rule.card = v || null;
					showOther(false);
				}
			});
		});
	}

	private updateSummary(): void {
		if (!this.summaryEl) return;
		this.summaryEl.setText(`${describeRule(this.rule)} · ${nextLabel(this.rule)}`);
	}

	private submit(): void {
		const r = this.rule;
		r.text = r.text.trim();
		if (!r.text) {
			new Notice("Write the task first.");
			return;
		}
		if (r.freq.kind === "weekly" && r.freq.days.length === 0) {
			new Notice("Pick at least one day of the week.");
			return;
		}
		if (r.freq.kind === "every" && !r.from) r.from = todayKey();
		this.close();
		this.onSubmit(r);
	}
}

// ---- The list of rules ----

export class RulesModal extends Modal {
	private listEl!: HTMLElement;

	constructor(private plugin: DaybookPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle("Recurring tasks");
		this.modalEl.addClass("daybook-rules-modal");
		const { contentEl } = this;
		contentEl.createDiv({
			cls: "daybook-carry-intro",
			text: "These appear as tasks on the days they're due, and are saved into the day when you first edit it.",
		});
		const add = contentEl.createEl("button", { cls: "mod-cta daybook-rules-add" });
		setIcon(add.createSpan({ cls: "daybook-layout-icon" }), "plus");
		add.createSpan({ text: "Add recurring task" });
		add.addEventListener("click", () => openAddRule(this.plugin, () => void this.refresh()));
		this.listEl = contentEl.createDiv({ cls: "daybook-rules-list" });
		void this.refresh();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async refresh(): Promise<void> {
		const rules = await this.plugin.recurring.rules();
		const el = this.listEl;
		el.empty();
		if (rules.length === 0) {
			el.createDiv({ cls: "daybook-year-hint", text: "No recurring tasks yet." });
			return;
		}
		for (const rule of rules) {
			const row = el.createDiv({ cls: "daybook-rule-row" });
			row.toggleClass("is-paused", rule.paused);
			const info = row.createDiv({ cls: "daybook-rule-info" });
			info.createDiv({ cls: "daybook-rule-text", text: rule.text });
			const bits = [describeRule(rule)];
			if (rule.card) bits.push(`in ${rule.card.replace(/^\[\[|\]\]$/g, "")}`);
			bits.push(nextLabel(rule));
			info.createDiv({ cls: "daybook-rule-meta", text: bits.join(" · ") });

			const tools = row.createDiv({ cls: "daybook-rule-tools" });
			const btn = (icon: string, label: string, onClick: () => void) => {
				const b = tools.createDiv({ cls: "clickable-icon", attr: { role: "button", tabindex: "0", "aria-label": label } });
				setIcon(b, icon);
				b.addEventListener("click", onClick);
				return b;
			};
			const line = formatRule(rule);
			btn("pencil", "Edit", () =>
				new RuleModal(this.plugin, rule, (edited) => void this.change(line, (rules, i) => rules.splice(i, 1, edited))).open(),
			);
			btn(rule.paused ? "play" : "pause", rule.paused ? "Resume" : "Pause", () =>
				void this.change(line, (rules, i) => (rules[i]!.paused = !rules[i]!.paused)),
			);
			const del = btn("trash", "Delete", () => {
				// Second click within a few seconds confirms.
				if (!del.hasClass("is-confirming")) {
					del.addClass("is-confirming");
					del.setAttr("aria-label", "Click again to delete");
					window.setTimeout(() => {
						del.removeClass("is-confirming");
						del.setAttr("aria-label", "Delete");
					}, 3000);
					return;
				}
				void this.change(line, (rules, i) => rules.splice(i, 1));
			});
		}
	}

	/** Applies a change to the rule that matches `line` (re-read, so edits elsewhere aren't lost). */
	private async change(line: string, update: (rules: Rule[], index: number) => void): Promise<void> {
		try {
			await this.plugin.recurring.change((rules) => {
				const i = rules.findIndex((r) => formatRule(r) === line);
				if (i >= 0) update(rules, i);
			});
		} catch (e) {
			console.error("Daybook: could not update recurring tasks", e);
			new Notice("Daybook could not update the recurring tasks.");
		}
		await this.refresh();
	}
}

/** "Add recurring task" dialog; saves the new rule. */
export function openAddRule(plugin: DaybookPlugin, after?: () => void): void {
	new RuleModal(plugin, null, (rule) => {
		void plugin.recurring
			.change((rules) => rules.push(rule))
			.then(() => {
				new Notice(`Added: ${rule.text} (${describeRule(rule).toLowerCase()}).`);
				after?.();
			})
			.catch((e: unknown) => {
				console.error("Daybook: could not add recurring task", e);
				new Notice("Daybook could not add the recurring task.");
			});
	}).open();
}
