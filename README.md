# pi-extensions

Custom slash-command extensions for the [pi](https://github.com/earendil-works/pi-coding-agent) coding agent. Each subdirectory is one extension that registers `/`-prefixed commands with the pi runtime.

## Extensions

### ezgit

**Path:** `ezgit/ezgit.ts`

Personal Git workflow wrapper. Registers 8 slash commands that make everyday Git operations interactive — branch switching via menu, one-shot commit+push, safe branch deletion, versioned release flow, and more.

| Command | Description |
|---|---|
| `/ezgit-branch` | List branches in a menu and switch (or `/ezgit-branch <name>`) |
| `/ezgit-commit` | Stage all changes and commit the current branch |
| `/ezgit-push` | Push the current branch to its upstream remote |
| `/ezgit-create-branch` | Create a new branch from a selected source branch |
| `/ezgit-delete-branch` | Delete a local branch (confirmation required, blocks main/master) |
| `/ezgit-reset` | Reset current branch to a past commit (with confirmation) |
| `/ezgit-to-latest` | Commit work, merge highest `version-*` branch into master/main, tag next version |
| `/ezgit-help` | List all ezgit commands with descriptions |

**Version branch semantics:** branches/tags named `version-1.0.9.4-stable` are parsed numerically — highest version wins, longer arrays win on equal prefixes. Bumping increments the last segment.

**Safety features:** blocks deletion of `main`/`master`, confirms destructive ops, detects dirty trees, falls back to plain text when no interactive UI is available.

---

## Adding a new extension

1. Create a new directory at the project root (e.g., `my-ext/`). Don't use a dot-prefixed name — those are reserved for system/tooling directories.
2. Add your extension entry point (e.g., `my-ext/my-ext.ts`).
3. The agent will detect the new folder and update this README automatically.

See `AGENT.md` for the full project conventions and auto-update protocol.
