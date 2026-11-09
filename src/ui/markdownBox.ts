// A text box that edits Markdown and shows it formatted when you're not
// typing in it. Used for goals and the diary (and later the reflections).
//
// - Enter continues "- " and "1. " lists, Tab / Shift+Tab nest items.
// - Optional images: paste, drag in, or use the "Add image" button.
// - Optional sketches: "Sketch" opens a drawing window; click a sketch to edit it.
// - Click the formatted text to edit; links still open as usual.

import { App, Component, Keymap, MarkdownRenderer, Notice, TFile, moment, setIcon } from "obsidian";
import { Sketch, sketchFromSvg, sketchToSvg } from "../core/sketch";
import { SketchModal } from "./sketchModal";
import { listEnter, listIndent, TextEdit } from "../core/lists";
import type { VaultStore } from "../obsidian/store";

export interface MarkdownBoxOptions {
	value: string;
	placeholder: string;
	label: string;
	/** Note the text belongs to; used to resolve links and place attachments. */
	sourcePath: string;
	minRows?: number;
	onChange: (value: string) => void;
	/** When set, images can be pasted, dropped or picked. */
	images?: {
		store: VaultStore;
		/** Called before saving an image, so the note exists first. */
		beforeSave: () => Promise<void>;
	};
	/** Adds a "Sketch" button (needs `images`). */
	sketch?: boolean;
}

const IMAGE_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/heic": "heic",
	"image/avif": "avif",
	"image/bmp": "bmp",
};

export class MarkdownBox extends Component {
	private textarea!: HTMLTextAreaElement;
	private preview!: HTMLElement;
	private renderChild: Component | null = null;
	private value: string;

	constructor(
		private app: App,
		private containerEl: HTMLElement,
		private opts: MarkdownBoxOptions,
	) {
		super();
		this.value = opts.value;
	}

	onload(): void {
		const wrap = this.containerEl.createDiv({ cls: "daybook-mdbox" });

		this.preview = wrap.createDiv({ cls: "daybook-mdbox-preview markdown-rendered" });
		this.textarea = wrap.createEl("textarea", {
			cls: "daybook-mdbox-input",
			attr: { placeholder: this.opts.placeholder, "aria-label": this.opts.label, rows: String(this.opts.minRows ?? 2) },
		});
		this.textarea.value = this.value;

		this.registerDomEvent(this.textarea, "input", () => this.changed());
		this.registerDomEvent(this.textarea, "keydown", (evt) => this.onKey(evt));
		this.registerDomEvent(this.textarea, "blur", () => this.showPreview());
		this.registerDomEvent(this.preview, "click", (evt) => this.onPreviewClick(evt));

		if (this.opts.images) {
			this.registerDomEvent(this.textarea, "paste", (evt) => this.onPaste(evt));
			this.registerDomEvent(this.textarea, "drop", (evt) => this.onDrop(evt));
			const tools = wrap.createDiv({ cls: "daybook-mdbox-tools" });
			const picker = tools.createEl("input", {
				type: "file",
				cls: "daybook-hidden",
				attr: { accept: "image/*", multiple: "true", "aria-hidden": "true", tabindex: "-1" },
			});
			const add = tools.createEl("button", { cls: "daybook-mdbox-add clickable-icon", attr: { "aria-label": "Add image" } });
			setIcon(add, "image-plus");
			add.createSpan({ text: "Add image" });
			this.registerDomEvent(add, "mousedown", (evt) => evt.preventDefault()); // keep the caret in the text
			this.registerDomEvent(add, "click", () => picker.click());
			this.registerDomEvent(picker, "change", () => {
				const files = Array.from(picker.files ?? []);
				picker.value = "";
				void this.insertImages(files);
			});

			if (this.opts.sketch) {
				const sketch = tools.createEl("button", { cls: "daybook-mdbox-add clickable-icon", attr: { "aria-label": "Draw a sketch" } });
				setIcon(sketch, "pencil");
				sketch.createSpan({ text: "Sketch" });
				this.registerDomEvent(sketch, "mousedown", (evt) => evt.preventDefault());
				this.registerDomEvent(sketch, "click", () => this.newSketch());
			}
		}

		if (this.value.trim() === "") this.showEditor(false);
		else this.showPreview();
	}

	onunload(): void {
		this.renderChild = null;
	}

	// ---- Modes ----

	private showEditor(focus: boolean): void {
		this.preview.hide();
		this.textarea.show();
		window.requestAnimationFrame(() => autoGrow(this.textarea));
		if (focus) {
			this.textarea.focus();
			const end = this.textarea.value.length;
			this.textarea.setSelectionRange(end, end);
		}
	}

	private showPreview(): void {
		if (this.value.trim() === "") {
			this.showEditor(false); // empty: keep the box with its placeholder
			return;
		}
		if (this.renderChild) this.removeChild(this.renderChild);
		this.renderChild = this.addChild(new Component());
		this.preview.empty();
		void MarkdownRenderer.render(this.app, this.value, this.preview, this.opts.sourcePath, this.renderChild);
		this.textarea.hide();
		this.preview.show();
	}

	private onPreviewClick(evt: MouseEvent): void {
		const target = evt.target as HTMLElement;
		const link = target.closest("a");
		if (link) {
			if (link.hasClass("internal-link")) {
				evt.preventDefault();
				const href = link.getAttr("data-href") ?? link.getAttr("href") ?? "";
				void this.app.workspace.openLinkText(href, this.opts.sourcePath, Keymap.isModEvent(evt));
			}
			return; // external links open normally
		}
		if (target.closest("input[type=checkbox]")) return;
		// A Daybook sketch opens in the drawing window instead.
		const embed = target.closest(".internal-embed");
		const src = embed?.getAttr("src");
		if (src && this.opts.images) {
			const file = this.app.metadataCache.getFirstLinkpathDest(src, this.opts.sourcePath);
			if (file && file.extension === "svg") {
				evt.preventDefault();
				void this.editSketch(file);
				return;
			}
		}
		this.showEditor(true);
	}

	// ---- Sketches ----

	private newSketch(): void {
		const images = this.opts.images;
		if (!images) return;
		new SketchModal(this.app, null, async (sketch: Sketch) => {
			if (sketch.strokes.length === 0) return;
			try {
				await images.beforeSave();
				const bytes = new TextEncoder().encode(sketchToSvg(sketch));
				const name = `Sketch ${moment().format("YYYYMMDDHHmmss")}.svg`;
				const embed = await images.store.saveAttachment(name, bytes.buffer, this.opts.sourcePath);
				this.insertAtCaret(embed);
				if (this.textarea.ownerDocument.activeElement !== this.textarea) this.showPreview();
			} catch (e) {
				console.error("Daybook: could not save sketch", e);
				new Notice("Daybook could not save the sketch.");
			}
		}).open();
	}

	private async editSketch(file: TFile): Promise<void> {
		const sketch = sketchFromSvg(await this.app.vault.read(file));
		if (!sketch) {
			this.showEditor(true); // some other SVG: just edit the text
			return;
		}
		new SketchModal(this.app, sketch, async (edited: Sketch) => {
			try {
				await this.app.vault.process(file, () => sketchToSvg(edited));
				this.showPreview();
			} catch (e) {
				console.error("Daybook: could not save sketch", e);
				new Notice("Daybook could not save the sketch.");
			}
		}).open();
	}

	// ---- Editing ----

	private changed(): void {
		this.value = this.textarea.value;
		autoGrow(this.textarea);
		this.opts.onChange(this.value);
	}

	private apply(edit: TextEdit): void {
		this.textarea.value = edit.text;
		this.textarea.setSelectionRange(edit.start, edit.end);
		this.changed();
	}

	private onKey(evt: KeyboardEvent): void {
		if (evt.isComposing) return;
		const ta = this.textarea;
		if (evt.key === "Enter" && !evt.shiftKey && !evt.metaKey && !evt.ctrlKey && !evt.altKey) {
			const edit = listEnter(ta.value, ta.selectionStart, ta.selectionEnd);
			if (edit) {
				evt.preventDefault();
				this.apply(edit);
			}
		} else if (evt.key === "Tab" && !evt.metaKey && !evt.ctrlKey && !evt.altKey) {
			const edit = listIndent(ta.value, ta.selectionStart, ta.selectionEnd, evt.shiftKey);
			if (edit) {
				evt.preventDefault();
				this.apply(edit);
			}
		} else if (evt.key === "Escape") {
			ta.blur();
		}
	}

	private insertAtCaret(snippet: string): void {
		const ta = this.textarea;
		const start = ta.selectionStart;
		const end = ta.selectionEnd;
		const before = ta.value.slice(0, start);
		const lead = before === "" || before.endsWith("\n") ? "" : "\n";
		const text = lead + snippet + "\n";
		this.apply({ text: before + text + ta.value.slice(end), start: start + text.length, end: start + text.length });
	}

	// ---- Images ----

	private onPaste(evt: ClipboardEvent): void {
		const files = imageFiles(evt.clipboardData?.files);
		if (files.length === 0) return;
		evt.preventDefault();
		void this.insertImages(files);
	}

	private onDrop(evt: DragEvent): void {
		const files = imageFiles(evt.dataTransfer?.files);
		if (files.length === 0) return;
		evt.preventDefault();
		void this.insertImages(files);
	}

	private async insertImages(files: File[]): Promise<void> {
		const images = this.opts.images;
		if (!images || files.length === 0) return;
		try {
			await images.beforeSave();
			for (const file of files) {
				const name = attachmentName(file);
				const embed = await images.store.saveAttachment(name, await file.arrayBuffer(), this.opts.sourcePath);
				this.insertAtCaret(embed);
			}
			// The file picker takes focus away; show the result formatted.
			if (this.textarea.ownerDocument.activeElement !== this.textarea) this.showPreview();
		} catch (e) {
			console.error("Daybook: could not add image", e);
			new Notice("Daybook could not add the image.");
		}
	}
}

function imageFiles(list: FileList | null | undefined): File[] {
	return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

function attachmentName(file: File): string {
	// Clipboard images are all called "image.png"; give them Obsidian-style names.
	if (file.name && file.name !== "image.png") return file.name;
	const ext = IMAGE_TYPES[file.type] ?? "png";
	return `Pasted image ${moment().format("YYYYMMDDHHmmss")}.${ext}`;
}

function autoGrow(textarea: HTMLTextAreaElement): void {
	textarea.setCssStyles({ height: "auto" });
	textarea.setCssStyles({ height: `${textarea.scrollHeight + 2}px` });
}
