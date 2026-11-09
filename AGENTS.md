# AGENTS.md — Agent Office (provider-neutral rules)

For any coding agent (Claude Code, Codex CLI, OpenCode, others) or coordinator working in this repository.
Read this first, then [docs/agent/HANDOFF.md](docs/agent/HANDOFF.md) (state, next actions) and [docs/agent/TASK_REGISTRY.md](docs/agent/TASK_REGISTRY.md).

## What this is

Agent Office is a **local-first control center for real AI coding agents**: one goal → Manager proposes a validated task graph → each task runs a real CLI agent in an isolated Git worktree → verify → independent review → mandatory pre-merge backup → merge → post-merge verify → rollback available. Primary platform: Windows 11. No paid inference API is ever required; agents are CLIs using the user's own logins.

Governing principle: **agents propose, deterministic software enforces.** Safety (Git boundaries, backups, filesystem boundaries, protected operations, audit trail) is code, never a prompt.

## Commands

```bash
npm install           # Node >= 22.18, Git. node-pty and electron have install scripts (see README for Windows notes)
npm run typecheck     # tsc --noEmit
npm test              # node --test, all Git tests use disposable temp repos
npm run demo          # full loop on a throwaway repo, prints event trail
npm run ui            # scripted-agent demo UI on :4173 (throwaway repo)
npm start -- <repo> [<repo> ...] [--agent claude|codex|opencode] [--branch main] [--port 4174]
npm run desktop       # Electron window over the same local server
```

No build step: TypeScript runs directly through Node type stripping. Test counts vary by platform and by whether `node-pty` built (observed 57 on Linux with `--ignore-scripts`, 56 on Windows with PTY tests skipped); judge by `fail 0`, not by a number.

## Layout

`src/core` (events, SQLite store, task state machine, orchestrator, verify, review) · `src/git` (GitService, path validation, policy) · `src/agents` (provider interface, CLI argv/detection/isolation, PTY) · `src/manager` (plan validator, ClaudePlanner, ClaudeReviewer) · `src/server` (loopback HTTP+SSE) · `ui/` (plain ES modules + xterm.js) · `desktop/` (Electron shell) · `scripts/` · `test/`. Details: [docs/architecture.md](docs/architecture.md), [docs/agent/ARCHITECTURE.md](docs/agent/ARCHITECTURE.md).

## Non-negotiable invariants (do not weaken, bypass, or "simplify away")

1. Implementation agents never work in the user's main tree; one branch + worktree per task, outside the repo.
2. No merge without a verified pre-merge backup ref (`backup/pre-merge-<UTC>-task-<id>`); backup failure aborts the merge.
3. Merge gate is re-derived from persisted evidence and live Git: verification passed, review approved, worktree HEAD == verified commit, target head == expected, no conflict, clean tree.
4. The reviewer must be independent of the implementing agent; malformed reviewer output or any blocking finding means not approved.
5. Task status changes only through `Store.transition()` and the table in `taskMachine.ts`. No path skips VERIFYING / REVIEWING / backup.
6. `GitService` has no force-push, no protected-branch delete, no backup delete, no history rewrite. `policy.ts` is deny-by-default.
7. Git runs through `execFile` with argv arrays, never a shell string. Windows `.cmd` shims are resolved to their real target and run without a shell.
8. Agent environments are scrubbed (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, `PASSWORD`). Project `profile.json` is an allowlist (`agent`, `model`, `branch`, `wsl`); it must never accept permission-bypass or sandbox-disabling flags, and lives outside the repo.
9. The local server binds 127.0.0.1, rejects foreign `Host`, sends no CORS, and requires a per-run token for every mutation. Never expose it beyond loopback.
10. Do not claim isolation the platform does not give. Native Windows has **no** Claude Code OS sandbox; the UI says "rules only" there. Restrict autonomy instead of overstating the boundary.
11. The UI shows only real state (events, rows, process lifecycle). No fake activity, metrics, progress or animation. An agent is RUNNING only between `agent.spawned` and its exit event.

## Working rules

- Dangerous Git tests run only on disposable repositories. Never run destructive Git against the developer's real repo or `~/.agent-office/<repo>` data of a real project.
- "Done" means evidence: tests, typecheck, a recorded real or stub run, Git state inspected. A thread or agent saying "done" is not evidence. Record evidence in [docs/agent/VERIFICATION.md](docs/agent/VERIFICATION.md) and the matching row of `docs/DEVELOPMENT_PROGRESS.md`.
- Prefer the simplest change that meets known requirements (YAGNI). No new dependency for a few lines. No framework/bundler for the UI without a recorded reason (see DECISIONS D-04).
- Visual direction is **Black Terminal × precise UI** ([docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)). Pixel-art/office-game visuals were tried and rejected (D-07); do not reintroduce.
- Use `branch → PR → checks → merge`. Standing owner rule (2026-11-05, see PROJECT_STATE): if tests, typecheck and independent review pass, merge your own PR without asking; still ask before spending, credentials, production, or destructive/irreversible actions outside the repo. Never force-push or delete `main` or `backup/*`.
- Never commit secrets, tokens, `.env`, user data directories, or third-party assets whose licence forbids redistribution.
- When behaviour or status changes, update the single authoritative doc (do not create a second one): status → `docs/DEVELOPMENT_PROGRESS.md`; architecture → `docs/architecture.md`; decisions → `docs/agent/DECISIONS.md`; tasks → `docs/agent/TASK_REGISTRY.md`.
