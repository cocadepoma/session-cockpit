# session-cockpit

An opencode-style session sidebar for Claude Code. It docks beside the chat and shows, at a glance, what the session is doing: title, model, git branch, context and usage, skills, other open sessions, past conversations, notes, changed files with diffs, MCP servers and todos.

It is a Claude Code **mod**: a hooks module that draws a pane. It needs no server, no API key and no network access.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install session-cockpit --marketplace cocadepoma/session-cockpit
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). From a shell:

```
claude plugin install session-cockpit --marketplace cocadepoma/session-cockpit
```

The sidebar opens by itself when the terminal is wide enough to dock it beside the chat. Type `/sidebar` to show or hide it; closing it with its close mark is remembered.

## What it shows

| Section | What you see | What you can do |
|---|---|---|
| Header | Session title, model and effort, project, git branch (`*` dirty, `↑` ahead, `↓` behind); the logo above it, unless hidden | Press the model line to open a picker with the models (`sonnet`, `opus`, `haiku`, `fable`) and the effort levels (`auto`, `low`, `medium`, `high`, `xhigh`, `max`); a pick runs `/model` or `/effort`, and the current one is highlighted and marked `●`; a `▶`/`▼` before the model shows it can be pressed. The effort is learned from `/effort` replies and from each turn, so it is unmarked until the first of those. While Claude is working the options are dim and wait until it is idle |
| Keep awake | `○` off, `●` on | Press a duration (`30m`, `1h`, `2h`, `5h` or `∞`) to stop the screen locking or the computer sleeping while idle; the `●` shows the time left, press it to stop |
| Context | Context-window bar, tokens, cost so far (`~` marks an estimate) | `details` unfolds what fills the window, by category; `measure` also lists the largest memory files and MCP servers (it counts tokens with the API, so it runs only when you press it) |
| Usage | 5-hour, 7-day and spend limits with time to reset; a `▲ N%` mark when the 5-hour or 7-day window is on course to reach 90% or more before it resets; the last reading and its age after a restart; `today $x · 7d $y`, what all your sessions cost today and over the last seven days | |
| Skills | Your skills and plugin commands | Filter; press one to put it in the prompt |
| Sessions | Running Claude Code sessions, this one first, each `working`, `waiting` (showing what it waits for) or `done`; waiting ones come right after this one. A session with agents at work shows `· N agents` and lists them under its row (`└ type · description`, with their status), indented one level per parent; only sessions running this version of the mod publish them | Filter (agents follow their session) |
| Conversations | Recent conversations in this project, current one first | Filter; press to resume; `+ new` starts a new one |
| Notes | Saved notes | Filter; press to copy; `✕` deletes |
| Files | Repository changes against `HEAD` and files Claude edited, grouped by repository and `Other`; the header shows the total `+added -removed` | Filter; press a file to open its diff |
| MCP | Connected MCP servers | Filter (when there are three or more) |
| Activity | Off by default (turn it on with `Show Activity` or in Settings). The tool calls and subagents running now, each with its target and elapsed time (subagent calls nested under their row), and the last five finished ones with `✓` or `✗`; hidden while there is nothing to show; drawn below MCP; nothing is recorded while it is off | |
| Todo | The session's todo list | |
| Help | Commands and gestures | |
| Settings | Every part you can hide (Logo, Keep awake, Context, Usage, Skills, Sessions, Conversations, Notes, Files, MCP, Activity, Todos, Help), each `shown` or `hidden`; folded by default, always last | Press a row to show or hide that part; the sidebar reloads with the new value |

Every list shows eight rows at a time: the mouse wheel scrolls the list under the pointer, and the sidebar anywhere else or when that list is at its end. In a filter box, Enter acts on the first match.

## Commands

| Command | Effect |
|---|---|
| `/sidebar` | Show or hide the sidebar |
| `/sidebar debug` | Write the sidebar's trace to `~/.claude/session-cockpit.debug.log` |
| `/note [text]` | Save the text, else the selected text, else the last reply, to Notes |
| `/logo [art]` | Draw your own ASCII art as the logo; bare `/logo` restores the default |
| `/logo file [path]` | Load the logo from a file, default `~/.claude/session-cockpit/logo.ans`; a leading `~` is your home |

To paste a logo, type `/logo`, press `shift+enter` for a new line, then paste the art, so its first line keeps its leading spaces. Trailing spaces and blank lines around the art are dropped and a margin shared by every line is removed. Art without colour codes is drawn in one colour. ANSI art keeps its colours: copy the file raw (`pbcopy < art.ans` on macOS) and paste it the same way. The prompt drops the `ESC` character, so the sidebar reads the codes with or without it: text and background colours (16, 256 and RGB, the first two through the xterm palette), bold, dim, italic, underline, inverse and strikethrough; text with no colour uses the theme's text colour. A literal `[0m` or `[31m` written as part of the art is read as a code, and other sequences (cursor moves, clears) are shown as text. It can be up to 40 lines tall and is hidden while the sidebar is narrower than its widest line.

To load art from a file, write it there and run `/logo file`; the file is read as text, so its colour codes keep their `ESC`, and `/logo file` says why it refuses one: it cannot be read, it is empty, it has escape codes other than colours (cursor moves, clears), or it is taller than 40 lines. The file is the way to get art into the sidebar without the paste, which can change non-ASCII characters.

Keys: `ctrl+x tab` focuses the sidebar, `Esc` returns focus and closes the diff pane.

## Configuration

The options are in `/config`, under this plugin:

| Option | Default | Effect |
|---|---|---|
| `Show Logo` | on | Off removes the logo |
| `Show Activity` | off | On draws the Activity section below MCP |
| `Show <section>` (Keep awake, Context, Usage, Skills, Sessions, Conversations, Notes, Files, MCP, Todo, Help) | on | Off removes that section from the sidebar, and its list from the mouse wheel |
| `Context warning percent` | 70 | The context bar turns yellow from here |
| `Context critical percent` | 85 | The context bar turns red from here |

The header, Settings and footer are always shown. The Settings section writes these same options, so it and `/config` always agree. If the warning is not below the critical, or either is outside 1 to 100, the defaults (70 and 85) are used. Changing an option reloads the mod.

## Requirements

- A Claude Code build that loads mods (hooks modules).
- macOS or Linux. Windows is not supported.
- On the `PATH`: `git`, `diff`, `grep`, `ps`, `uname`, `rm`.
- Keep awake uses `caffeinate` on macOS (`-t` sets the duration). On Linux it picks by desktop: `kde-inhibit` (KDE), `gnome-session-inhibit` (GNOME, Budgie), `mate-session-inhibit` (MATE), else `systemd-inhibit`; a timed run holds with `timeout` (or `sleep` without a session pid), so the system ends it even if the mod restarts. KDE and MATE run the hold under `setpriv`, so it ends with the inhibitor. `∞` needs the session's pid; without it Keep awake is not available. Desktops where this was not verified show `unverified here` next to the switch; where nothing works, a message says so and the switch stays off.

## Data and privacy

The mod sends nothing anywhere. It reads and writes only on your machine:

| What | Where | Lifetime |
|---|---|---|
| Section open or closed, Context details open, sidebar open | Claude Code's plugin store | Until you change them |
| Notes (at most 200) | Claude Code's plugin store | Until you delete them |
| Custom logo | Claude Code's plugin store | Until you run a bare `/logo` |
| Last usage reading | Claude Code's plugin store | Replaced by each new reading |
| A copy of each file **before** Claude first edits it in a session, to compute its diff | `~/.claude/session-cockpit/diffs/<session id>/` | Removed on `/clear` or a conversation switch; for sessions that are no longer running, after 7 days without changes (checked when a session starts) |
| The agents working for this session (id, type, description, status), so other sessions' sidebars can list them | `~/.claude/session-cockpit/agents/<session id>.json` | Rewritten only when the list changes or the file goes missing; removed when the session ends, and the files of sessions that are no longer running are removed when a session starts |
| What this session cost per day and its last cost reading, so the Usage line can add up every session | `~/.claude/session-cockpit/cost/<session id>.json` | Grows by the cost of each turn; files whose newest day is more than 8 days old are removed when a session starts |
| Trace log | `~/.claude/session-cockpit.debug.log` | Only written by `/sidebar debug` |

`~/.claude` stands for `$CLAUDE_CONFIG_DIR` when that is set. The file copies are plain text: if Claude edits a file holding secrets, its earlier content sits in that folder until it is removed.

It also reads, without changing them, Claude Code's own conversation files (`~/.claude/projects/`) for titles, token counts and the prompt-cache tier, and its session registry (`~/.claude/sessions/`) for open sessions. These formats are internal to Claude Code: if a release changes them, the affected section shows less (no titles, no other sessions) instead of failing.

Git is only read. Every `git` call runs with `--no-optional-locks` and `core.fsmonitor` off, so it never holds `.git/index.lock` while you run your own git commands and never starts the repository's fsmonitor command. Diffs run without external diff or textconv commands.

## Limits

- **Keep awake** prevents idle locking and sleep only. Locking the screen yourself or closing the lid still does.
- **Linux** support follows each desktop's documented inhibit tool but has not been run on real Linux desktops yet.
- **Cost today and over 7 days** counts only sessions that run this version of the mod, uses your local date and a rolling seven days, and ignores what a session had already cost when it started. Removing an old file uses `rm -f`.
- **Session agents** come from each session's own publication: a session that runs an older version of the mod, or none, shows no agents. Only pending, running and waiting agents are listed. Removing a file uses `rm -f`, the one host command this feature runs.
- **Files** outside a git repository lists only the files Claude edited.
- While the sidebar is open it polls every second (open sessions, notes, conversations) and every three seconds (git status, diffs). The polls pause while it is closed. The open-sessions poll re-reads only the registry and agents files that changed and checks the running PIDs with `ps` every five seconds. Idle, the sidebar does not redraw every second: Activity's clock ticks only while a tool or subagent runs.

## Development

```
claude --plugin-dir .          # run a session with the mod loaded from this folder
claude plugin validate .       # what the engine will load, and what it would refuse
claude plugin test .           # the test suite
```

Type checking needs the engine's type files, which Claude Code writes to `.claude-plugin/types/` the first time it loads the mod from this folder. After that:

```
npx -p typescript tsc -p .
```

### Layout

| Path | Holds |
|---|---|
| `hooks/register.tsx` | The entry point: which engine events the mod hooks, each delegating to a module below |
| `hooks/sidebar.tsx` | The pane: opening and closing it, `/sidebar`, composing the sections, wheel routing |
| `hooks/refresh.ts` | Full refreshes and the timed watches |
| `hooks/sections/` | One module per sidebar section: its state, how it loads, its actions and how it draws |
| `hooks/data/` | State and readers shared by several sections: git, session metadata, snapshots, transcripts, the session registry, the published agents |
| `hooks/lib/` | Helpers with no section of their own: list windows and filters, text formatting, paths, the trace, shared view pieces |
| `types/index.d.ts` | The state contract: every value the mod keeps in `$.state` |
| `tests/` | One test file per feature, shared fixtures in `fixtures.tsx` |

### Engine rules to keep in mind

`claude plugin validate` reads the source statically, which shapes the code:

- `read` and `update` take only an `atom(...)` defined in the same file, so each value is private to the module that owns it; other modules call that module's functions.
- Outside `hooks/register.tsx`, a function that receives `$` must be a `function` declaration, and `$` cannot be passed to a function held in a variable.
- `types/index.d.ts` has no imports and exports only types.

## License

[MIT](LICENSE)
