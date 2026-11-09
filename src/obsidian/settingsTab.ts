import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type DaybookPlugin from "../main";
import { Weekday, weekdayName } from "../core/dates";
import { cleanRoot } from "../core/paths";
import { RulesModal } from "../ui/recurringModal";

export class DaybookSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: DaybookPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		new Setting(containerEl)
			.setName("Notes folder")
			.setDesc("Where day, week, month and year notes, projects, events and recurring tasks are kept. Changing it doesn't move existing notes.")
			.addText((text) =>
				text
					.setPlaceholder("Daybook")
					.setValue(settings.rootFolder)
					.onChange(async (value) => {
						const cleaned = cleanRoot(value);
						settings.rootFolder = cleaned ? normalizePath(cleaned) : "Daybook";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("First day of the week")
			.setDesc("Used by the calendar and the week and month views.")
			.addDropdown((dropdown) => {
				for (let d = 0; d < 7; d++) {
					dropdown.addOption(String(d), weekdayName(d as Weekday, undefined, "long"));
				}
				dropdown.setValue(String(settings.firstDayOfWeek)).onChange(async (value) => {
					settings.firstDayOfWeek = Number(value) as Weekday;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Carry over unfinished tasks automatically")
			.setDesc("When on, opening today moves every unfinished task from the last day you wrote, without asking. When off, a bar lets you review and pick.")
			.addToggle((toggle) =>
				toggle.setValue(settings.autoCarry).onChange(async (value) => {
					settings.autoCarry = value;
					await this.plugin.saveSettings(false);
				}),
			);

		new Setting(containerEl)
			.setName("Recurring tasks")
			.setDesc("Tasks that come back on a schedule, like paying rent. Add, edit, pause or delete them.")
			.addButton((b) => b.setButtonText("Manage").onClick(() => new RulesModal(this.plugin).open()));

		new Setting(containerEl)
			.setName("Categories")
			.setDesc("Each category has a name, a tag and a colour. A day with that tag (or an event in that category) is coloured in the year view.")
			.setHeading();

		settings.categories.forEach((category, index) => {
			new Setting(containerEl)
				.setClass("daybook-category-setting")
				.addText((text) =>
					text
						.setPlaceholder("Name")
						.setValue(category.name)
						.onChange(async (value) => {
							category.name = value.trim();
							await this.plugin.saveSettings();
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder("Tag")
						.setValue(category.tag)
						.onChange(async (value) => {
							category.tag = value.trim().replace(/^#/, "");
							await this.plugin.saveSettings();
						}),
				)
				.addColorPicker((picker) =>
					picker.setValue(category.color).onChange(async (value) => {
						category.color = value;
						await this.plugin.saveSettings();
					}),
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Remove category")
						.onClick(async () => {
							settings.categories.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						}),
				);
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText("Add category").onClick(async () => {
				settings.categories.push({ name: "", tag: "", color: "#888888" });
				await this.plugin.saveSettings();
				this.display();
			}),
		);
	}
}
