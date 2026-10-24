# Changelog

All notable changes to this mod. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Pressing a file in Files shows its diff inside the sidebar, in place of the sections, with a `Back` button (`b`), instead of opening a second tab. `Back` returns to the file's row. This avoids a diff opened behind the `Session` tab that never took focus.

## [0.25.0] - 2026-10-24

### Changed

- The sidebar stays hidden in VS Code, both in the Claude Code extension and in `claude` run from VS Code's integrated terminal. It does not open by itself there, a sidebar drawn there closes without being remembered as closed, and `/sidebar` answers `The sidebar is off in VS Code.`

### Added

- README: a VS Code section.

## [0.24.0] - 2026-10-24

### Changed

- Without Claude Code's fullscreen layout the sidebar no longer fills the space above the prompt. Claude Code docks a pane beside the chat only in fullscreen, and elsewhere places it above the prompt, where the whole sidebar pushed the conversation down and its buttons could not be clicked. On a terminal without fullscreen, the sidebar the session opens by itself now closes at once (the next session still opens it), and `/sidebar` shows a compact view: model and effort, the context bar and the usage limits, with nothing to press and a line saying to set `"tui": "fullscreen"`. A fullscreen terminal narrower than 110 columns shows the same view with a line asking for a wider terminal, and the mobile app shows it too. Hiding Context or Usage hides it here as well.

### Added

- README: a Fullscreen section, and the fullscreen layout under Requirements.

## [0.23.1] - 2026-10-24

### Added

- README: how to save the selected text with a shortcut, by binding a key to `command:note` in `~/.claude/keybindings.json`.

## [0.23.0] - 2026-10-23

### Changed

- The mod is renamed from `opencode-sidebar` to `session-cockpit`. Its data moves to `~/.claude/session-cockpit/` (diffs, agents, cost and the logo file), and its trace log to `~/.claude/session-cockpit.debug.log`. Its saved values and settings carry over under the new name. The old `opencode-sidebar` data folder is left in place.

- The mouse wheel scrolls the list under the pointer, and the sidebar everywhere else. A tick over a list's rows moves that list, and at its first or last row passes to the sidebar, as a browser does. Before, the sidebar moved first and the wheel reached a list only at the sidebar's edge, always the first open one, so a tick up over a list scrolled down moved the whole sidebar. Scroll keys behave as before. Help describes it.
- Rows above the lists keep to one line each so the wheel knows where every list is: the git row cuts a long project name first and then a long branch, the effort choices sit on two rows instead of wrapping, a session's waiting text is cut at 24 columns, the Files group title and the Keep awake `unverified` note are cut to the width, and a model name is cut to fit beside its effort.

### Added

- `/logo file [path]` loads the logo from a file, default `~/.claude/session-cockpit/logo.ans`, so art does not have to go through the paste. The file is refused when it cannot be read, is empty, has escape codes other than colours, or is taller than 40 lines, and the current logo stays. Listed in Help.

## [0.22.0] - 2026-10-23

### Added

- `/logo` keeps the colours of pasted ANSI art: text and background colours (16, 256 and RGB), bold, dim, italic, underline, inverse and strikethrough. The codes are read with or without their `ESC`, which the prompt drops on paste, and do not count toward the logo's width.

### Fixed

- `/logo` said `1 lines` for one-line art.

## [0.21.0] - 2026-10-23

### Added

- `/logo [art]` draws your own ASCII art as the sidebar logo, in one colour, kept for every session; bare `/logo` restores the default. Art taller than 40 lines is refused, and the logo hides while the sidebar is narrower than its widest line. Listed in Help.

## [0.20.3] - 2026-10-23

### Fixed

- Model and effort picker: picking an effort did not mark it until the next prompt. In an interactive session `/effort` returns no reply text, so there was no level to read; the picked (or typed) level is now used when the reply is empty, and a reply that carries no level still changes nothing.

## [0.20.2] - 2026-10-23

### Fixed

- Model and effort picker: the current effort was never marked. The engine's `/config` has no effort row, which the mod looked for, and a pick never updated the state. The effort now comes from the reply of `/effort` (picked here or typed) and from each turn's request. It stays unknown, with nothing marked, until one of those happens; `auto` stays marked after a turn.

## [0.20.1] - 2026-10-23

### Changed

- Model and effort picker: the model line now starts with `▶` (`▼` while open) so it reads as pressable, and the current model and effort are drawn as a coloured chip instead of only a `●`.

## [0.20.0] - 2026-10-23

### Added

- Model and effort picker: press the model line in the header to open a row of models (`sonnet`, `opus`, `haiku`, `fable`) and a row of effort levels (`auto`, `low`, `medium`, `high`, `xhigh`, `max`). A pick runs `/model` or `/effort`, so the session itself changes, and the command's reply shows as a toast. The current values are marked with `●`. While Claude is working the options are dim and cannot be pressed; they unlock when it is idle. Subagents do not lock them.

## [0.19.0] - 2026-10-23

### Changed

- Activity's clock (spinner and elapsed times) only ticks while something runs, so the sidebar no longer redraws every second when idle. It also moves with Context hidden.
- The sessions list reads only the registry and agents files that changed, and checks the running PIDs every 5 seconds instead of every second; a crashed session leaves the list at most 5 seconds later.

### Removed

- The session line in Context (duration, compactions, reply age, tokens per second) and the `cache m:ss` / `cache cold` countdown.

## [0.18.0] - 2026-10-23

### Added

- Activity section is back, below MCP and hidden by default. Turn it on with `Show Activity` in `/config` or its row in Settings. While it is off the mod records no tool or agent activity for it.

## [0.17.0] - 2026-10-23

### Added

- Settings section, last in the sidebar and folded by default: one row per part (Logo, Keep awake, Context, Usage, Skills, Sessions, Conversations, Notes, Files, MCP, Todos, Help) showing `shown` or `hidden`; pressing a row writes the matching option in `/config`, so both always agree. A refused change shows a toast.
- Logo option in `/config` (`Show Logo`): off removes the logo completely.

### Removed

- Activity section and its `Show Activity` option.
- The `hide logo` / `show logo` button and `/sidebar logo`; the stored logo flag is deleted when a session starts. Use `Show Logo` or Settings instead.

## [0.16.0] - 2026-10-23

### Added

- Sessions shows how many agents work for each session (`working · 2 agents`) and lists them under its row, indented under their parent. Each session publishes its own agents, so a session running an older version of the mod shows none. The published file is removed when the session ends, and a new session removes the files of crashed ones.
- The Files header shows the total lines added and removed across the listed files.
- Usage shows `▲ N%` beside the 5-hour and 7-day bars when, at the current pace, the window would reach 90% or more before it resets.
- Context shows a session line: how long it has run, how many times it was compacted, the age of the last reply and its speed in tokens per second.
- Context shows `cache m:ss`, the time left before the prompt cache expires, and `cache cold` once it has.
- Context has a foldable `details` part listing what fills the window by category, largest first; `measure` also lists the five largest memory files and MCP servers.
- Activity section: running tool calls and subagents with their target and elapsed time, and the last five finished calls.
- Usage shows `today $x · 7d $y`, the cost of all your sessions today and over the last seven days.
- Options in `/config`: show or hide each section, and the percentages where the context bar turns yellow and red.

## [0.15.1] - 2026-10-22

### Fixed

- Git no longer takes `.git/index.lock` while it polls, so your own git commands do not fail with `index.lock: File exists`. It no longer runs the repository's fsmonitor, external diff or textconv commands.
- Turning Keep awake off on KDE or MATE no longer leaves a waiting process behind.
- `∞` no longer starts when the session's pid is unknown, so it cannot outlive Claude Code.

## [0.15.0] - 2026-10-22

### Added

- Sessions that wait for you show `waiting`, or what they wait for, in the warning color, and are listed before working ones.
- Keep awake takes a duration: `30m`, `1h`, `2h`, `5h` or `∞`. The `●` shows the time left, and a toast says when it ended.

### Fixed

- The Sessions header no longer says `all done` while a session is waiting.

## [0.14.0] - 2026-10-22

First public release.

### Added

- README, LICENSE (MIT) and this changelog.
- Snapshot directories of sessions that are no longer running are removed after 7 days without changes.

### Changed

- The logo is a neutral wordmark.
- The polls that read the session registry and git, and the git refresh after each shell command, pause while the sidebar is closed and catch up when it opens.
- The code is split into one module per sidebar section, with one shared implementation for every filterable list; the tests are split the same way.

### Fixed

- The working directory in the footer is shortened to `~` only when it is inside the home directory.
- A keep-awake helper that fails its start-up check is always stopped.

## Before 0.14.0

Private development versions (0.1.0 to 0.13.0), all in October 2026:

- Session header: title, model and effort, project, git branch with dirty, ahead and behind marks.
- Context bar with tokens and cost, plus rate-limit usage with reset countdowns; the last reading is kept across restarts.
- Skills, open sessions, conversations (resume, start new), notes (`/note`), changed files with a diff pane, MCP servers and todos.
- A filter box and a scroll window on every list.
- A keep-awake switch for macOS and Linux desktops.
- A Help section, a close mark that is remembered, and `/sidebar` to toggle the pane.
