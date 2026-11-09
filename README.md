# Daybook

A planner and diary for Obsidian. A calendar in the right sidebar opens a main-area view of editable cards. Everything is stored as plain Markdown.

```
Daybook/2026/11/2026-11-09.md    day: tags property, ## Goals, ## Tasks (### cards inside), ## Diary
Daybook/2026/11/2026-11.md       month goals, reflection
Daybook/2026/2026.md             year goals, reflection
Daybook/2026/Weeks/2026-W46.md   week goals, reflection
Daybook/Projects/Website.md      project: status, dates, colour, ## Milestones, ## Notes
Daybook/Events/Germany.md        event: start, end, category, ## Notes
```

A day's task card belongs to a project when its heading links to it: `### [[Website]]`. Active projects show on every day from their start date until they're finished.

Files are created on your first keystroke, never just by opening a day. Daybook only rewrites the `tags` property and the `## Goals`, `## Tasks` and `## Diary` sections; anything else you put in a note is kept.

## Status

| Stage | What | State |
|---|---|---|
| 1 | Sidebar calendar + editable day card (goals, tags, task cards, diary) | done |
| 2 | Week view | done |
| 3 | Month view | done |
| 4 | Year grid with categories | done |
| 5 | Enlarge-on-click, goals at every level, carry over tasks, focus mode | done |

## Code layout

```
src/core/        Planner logic. No Obsidian imports — portable.
  dates.ts       Date maths, ISO weeks, display names
  paths.ts       Where each note lives
  markdown.ts    Frontmatter and "## Section" editing
  day.ts         Day note model: parse + merge back into the file
  lists.ts       Bullet/numbered list editing (Enter, Tab)
  calendar.ts    Month grid for the sidebar
  summary.ts     What a compact day card shows
  period.ts      Week/month/year notes (goals, reflection)
  project.ts     Project notes, active dates, card links
  sketch.ts      Sketch strokes <-> SVG
  year.ts        Year grid rows, category colours
  event.ts       Multi-day events (trips etc.)
  types.ts       Settings and shared types
src/obsidian/    Vault reading/writing and the settings tab
src/ui/          Views: sidebar calendar, main view, day card, task cards, Markdown box
src/main.ts      Plugin lifecycle and commands
tests/           Tests for src/core (npm test)
```

## Development

```bash
npm install
npm run dev     # rebuilds main.js on every change
npm run build   # type-check + production build
npm test        # core tests
npm run lint
scripts/install-to-vault.sh "/path/to/Test Vault"
```

## Licence

MIT
