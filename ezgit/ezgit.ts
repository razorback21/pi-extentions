/**
 * ezgit — personal git slash commands for pi.
 *
 * Commands:
 *   /ezgit-branch        list branches in a menu, pick one to switch (or pass a name)
 *   /ezgit-commit        stage all changes and commit the current branch
 *   /ezgit-push          push the current branch to its upstream remote
 *   /ezgit-create-branch create a new branch from a selected source branch
 *   /ezgit-delete-branch delete a local branch (confirmation required, blocks main/master)
 *   /ezgit-reset         reset current branch to a past commit (with confirmation)
 *   /ezgit-to-latest     commit work, merge the highest version-* branch into
 *                        master/main, tag the next version-1.x.x
 *   /ezgit-help          list commands with descriptions
 *
 * Version branch semantics: branch/tag names like `version-1.0.12` or
 * `version-1.0.9.4-stable`. "Latest" = the highest numeric version parsed
 * from the name (segments compared numerically, longer wins on equal prefix).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** "version-1.0.9.4-stable" -> [1, 0, 9, 4]; null if not a version name */
export function parseVersion(name: string): number[] | null {
	const m = /^version-(\d+(?:\.\d+)+)(?:-stable)?$/i.exec(name.trim());
	if (!m) return null;
	return m[1].split(".").map(Number);
}

/** Numeric segment comparison; longer array wins on equal prefix */
export function compareVersions(a: number[], b: number[]): number {
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x !== y) return x - y;
	}
	return 0;
}

/** Highest-versioned entry among names like version-1.x.x[-stable] */
export function findLatestVersionBranch(names: string[]): string | null {
	let best: string | null = null;
	let bestV: number[] | null = null;
	for (const n of names) {
		const v = parseVersion(n);
		if (v && (!bestV || compareVersions(v, bestV) > 0)) {
			best = n;
			bestV = v;
		}
	}
	return best;
}

/** Bump last segment: [1, 0, 9, 4] -> "version-1.0.9.5" */
export function bumpVersion(v: number[]): string {
	const next = [...v];
	next[next.length - 1] = (next[next.length - 1] ?? 0) + 1;
	return "version-" + next.join(".");
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function git(pi: ExtensionAPI, args: string[], cwd: string) {
	return pi.exec("git", args, { cwd });
}

/** True when cwd is inside a git work tree */
async function ensureRepo(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<boolean> {
	const r = await git(pi, ["rev-parse", "--is-inside-work-tree"], ctx.cwd);
	if (r.code !== 0) {
		ctx.ui.notify("Not a git repository", "error");
		return false;
	}
	return true;
}

/** Local branch names (short form) */
async function localBranches(pi: ExtensionAPI, cwd: string): Promise<string[]> {
	const r = await git(pi, ["branch", "--format=%(refname:short)"], cwd);
	return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** master or main, whichever exists (origin/HEAD preferred) */
async function defaultBranch(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const origin = await git(pi, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
	if (origin.code === 0 && origin.stdout.trim()) {
		const b = origin.stdout.trim().replace(/^origin\//, "");
		if (b && b !== "HEAD") return b;
	}
	for (const b of ["master", "main"]) {
		const r = await git(pi, ["rev-parse", "--verify", "--quiet", b], cwd);
		if (r.code === 0) return b;
	}
	return null;
}

/** Stage all and commit. Returns "done" | "clean" | "cancelled" | "failed" */
async function commitCurrentBranch(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string> {
	const status = await git(pi, ["status", "--porcelain"], ctx.cwd);
	if (status.code !== 0) return "failed";
	if (!status.stdout.trim()) return "clean";

	let msg = "";
	if (ctx.hasUI) {
		msg = (await ctx.ui.input("Commit message", ""))?.trim() ?? "";
		if (!msg) {
			ctx.ui.notify("Commit cancelled", "warning");
			return "cancelled";
		}
	} else {
		ctx.ui.notify("Working tree dirty — /ezgit-commit needs a message (not available here)", "warning");
		return "cancelled";
	}

	const add = await git(pi, ["add", "-A"], ctx.cwd);
	if (add.code !== 0) {
		ctx.ui.notify(`git add failed:\n${add.stderr}`, "error");
		return "failed";
	}
	const c = await git(pi, ["commit", "-m", msg], ctx.cwd);
	if (c.code !== 0) {
		ctx.ui.notify(`git commit failed:\n${c.stderr}`, "error");
		return "failed";
	}
	ctx.ui.notify(`Committed: ${msg}`, "info");
	return "done";
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// /ezgit-branch — list branches in a menu, switch to the selection.
	// With an argument (/ezgit-branch <name>) switches directly, no menu.
	pi.registerCommand("ezgit-branch", {
		description: "List branches in a menu and switch (or /ezgit-branch <name>)",
		handler: async (args, ctx) => {
			if (!(await ensureRepo(pi, ctx))) return;

			const direct = args.trim();
			if (direct) {
				const sw = await git(pi, ["switch", direct], ctx.cwd);
				if (sw.code !== 0) return ctx.ui.notify(`Switch failed:\n${sw.stderr}`, "error");
				ctx.ui.notify(`Switched to ${direct}`, "info");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("Branches:\n" + (await localBranches(pi, ctx.cwd)).join("\n"), "info");
				return;
			}

			const branches = await localBranches(pi, ctx.cwd);
			const current = (await git(pi, ["branch", "--show-current"], ctx.cwd)).stdout.trim();
			// Sort: current branch first, then alphabetical
			const sorted = [...branches].sort((a, b) => {
				if (a === current) return -1;
				if (b === current) return 1;
				return a.localeCompare(b);
			});
			const items = sorted.map((b) =>
				b === current ? `● ${b} (current)` : `  ${b}`
			);
			const choice = await ctx.ui.select("Switch branch", items);
			if (!choice) return;

			const branch = choice.replace(/^[● ]+/, "").replace(/ \(current\)$/, "");
			if (branch === current) {
				ctx.ui.notify(`Already on ${branch}`, "info");
				return;
			}
			const sw = await git(pi, ["switch", branch], ctx.cwd);
			if (sw.code !== 0) return ctx.ui.notify(`Switch failed:\n${sw.stderr}`, "error");
			ctx.ui.notify(`Switched to ${branch}`, "info");
		},
	});

	// /ezgit-commit — stage everything, commit with a message.
	// Message via input dialog, or /ezgit-commit "message".
	pi.registerCommand("ezgit-commit", {
		description: "Stage all changes and commit the current branch",
		handler: async (args, ctx) => {
			if (!(await ensureRepo(pi, ctx))) return;

			let msg = args.trim();
			if (!msg && ctx.hasUI) {
				msg = (await ctx.ui.input("Commit message", ""))?.trim() ?? "";
			}
			if (!msg) {
				ctx.ui.notify("No message — commit cancelled", "warning");
				return;
			}

			const status = await git(pi, ["status", "--porcelain"], ctx.cwd);
			if (status.code !== 0) return ctx.ui.notify(status.stderr, "error");
			if (!status.stdout.trim()) {
				ctx.ui.notify("Nothing to commit", "info");
				return;
			}

			const add = await git(pi, ["add", "-A"], ctx.cwd);
			if (add.code !== 0) return ctx.ui.notify(`git add failed:\n${add.stderr}`, "error");
			const c = await git(pi, ["commit", "-m", msg], ctx.cwd);
			if (c.code !== 0) return ctx.ui.notify(`git commit failed:\n${c.stderr}`, "error");
			ctx.ui.notify(`Committed: ${msg}`, "info");
		},
	});

	// /ezgit-create-branch — pick a source branch (current highlighted),
	// then enter a name to create the new branch from it.
	pi.registerCommand("ezgit-create-branch", {
		description: "Create a new branch from a selected source branch",
		handler: async (args, ctx) => {
			if (!(await ensureRepo(pi, ctx))) return;

			const current = (await git(pi, ["branch", "--show-current"], ctx.cwd)).stdout.trim();
			const branches = await localBranches(pi, ctx.cwd);

			if (!ctx.hasUI) {
				ctx.ui.notify("Branches:\n" + branches.join("\n"), "info");
				return;
			}

			// Sort: current branch first, then alphabetical
			const sorted = [...branches].sort((a, b) => {
				if (a === current) return -1;
				if (b === current) return 1;
				return a.localeCompare(b);
			});
			const items = sorted.map((b) =>
				b === current ? `● ${b} (current)` : `  ${b}`
			);

			const source = await ctx.ui.select("Create branch from", items);
			if (!source) return;

			const sourceBranch = source.replace(/^[● ]+/, "").replace(/ \(current\)$/, "");

			let newName = args.trim();
			if (!newName) {
				newName = (await ctx.ui.input("New branch name", ""))?.trim() ?? "";
			}
			if (!newName) {
				ctx.ui.notify("No name \u2014 cancelled", "warning");
				return;
			}

			const r = await git(pi, ["switch", "-c", newName, sourceBranch], ctx.cwd);
			if (r.code !== 0) return ctx.ui.notify(`Create failed:\n${r.stderr}`, "error");
			ctx.ui.notify(`Created "${newName}" from "${sourceBranch}"`, "info");
		},
	});

	// /ezgit-delete-branch — delete a local branch with confirmation.
	// Blocks deletion of main/master. Supports -D for force delete.
	pi.registerCommand("ezgit-delete-branch", {
		description: "Delete a local branch (confirmation required, blocks main/master)",
		handler: async (args, ctx) => {
			if (!(await ensureRepo(pi, ctx))) return;

			const protect = new Set(["main", "master"]);
			const force = args.trim() === "-D" || args.trim() === "--force";

			// Gather deletable branches (exclude protected + current)
			const current = (await git(pi, ["branch", "--show-current"], ctx.cwd)).stdout.trim();
			const allBranches = await localBranches(pi, ctx.cwd);
			const deletable = allBranches.filter((b) => !protect.has(b) && b !== current);

			if (deletable.length === 0) {
				ctx.ui.notify("No deletable branches (main/master are protected, current branch excluded)", "warning");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("Deletable branches:\n" + deletable.join("\n"), "info");
				return;
			}

			const choice = await ctx.ui.select("Delete branch", deletable);
			if (!choice) return;

			const warning = force
				? `⚠ FORCE delete "${choice}"? Unmerged commits will be lost.`
				: `Delete branch "${choice}"?`;
			const confirm = await ctx.ui.select(warning, ["Yes, delete", "No, keep"]);
			if (confirm !== "Yes, delete") {
				ctx.ui.notify("Delete cancelled", "info");
				return;
			}

			const deleteFlag = force ? "-D" : "-d";
			const r = await git(pi, ["branch", deleteFlag, choice], ctx.cwd);
			if (r.code !== 0) return ctx.ui.notify(`Delete failed:\n${r.stderr}`, "error");
			ctx.ui.notify(`Deleted branch ${choice}`, "info");
		},
	});

	// /ezgit-push — push the current branch to its upstream remote.
	// With --set-upstream (-u) if no upstream is configured yet.
	pi.registerCommand("ezgit-push", {
		description: "Push the current branch to its upstream remote",
		handler: async (args, ctx) => {
			if (!(await ensureRepo(pi, ctx))) return;

			const current = (await git(pi, ["branch", "--show-current"], ctx.cwd)).stdout.trim();
			if (!current) return ctx.ui.notify("Not on a branch (detached HEAD?)", "error");

			// Check if upstream is set for this branch
			const upstream = await git(pi, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], ctx.cwd);
			const setUpstream = upstream.code !== 0 || "-u" === args.trim() || "--set-upstream" === args.trim();

			let pushArgs: string[];
			if (setUpstream) {
				pushArgs = ["push", "-u", "origin", current];
			} else {
				pushArgs = ["push"];
			}

			const p = await git(pi, pushArgs, ctx.cwd);
			if (p.code !== 0) return ctx.ui.notify(`Push failed:\n${p.stderr}`, "error");
			ctx.ui.notify(`Pushed ${current} to origin`, "info");
		},
	});

	// /ezgit-reset — pick a commit to reset to (soft/mixed/hard).
	// Shows recent commits, asks for confirmation, then resets.
	pi.registerCommand("ezgit-reset", {
		description: "Reset current branch to a past commit (with confirmation)",
		handler: async (args, ctx) => {
			if (!(await ensureRepo(pi, ctx))) return;

			const current = (await git(pi, ["branch", "--show-current"], ctx.cwd)).stdout.trim();
			if (!current) return ctx.ui.notify("Not on a branch (detached HEAD?)", "error");

			// Parse mode: --soft, --mixed (default), --hard
			const modeFlags = ["--soft", "--mixed", "--hard"];
			let mode = "--mixed";
			const modeArg = args.trim();
			if (modeFlags.includes(modeArg)) mode = modeArg;

			// Get recent commits
			const log = await git(pi, [
				"log", "--oneline", "--no-color", "-n", "20"
			], ctx.cwd);
			if (log.code !== 0) return ctx.ui.notify(`git log failed:\n${log.stderr}`, "error");

			const commits = log.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
			if (commits.length === 0) {
				ctx.ui.notify("No commits found", "warning");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("Commits:\n" + commits.join("\n"), "info");
				return;
			}

			const choice = await ctx.ui.select("Reset to commit", commits);
			if (!choice) return;

			const hash = choice.split(" ")[0];
			const shortMsg = choice.split(" ").slice(1).join(" ");

			const modeLabel = mode === "--hard" ? "HARD (discard all changes)"
				: mode === "--soft" ? "SOFT (keep changes staged)"
				: "MIXED (keep changes unstaged)";

			const confirm = await ctx.ui.select(
				`${modeLabel} reset to ${hash} "${shortMsg}"?`,
				["Yes, reset", "No, cancel"]
			);
			if (confirm !== "Yes, reset") {
				ctx.ui.notify("Reset cancelled", "info");
				return;
			}

			const r = await git(pi, ["reset", mode, hash], ctx.cwd);
			if (r.code !== 0) return ctx.ui.notify(`Reset failed:\n${r.stderr}`, "error");
			ctx.ui.notify(`Reset (${mode}) to ${hash}`, "info");
		},
	});

	// /ezgit-to-latest — release flow:
	//   1. commit current work (if dirty)
	//   2. switch to master/main
	//   3. merge the highest version-* branch into it
	//   4. tag the next version-1.x.x (auto-bumped, confirmable, or /ezgit-to-latest 1.2.3)
	pi.registerCommand("ezgit-to-latest", {
		description: "Commit, merge highest version branch into master/main, tag next version",
		handler: async (args, ctx) => {
			if (!(await ensureRepo(pi, ctx))) return;

			const commitResult = await commitCurrentBranch(pi, ctx);
			if (commitResult === "failed" || commitResult === "cancelled") return;

			const base = await defaultBranch(pi, ctx.cwd);
			if (!base) return ctx.ui.notify("No master/main branch found", "error");

			const branches = await localBranches(pi, ctx.cwd);
			const latest = findLatestVersionBranch(branches);
			if (!latest) return ctx.ui.notify("No version-* branch found", "warning");

			const current = (await git(pi, ["branch", "--show-current"], ctx.cwd)).stdout.trim();
			if (current !== base) {
				const sw = await git(pi, ["switch", base], ctx.cwd);
				if (sw.code !== 0) return ctx.ui.notify(`Switch to ${base} failed:\n${sw.stderr}`, "error");
			}

			const mg = await git(pi, ["merge", latest], ctx.cwd);
			if (mg.code !== 0) return ctx.ui.notify(`Merge ${latest} failed:\n${mg.stderr}`, "error");

			// Next version tag: bump the highest version-* ref (tag or branch)
			const tags = (await git(pi, ["tag", "--list", "version-*"], ctx.cwd)).stdout
				.split("\n").map((s) => s.trim()).filter(Boolean);
			const existing = new Set([...branches, ...tags]);
			const highest = findLatestVersionBranch([...branches, ...tags]);
			let proposed = highest ? bumpVersion(parseVersion(highest)!) : "version-1.0.1";
			let guard = 0;
			while (existing.has(proposed) && guard++ < 20) proposed = bumpVersion(parseVersion(proposed)!);

			let tagName = "";
			const explicit = args.trim();
			if (explicit) {
				tagName = explicit.startsWith("version-") ? explicit : `version-${explicit}`;
			} else if (ctx.hasUI) {
				tagName = (await ctx.ui.input("Version tag", proposed))?.trim() ?? "";
			}
			if (!tagName) {
				ctx.ui.notify(`Merged ${latest} into ${base} — not tagged (next: ${proposed})`, "warning");
				return;
			}

			const t = await git(pi, ["tag", "-a", tagName, "-m", tagName], ctx.cwd);
			if (t.code !== 0) return ctx.ui.notify(`Tag failed:\n${t.stderr}`, "error");
			ctx.ui.notify(`Merged ${latest} into ${base}, tagged ${tagName}`, "info");
		},
	});

	// /ezgit-help — list all ezgit commands
	pi.registerCommand("ezgit-help", {
		description: "Show ezgit commands and descriptions",
		handler: async (_args, ctx) => {
			const items = [
				"/ezgit-branch — list branches in a menu, pick one to switch",
				"/ezgit-commit — stage all changes and commit the current branch",
				"/ezgit-push — push the current branch to its upstream remote",
				"/ezgit-create-branch — create a new branch from a selected source branch",
				"/ezgit-delete-branch — delete a local branch (confirmation, blocks main/master)",
				"/ezgit-reset — reset current branch to a past commit (with confirmation)",
				"/ezgit-to-latest — commit work, merge the highest version-* branch into master/main, tag the next version-1.x.x",
				"/ezgit-help — this list",
			];
			if (!ctx.hasUI) {
				console.log(items.join("\n"));
				return;
			}
			await ctx.ui.select("ezgit commands", items); // scroll/dismiss, no action
		},
	});
}
