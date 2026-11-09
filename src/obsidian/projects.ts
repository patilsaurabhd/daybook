// Reading and writing project notes (Daybook/Projects/*.md).

import { App, TFile, normalizePath } from "obsidian";
import { DateKey } from "../core/dates";
import { Project, applyProject, isActiveOn, newProject, parseProject, PROJECT_COLOURS, sameName } from "../core/project";
import { projectPath, projectsFolder } from "../core/paths";
import { VaultStore } from "./store";

export class ProjectStore {
	constructor(
		private app: App,
		private store: VaultStore,
		private root: () => string,
	) {}

	folder(): string {
		return normalizePath(projectsFolder(this.root()));
	}

	pathOf(name: string): string {
		return normalizePath(projectPath(this.root(), name));
	}

	/** True if `path` is a project note (used to refresh views on changes). */
	isProjectPath(path: string): boolean {
		return path.startsWith(this.folder() + "/") && path.endsWith(".md") && !path.slice(this.folder().length + 1).includes("/");
	}

	private files(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter((f) => this.isProjectPath(f.path));
	}

	async all(): Promise<Project[]> {
		const list = await Promise.all(this.files().map(async (f) => parseProject(f.basename, await this.app.vault.cachedRead(f))));
		return list.sort((a, b) => (a.started || "").localeCompare(b.started || "") || a.name.localeCompare(b.name));
	}

	async activeOn(date: DateKey): Promise<Project[]> {
		return (await this.all()).filter((p) => isActiveOn(p, date));
	}

	/** Creates a project note. Returns the project, or the existing one if the name is taken. */
	async create(name: string, started: DateKey): Promise<Project> {
		const existing = (await this.all()).find((p) => sameName(p.name, name));
		if (existing) return existing;
		const colour = PROJECT_COLOURS[this.files().length % PROJECT_COLOURS.length]!;
		const project = newProject(name, started, colour);
		await this.store.write(this.pathOf(name), (old) => applyProject(old, project));
		return project;
	}

	/** Changes a project: re-reads the note, applies `change`, writes it back. */
	async update(name: string, change: (p: Project) => void): Promise<void> {
		await this.store.write(this.pathOf(name), (old) => {
			const p = parseProject(name, old);
			change(p);
			return applyProject(old, p);
		});
	}

	async open(name: string, newTab: boolean): Promise<void> {
		await this.app.workspace.openLinkText(this.pathOf(name), "", newTab);
	}
}
