// Creating, editing and deleting events, plus how an event looks in a view.

import { App, Menu, Modal, Notice, Setting, moment, setIcon } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, formatDate, isDateKey } from "../core/dates";
import { DayEvent, dayOf, eventCategory, orderRange } from "../core/event";
import { CategoryModal, addCategory } from "./categoryModal";

/** Colour for an event: its category's colour, or the accent colour. */
export function eventColour(plugin: DaybookPlugin, e: DayEvent): string {
	return eventCategory(e, plugin.settings.categories)?.color ?? "var(--interactive-accent)";
}

/** "1–5 Mar" style range label. */
export function eventRangeLabel(e: DayEvent): string {
	const locale = moment.locale();
	if (e.start === e.end) return formatDate(e.start, { day: "numeric", month: "short" }, locale);
	const sameMonth = e.start.slice(0, 7) === e.end.slice(0, 7);
	const a = formatDate(e.start, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" }, locale);
	return `${a}–${formatDate(e.end, { day: "numeric", month: "short" }, locale)}`;
}

// ---- Dialogs ----

const NEW_CATEGORY = "\u0001new";

interface EventFields {
	name: string;
	start: DateKey;
	end: DateKey;
	category: string;
}

class EventModal extends Modal {
	private fields: EventFields;

	constructor(
		private plugin: DaybookPlugin,
		initial: EventFields,
		private editing: boolean,
		private onSubmit: (f: EventFields) => void,
	) {
		super(plugin.app);
		this.fields = { ...initial };
	}

	onOpen(): void {
		this.setTitle(this.editing ? `Edit ${this.fields.name}` : "New event");
		const { contentEl } = this;

		if (!this.editing) {
			new Setting(contentEl).setName("Name").addText((t) => {
				t.setPlaceholder("Event name").onChange((v) => (this.fields.name = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.isComposing) {
						e.preventDefault();
						this.submit();
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		}
		new Setting(contentEl).setName("From").addText((t) => {
			t.inputEl.type = "date";
			t.setValue(this.fields.start).onChange((v) => (this.fields.start = v));
		});
		new Setting(contentEl).setName("To").addText((t) => {
			t.inputEl.type = "date";
			t.setValue(this.fields.end).onChange((v) => (this.fields.end = v));
		});
		new Setting(contentEl)
			.setName("Category")
			.setDesc("Colours the event, and counts its days in the year view.")
			.addDropdown((d) => {
				d.addOption("", "None");
				for (const c of this.plugin.settings.categories) if (c.tag) d.addOption(c.tag.toLowerCase(), c.name || c.tag);
				d.addOption(NEW_CATEGORY, "New category…");
				d.setValue(this.fields.category).onChange((v) => {
					if (v !== NEW_CATEGORY) {
						this.fields.category = v;
						return;
					}
					// Keep the old choice until the new category exists.
					d.setValue(this.fields.category);
					new CategoryModal(this.plugin, async (name, colour) => {
						const cat = await addCategory(this.plugin, name, colour);
						if (!cat) return;
						const tag = cat.tag.toLowerCase();
						d.selectEl.querySelector(`option[value="${NEW_CATEGORY}"]`)?.remove();
						if (!d.selectEl.querySelector(`option[value="${CSS.escape(tag)}"]`)) d.addOption(tag, cat.name || cat.tag);
						d.addOption(NEW_CATEGORY, "New category…");
						d.setValue(tag);
						this.fields.category = tag;
					}).open();
				});
			});
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.editing ? "Save" : "Create")
					.setCta()
					.onClick(() => this.submit()),
			);
	}

	private submit(): void {
		const f = this.fields;
		if (!this.editing && !f.name.trim()) {
			new Notice("Give the event a name.");
			return;
		}
		if (!isDateKey(f.start) || !isDateKey(f.end || f.start)) {
			new Notice("Pick a start and end date.");
			return;
		}
		const [start, end] = orderRange(f.start, f.end || f.start);
		this.close();
		this.onSubmit({ ...f, start, end });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class ConfirmModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private message: string,
		private action: string,
		private onYes: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.action)
					.setWarning()
					.onClick(() => {
						this.close();
						this.onYes();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** "New event" dialog, prefilled with a date range (e.g. from a drag). */
export function newEvent(plugin: DaybookPlugin, start: DateKey, end: DateKey): void {
	new EventModal(plugin, { name: "", start, end, category: "" }, false, (f) => {
		void (async () => {
			try {
				const name = await plugin.events.create(f.name, f.start, f.end, f.category);
				new Notice(`Added ${name} (${eventRangeLabel({ name, start: f.start, end: f.end, category: f.category })}).`);
			} catch (e) {
				console.error("Daybook: could not create event", e);
				new Notice("Daybook could not create the event.");
			}
		})();
	}).open();
}

/** Open note · Change dates or category · Delete. */
export function showEventMenu(plugin: DaybookPlugin, e: DayEvent, evt: MouseEvent): void {
	const menu = new Menu();
	menu.addItem((i) => i.setTitle("Open event note").setIcon("file-text").onClick(() => void plugin.events.open(e.name, false)));
	menu.addItem((i) =>
		i
			.setTitle("Change dates or category")
			.setIcon("calendar-range")
			.onClick(() =>
				new EventModal(plugin, { ...e }, true, (f) => {
					void plugin.events
						.update(e.name, (x) => {
							x.start = f.start;
							x.end = f.end;
							x.category = f.category;
						})
						.catch((err: unknown) => {
							console.error("Daybook: could not update event", err);
							new Notice("Daybook could not update the event.");
						});
				}).open(),
			),
	);
	menu.addItem((i) =>
		i
			.setTitle("Delete event")
			.setIcon("trash")
			.onClick(() =>
				new ConfirmModal(plugin.app, `Delete ${e.name}?`, "Its note moves to the trash. Day notes are not touched.", "Delete", () => {
					void plugin.events.remove(e.name).catch((err: unknown) => {
						console.error("Daybook: could not delete event", err);
						new Notice("Daybook could not delete the event.");
					});
				}).open(),
			),
	);
	menu.showAtMouseEvent(evt);
}

/**
 * A coloured event bar on a day card: the name on its first day (or the
 * first day shown), a plain continuing bar on the others.
 */
export function renderEventPill(plugin: DaybookPlugin, parent: HTMLElement, e: DayEvent, date: DateKey, showName: boolean): HTMLElement {
	const pill = parent.createDiv({ cls: "daybook-event-pill" });
	pill.setCssProps({ "--daybook-event": eventColour(plugin, e) });
	pill.toggleClass("is-start", date === e.start);
	pill.toggleClass("is-end", date === e.end);
	const { day, total } = dayOf(e, date);
	pill.setAttr("aria-label", `${e.name} · ${eventRangeLabel(e)}${total > 1 ? ` · day ${day} of ${total}` : ""}`);
	if (showName) pill.createSpan({ text: e.name });
	pill.addEventListener("click", (evt) => {
		evt.stopPropagation();
		showEventMenu(plugin, e, evt);
	});
	return pill;
}

/** Day page banner: "Germany · day 2 of 5". */
export function renderEventBanner(plugin: DaybookPlugin, parent: HTMLElement, e: DayEvent, date: DateKey): void {
	const b = parent.createDiv({ cls: "daybook-event-banner", attr: { role: "button", tabindex: "0" } });
	b.setCssProps({ "--daybook-event": eventColour(plugin, e) });
	setIcon(b.createSpan({ cls: "daybook-layout-icon" }), "calendar-range");
	b.createSpan({ cls: "daybook-event-name", text: e.name });
	const { day, total } = dayOf(e, date);
	b.createSpan({ cls: "daybook-event-when", text: total > 1 ? `day ${day} of ${total} · ${eventRangeLabel(e)}` : eventRangeLabel(e) });
	b.addEventListener("click", (evt) => showEventMenu(plugin, e, evt));
}
