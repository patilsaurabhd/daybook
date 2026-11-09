// Week and month levels: grids of compact day cards. Clicking a card opens
// the day out in place for quick task editing; ↗ goes to the day page.

import { Component, debounce, moment } from "obsidian";
import type DaybookPlugin from "../main";
import { DateKey, parseKey, weekDays, weekdayName } from "../core/dates";
import { monthGrid, weekdayOrder } from "../core/calendar";
import { CompactDayCard } from "./compactCard";
import { DayPopover } from "./dayPopover";
import { orderRange } from "../core/event";
import { newEvent } from "./eventActions";

/** Shared by the week and month boards: cards, the opened-out day, live updates. */
abstract class CompactBoard extends Component {
	protected cards = new Map<string, CompactDayCard>();
	/** Element the opened-out day floats in. */
	protected host!: HTMLElement;
	private popover: DayPopover | null = null;

	constructor(
		protected plugin: DaybookPlugin,
		protected containerEl: HTMLElement,
		protected date: DateKey,
		protected openPage: (date: DateKey) => void,
	) {
		super();
	}

	abstract draw(): Promise<void>;

	protected addCard(parent: HTMLElement, day: DateKey, maxRows: number): CompactDayCard {
		const card = new CompactDayCard(this.plugin, parent, day, {
			maxRows,
			showWeekday: true,
			onOpen: (c) => this.openOut(c),
			onOpenPage: this.openPage,
		});
		this.cards.set(card.path, card);
		return card;
	}

	protected async refreshAll(): Promise<void> {
		await Promise.all([...this.cards.values()].map((c) => c.refresh()));
		this.wireRangeDrag();
	}

	/**
	 * Mouse/pen: press on a day card and drag onto another to add an event
	 * across those days. A press without moving to another card is a normal click.
	 */
	private wireRangeDrag(): void {
		if (this.dragWired) return;
		this.dragWired = true;
		const host = this.host;
		let from: string | null = null;
		let to: string | null = null;
		let pointer = -1;
		let dragging = false;
		const cardAt = (x: number, y: number) => activeDocument.elementFromPoint(x, y)?.closest<HTMLElement>(".daybook-mini[data-date]") ?? null;
		const paint = () => {
			const [a, b] = from && to ? orderRange(from, to) : ["", ""];
			for (const c of this.cards.values()) c.el.toggleClass("is-selecting", dragging && c.date >= a && c.date <= b);
		};
		this.registerDomEvent(host, "pointerdown", (e) => {
			if (e.pointerType === "touch" || e.button !== 0) return;
			const t = e.target as HTMLElement;
			if (t.closest("input, button, .clickable-icon, .daybook-event-pill, .daybook-popover")) return;
			from = t.closest<HTMLElement>(".daybook-mini[data-date]")?.getAttr("data-date") ?? null;
			to = from;
			pointer = e.pointerId;
			dragging = false;
		});
		this.registerDomEvent(host, "pointermove", (e) => {
			if (!from || e.pointerId !== pointer) return;
			const date = cardAt(e.clientX, e.clientY)?.getAttr("data-date") ?? null;
			if (!date || date === to) return;
			to = date;
			if (!dragging) {
				dragging = true;
				host.addClass("is-range-dragging");
				host.setPointerCapture(pointer);
			}
			paint();
		});
		const end = (e: PointerEvent, cancel: boolean) => {
			if (e.pointerId !== pointer) return;
			const wasDragging = dragging;
			const a0 = from;
			const b0 = to;
			from = to = null;
			pointer = -1;
			dragging = false;
			host.removeClass("is-range-dragging");
			if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
			paint();
			if (!wasDragging || cancel || !a0 || !b0) return;
			// Swallow the click that follows the drag.
			const card = this.cards.get([...this.cards.keys()].find((k) => this.cards.get(k)!.date === b0) ?? "");
			card?.el.addClass("is-drag-end");
			window.setTimeout(() => card?.el.removeClass("is-drag-end"), 0);
			const [a, b] = orderRange(a0, b0);
			newEvent(this.plugin, a, b);
		};
		this.registerDomEvent(host, "pointerup", (e) => end(e, false));
		this.registerDomEvent(host, "pointercancel", (e) => end(e, true));
	}

	private dragWired = false;

	private openOut(card: CompactDayCard): void {
		if (this.popover?.date === card.date) return;
		this.closePopover();
		const popover = new DayPopover(this.plugin, this.host, card.el, card.date, {
			onOpenPage: this.openPage,
			onClose: () => {
				if (this.popover === popover) this.closePopover();
			},
		});
		this.popover = popover;
		this.addChild(popover);
	}

	private closePopover(): void {
		const popover = this.popover;
		if (!popover) return;
		this.popover = null;
		this.removeChild(popover); // saves any pending edits
		void this.cards.get(popover.path)?.refresh();
	}

	/** Redraws a card when its note changes (here or elsewhere). */
	onFileChanged(path: string): void {
		void this.cards.get(path)?.refresh();
	}
}

/** Seven compact day cards. */
export class WeekBoard extends CompactBoard {
	async draw(): Promise<void> {
		this.host = this.containerEl.createDiv({ cls: "daybook-week" });
		for (const day of weekDays(this.date, this.plugin.settings.firstDayOfWeek)) this.addCard(this.host, day, 6);
		await this.refreshAll();
		// Taller cards (e.g. with the sidebars closed) list more tasks.
		window.requestAnimationFrame(() => void this.fitRows());
		const refit = debounce(() => void this.fitRows(), 250, true);
		this.registerDomEvent(window, "resize", refit);
	}

	/** Shows as many task rows as the cards have room for (6 at least). */
	private async fitRows(): Promise<void> {
		const card = this.cards.values().next().value;
		if (!card) return;
		const height = card.el.clientHeight;
		const rows = Math.max(6, Math.min(30, Math.floor((height - 64) / 20)));
		let changed = false;
		for (const c of this.cards.values()) changed = c.setMaxRows(rows) || changed;
		if (changed) await Promise.all([...this.cards.values()].map((c) => c.refresh()));
	}
}

/**
 * A month as a calendar: weekday columns, a week-number column, and blank
 * cells before the 1st and after the last day. On narrow screens it becomes
 * a plain list of days (CSS).
 */
export class MonthBoard extends CompactBoard {
	constructor(
		plugin: DaybookPlugin,
		containerEl: HTMLElement,
		date: DateKey,
		openPage: (date: DateKey) => void,
		private openWeek: (date: DateKey) => void,
	) {
		super(plugin, containerEl, date, openPage);
	}

	async draw(): Promise<void> {
		const { year, month } = parseKey(this.date);
		const firstDay = this.plugin.settings.firstDayOfWeek;
		const locale = moment.locale();
		this.host = this.containerEl.createDiv({ cls: "daybook-month" });

		this.host.createDiv({ cls: "daybook-month-head daybook-month-weekcol", text: "W" });
		for (const wd of weekdayOrder(firstDay)) {
			this.host.createDiv({ cls: "daybook-month-head", text: weekdayName(wd, locale, "short") });
		}

		for (const row of monthGrid(year, month, firstDay)) {
			const target = row.days.find((d) => d.inMonth)!.key;
			const week = this.host.createDiv({
				cls: "daybook-month-week",
				text: String(row.week.week),
				attr: { role: "button", tabindex: "0", "aria-label": `Open week ${row.week.week}` },
			});
			week.addEventListener("click", () => this.openWeek(target));
			week.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this.openWeek(target);
				}
			});
			for (const day of row.days) {
				if (day.inMonth) this.addCard(this.host, day.key, 3).el.addClass("daybook-month-day");
				else this.host.createDiv({ cls: "daybook-month-blank" });
			}
		}
		await this.refreshAll();
	}
}
