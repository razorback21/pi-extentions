# AGENT.md — pi-extensions

This repository holds custom slash-command extensions for the pi coding agent. Each subdirectory at the project root is one extension.

## Project layout

```
pi-extensions/
├── AGENT.md          # this file
├── README.md         # auto-generated extension index
├── ezgit/            # example: ezgit extension
│   └── ezgit.ts
└── <new-ext>/        # each new extension gets its own folder
    └── <entry>.ts
```

## Extension conventions

- Each extension lives in its own directory at the project root.
- The entry point is a TypeScript file that exports a default function receiving the pi `ExtensionAPI`.
- Extensions register commands via `pi.registerCommand(name, { description, handler })`.
- Command names should be namespaced (e.g., `/ezgit-commit`, `/my-ext-do-thing`) to avoid collisions.

## Auto-update protocol for README.md

**When you detect a new extension directory** (a folder at the project root that doesn't start with `.` and isn't already listed in `README.md`), you **MUST** update `README.md` to include it. Follow this process:

1. **Detect:** List directories at the project root. Ignore all dot-prefixed directories (`.git`, `.serena`, `.vscode`, etc.). Any remaining folder that isn't an existing entry in `README.md` is a new extension.

2. **Inspect:** Read the extension's entry point file(s). Look for:
   - Registered command names (via `pi.registerCommand`)
   - Command descriptions (the `description` field)
   - Any top-level docstring or comment block explaining purpose
   - Exported helper functions that reveal internal semantics

3. **Document:** Add a new section to `README.md` under `## Extensions` following this template:

   ```markdown
   ### <ext-name>

   **Path:** `<ext-dir>/<entry-file>.ts`

   <One-sentence summary of what the extension does.>

   | Command | Description |
   |---|---|
   | `/<cmd-1>` | <description> |
   | `/<cmd-2>` | <description> |

   <Any additional notes about safety features, semantics, or usage.>
   ```

4. **If the extension has no readable entry point** (empty dir, non-TS files, etc.), add a placeholder entry:

   ```markdown
   ### <ext-name>

   **Path:** `<ext-dir>/`

   *No entry point found — extension is a stub or uses a non-standard structure.*
   ```

5. **Preserve existing entries.** Never remove or overwrite existing extension sections — only append new ones.

## What NOT to do

- Don't modify `AGENT.md` unless explicitly asked.
- Don't delete or rename extension directories.
- Don't add decorative emojis, title-case headings, or puffery to the README.
- Don't create files at the project root that aren't `README.md`, `AGENT.md`, or extension directories.
- Ignore all dot-prefixed directories (`.git`, `.serena`, `.vscode`, etc.) — never treat them as extensions.
