// Drawing window for sketches. Pen colours and sizes, stroke eraser, undo,
// clear. Works with mouse, touch and pen (pressure-sensitive; once a pen is
// used, finger touches are ignored so a resting palm doesn't draw).
// Closing saves; "Discard" throws the changes away.

import { App, Modal, setIcon } from "obsidian";
import { AUTO_INK, Point, Sketch, Stroke, strokePath } from "../core/sketch";

const COLOURS: { value: string; label: string }[] = [
	{ value: AUTO_INK, label: "Ink" },
	{ value: "#e5484d", label: "Red" },
	{ value: "#3e7bfa", label: "Blue" },
	{ value: "#30a46c", label: "Green" },
	{ value: "#f76b15", label: "Orange" },
	{ value: "#8e4ec6", label: "Purple" },
];
const SIZES = [2, 4, 8];

type Action = { kind: "add"; stroke: Stroke } | { kind: "erase"; stroke: Stroke; index: number } | { kind: "clear"; strokes: Stroke[] };

export class SketchModal extends Modal {
	private strokes: Stroke[];
	private history: Action[] = [];
	private colour = AUTO_INK;
	private size = SIZES[1]!;
	private erasing = false;
	private penSeen = false;
	private erasePointer: number | null = null;
	private discard = false;
	private svg!: SVGSVGElement;
	private live: { stroke: Stroke; path: SVGPathElement; pointerId: number; pressures: number[] } | null = null;
	private toolEls = new Map<string, HTMLElement>();

	constructor(
		app: App,
		initial: Sketch | null,
		private onSave: (sketch: Sketch) => Promise<void>,
	) {
		super(app);
		this.strokes = initial ? structuredClone(initial.strokes) : [];
	}

	onOpen(): void {
		this.modalEl.addClass("daybook-sketch-modal");
		this.setTitle(this.strokes.length ? "Edit sketch" : "New sketch");
		const { contentEl } = this;

		const bar = contentEl.createDiv({ cls: "daybook-sketch-bar" });
		const colours = bar.createDiv({ cls: "daybook-sketch-group" });
		for (const c of COLOURS) {
			const b = colours.createEl("button", { cls: "daybook-swatch", attr: { "aria-label": c.label } });
			b.setCssProps({ "--daybook-swatch": c.value === AUTO_INK ? "var(--text-normal)" : c.value });
			b.addEventListener("click", () => {
				this.colour = c.value;
				this.erasing = false;
				this.syncTools();
			});
			this.toolEls.set(`c:${c.value}`, b);
		}
		const sizes = bar.createDiv({ cls: "daybook-sketch-group" });
		for (const s of SIZES) {
			const b = sizes.createEl("button", { cls: "daybook-size", attr: { "aria-label": `Pen size ${s}` } });
			b.createSpan({ cls: "daybook-size-dot" }).setCssProps({ "--daybook-size": `${s + 2}px` });
			b.addEventListener("click", () => {
				this.size = s;
				this.erasing = false;
				this.syncTools();
			});
			this.toolEls.set(`s:${s}`, b);
		}
		const tools = bar.createDiv({ cls: "daybook-sketch-group" });
		const eraser = this.iconButton(tools, "eraser", "Eraser (removes whole strokes)", () => {
			this.erasing = !this.erasing;
			this.syncTools();
		});
		this.toolEls.set("eraser", eraser);
		this.iconButton(tools, "undo-2", "Undo", () => this.undo());
		this.iconButton(tools, "trash-2", "Clear", () => this.clear());

		this.svg = contentEl.createSvg("svg", { cls: "daybook-sketch-canvas" });
		this.svg.addEventListener("pointerdown", (e) => this.onDown(e));
		this.svg.addEventListener("pointermove", (e) => this.onMove(e));
		this.svg.addEventListener("pointerup", (e) => this.onUp(e));
		this.svg.addEventListener("pointercancel", (e) => this.onUp(e));
		this.scope.register(["Mod"], "z", () => {
			this.undo();
			return false;
		});

		const footer = contentEl.createDiv({ cls: "daybook-sketch-footer" });
		footer.createSpan({ cls: "daybook-sketch-hint", text: "Closing saves the sketch." });
		const discard = footer.createEl("button", { text: "Discard" });
		discard.addEventListener("click", () => {
			this.discard = true;
			this.close();
		});
		const save = footer.createEl("button", { cls: "mod-cta", text: "Save" });
		save.addEventListener("click", () => this.close());

		this.syncTools();
		// Size the drawing area once it's on screen; keep existing strokes visible.
		window.requestAnimationFrame(() => {
			const r = this.svg.getBoundingClientRect();
			let w = Math.max(r.width, 1);
			let h = Math.max(r.height, 1);
			for (const s of this.strokes) {
				for (const [x, y] of s.points) {
					w = Math.max(w, x + 20);
					h = Math.max(h, y + 20);
				}
			}
			this.svg.setAttr("viewBox", `0 0 ${Math.round(w)} ${Math.round(h)}`);
			this.redraw();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.discard || this.history.length === 0) return;
		void this.onSave({ strokes: this.strokes });
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
		const b = parent.createEl("button", { cls: "daybook-sketch-tool", attr: { "aria-label": label } });
		setIcon(b, icon);
		b.addEventListener("click", onClick);
		return b;
	}

	private syncTools(): void {
		for (const c of COLOURS) this.toolEls.get(`c:${c.value}`)?.toggleClass("is-active", !this.erasing && this.colour === c.value);
		for (const s of SIZES) this.toolEls.get(`s:${s}`)?.toggleClass("is-active", !this.erasing && this.size === s);
		this.toolEls.get("eraser")?.toggleClass("is-active", this.erasing);
		this.svg?.toggleClass("is-erasing", this.erasing);
	}

	// ---- Drawing ----

	private redraw(): void {
		this.svg.empty();
		this.strokes.forEach((s, i) => this.drawStroke(s, i));
	}

	private drawStroke(stroke: Stroke, index: number): SVGPathElement {
		const path = this.svg.createSvg("path", { attr: { d: strokePath(stroke.points), "stroke-width": String(stroke.width), "data-i": String(index) } });
		if (stroke.color === AUTO_INK) path.addClass("daybook-ink");
		else path.setAttr("stroke", stroke.color);
		return path;
	}

	private toPoint(e: PointerEvent): Point {
		const ctm = this.svg.getScreenCTM();
		if (!ctm) return [e.offsetX, e.offsetY];
		const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
		return [p.x, p.y];
	}

	private width(pressures: number[], pen: boolean): number {
		if (!pen || pressures.length === 0) return this.size;
		const avg = pressures.reduce((a, b) => a + b, 0) / pressures.length;
		return Math.max(1, this.size * (0.4 + avg * 1.2));
	}

	private onDown(e: PointerEvent): void {
		if (e.pointerType === "pen") this.penSeen = true;
		if (e.pointerType === "touch" && this.penSeen) return; // palm rejection
		if (e.button !== 0 || this.live || this.erasePointer !== null) return;
		e.preventDefault();
		this.svg.setPointerCapture(e.pointerId);
		if (this.erasing) {
			this.erasePointer = e.pointerId;
			this.eraseAt(e);
			return;
		}
		const stroke: Stroke = { color: this.colour, width: this.size, points: [this.toPoint(e)] };
		const path = this.drawStroke(stroke, this.strokes.length);
		this.live = { stroke, path, pointerId: e.pointerId, pressures: [e.pressure || 0.5] };
	}

	private onMove(e: PointerEvent): void {
		if (e.pointerId === this.erasePointer) {
			this.eraseAt(e);
			return;
		}
		const live = this.live;
		if (!live || e.pointerId !== live.pointerId) return;
		// Include the in-between points the browser batched up, for smooth lines.
		const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
		for (const ev of events.length ? events : [e]) {
			live.stroke.points.push(this.toPoint(ev));
			live.pressures.push(ev.pressure || 0.5);
		}
		live.stroke.width = this.width(live.pressures, e.pointerType === "pen");
		live.path.setAttr("d", strokePath(live.stroke.points));
		live.path.setAttr("stroke-width", String(live.stroke.width));
	}

	private onUp(e: PointerEvent): void {
		if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
		if (e.pointerId === this.erasePointer) {
			this.erasePointer = null;
			return;
		}
		const live = this.live;
		if (!live || e.pointerId !== live.pointerId) return;
		this.live = null;
		this.strokes.push(live.stroke);
		this.history.push({ kind: "add", stroke: live.stroke });
	}

	private eraseAt(e: PointerEvent): void {
		const el = activeDocument.elementFromPoint(e.clientX, e.clientY);
		const path = el?.closest("path[data-i]");
		if (!path || !this.svg.contains(path)) return;
		const index = Number(path.getAttr("data-i"));
		const stroke = this.strokes[index];
		if (!stroke) return;
		this.strokes.splice(index, 1);
		this.history.push({ kind: "erase", stroke, index });
		this.redraw();
	}

	private undo(): void {
		const last = this.history.pop();
		if (!last) return;
		if (last.kind === "add") {
			const i = this.strokes.lastIndexOf(last.stroke);
			if (i >= 0) this.strokes.splice(i, 1);
		} else if (last.kind === "erase") {
			this.strokes.splice(last.index, 0, last.stroke);
		} else {
			this.strokes = last.strokes;
		}
		this.redraw();
	}

	private clear(): void {
		if (this.strokes.length === 0) return;
		this.history.push({ kind: "clear", strokes: this.strokes });
		this.strokes = [];
		this.redraw();
	}
}
