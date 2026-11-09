// Sketches: freehand strokes saved as an SVG file. The strokes are also kept
// inside the SVG (in <metadata>) so a sketch can be reopened and edited.
// Pure string logic, no DOM, so it's portable and testable.

export type Point = [number, number];

export interface Stroke {
	/** CSS colour, or "auto" for ink that follows light/dark mode. */
	color: string;
	width: number;
	points: Point[];
}

export interface Sketch {
	strokes: Stroke[];
}

export const AUTO_INK = "auto";
const LIGHT_INK = "#1f1f1f";
const DARK_INK = "#e6e6e6";
const META_ID = "daybook-sketch";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Smooth path through the points (quadratic curves via midpoints). */
export function strokePath(points: Point[]): string {
	if (points.length === 0) return "";
	const [x0, y0] = points[0]!;
	if (points.length === 1) return `M${r1(x0)} ${r1(y0)}L${r1(x0 + 0.1)} ${r1(y0)}`;
	let d = `M${r1(x0)} ${r1(y0)}`;
	for (let i = 1; i < points.length - 1; i++) {
		const [x, y] = points[i]!;
		const [nx, ny] = points[i + 1]!;
		d += `Q${r1(x)} ${r1(y)} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
	}
	const [lx, ly] = points[points.length - 1]!;
	return d + `L${r1(lx)} ${r1(ly)}`;
}

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function bounds(strokes: Stroke[], pad = 0): Box | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const s of strokes) {
		for (const [x, y] of s.points) {
			minX = Math.min(minX, x - s.width / 2);
			minY = Math.min(minY, y - s.width / 2);
			maxX = Math.max(maxX, x + s.width / 2);
			maxY = Math.max(maxY, y + s.width / 2);
		}
	}
	if (minX === Infinity) return null;
	return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXml(text: string): string {
	return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** The SVG file for a sketch, cropped to what was drawn. */
export function sketchToSvg(sketch: Sketch, pad = 12): string {
	const box = bounds(sketch.strokes, pad) ?? { x: 0, y: 0, w: 100, h: 40 };
	const data = {
		strokes: sketch.strokes.map((s) => ({ color: s.color, width: r1(s.width), points: s.points.map(([x, y]) => [r1(x), r1(y)]) })),
	};
	const paths = sketch.strokes
		.map((s) => {
			const colour = s.color === AUTO_INK ? `class="ink"` : `stroke="${escapeXml(s.color)}"`;
			return `<path ${colour} stroke-width="${r1(s.width)}" d="${strokePath(s.points)}"/>`;
		})
		.join("\n");
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r1(box.x)} ${r1(box.y)} ${r1(box.w)} ${r1(box.h)}" width="${Math.ceil(box.w)}" height="${Math.ceil(box.h)}">`,
		`<style>path{fill:none;stroke-linecap:round;stroke-linejoin:round}.ink{stroke:${LIGHT_INK}}@media (prefers-color-scheme: dark){.ink{stroke:${DARK_INK}}}</style>`,
		`<metadata id="${META_ID}">${escapeXml(JSON.stringify(data))}</metadata>`,
		paths,
		`</svg>`,
		"",
	].join("\n");
}

/** Reads the strokes back out of a Daybook sketch SVG; null if it isn't one. */
export function sketchFromSvg(svg: string): Sketch | null {
	const m = new RegExp(`<metadata id="${META_ID}">([\\s\\S]*?)</metadata>`).exec(svg);
	if (!m) return null;
	try {
		const data = JSON.parse(unescapeXml(m[1]!)) as { strokes?: unknown };
		if (!Array.isArray(data.strokes)) return null;
		const strokes: Stroke[] = [];
		for (const s of data.strokes as Record<string, unknown>[]) {
			if (typeof s.color !== "string" || typeof s.width !== "number" || !Array.isArray(s.points)) continue;
			const points = (s.points as unknown[]).filter(
				(p): p is Point => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number",
			);
			strokes.push({ color: s.color, width: s.width, points });
		}
		return { strokes };
	} catch {
		return null;
	}
}
