# Architecture (agent handoff view)

The authoritative description is [docs/architecture.md](../architecture.md) (layers, state machine, merge pipeline, recovery, server, desktop). Not repeated here. This file adds a module map, interfaces and things that file does not say. Verified against source on `main` `c87cf0b` unless noted.

## Module map

| Path | Role |
|---|---|
| `src/core/events.ts` | typed `EventType`, `EventBus`; every event persisted by `Store` |
| `src/core/taskMachine.ts`, `store.ts` | state table, SQLite (`tasks`, `task_deps`, `verification_runs`, `reviews`, `backups`, `merges`, `messages`, `events`) |
| `src/core/orchestrator.ts` | pipeline, scheduler, `recover()`, `rollback()`, `retry`, isolation check |
| `src/core/verify.ts`, `review.ts` | discovered `lint/typecheck/test/build` scripts; deterministic reviewer composed with agent reviewer |
| `src/git/*` | `GitService` (no force-push/delete-protected/backup delete), `paths.ts`, `policy.ts` |
| `src/agents/provider.ts` | `AgentProvider.spawn → AgentHandle {getStatus, sendInput, interrupt, terminate, subscribeOutput, exited}`; `CommandProvider` (pipes) |
| `src/agents/ptyProvider.ts` | `node-pty` provider |
| `src/agents/cliAgents.ts` | only place that knows Claude Code/Codex/OpenCode: detection, argv, deny-rule settings, `agentIsolation`, `parseProfile` |
| `src/manager/*` | `validatePlan` gate, `ClaudePlanner`, `ClaudeReviewer` |
| `src/server/server.ts` | loopback HTTP + SSE. Routes seen: `/api/state`, `/api/events` (SSE), `/api/goal`, `/api/tasks/:id/{detail,diff,cancel,rollback,retry}`; all take `?project=` |
| `ui/` | `model.js` pure derivations (tested), `app.js` views, `style.css` tokens |
| `desktop/` | `main.cjs`, `preload.cjs` |
| `scripts/app.ts` | real-repo launcher (`npm start`); `demo.ts`, `ui-demo.ts`, `real-agent.ts` |

## Not in architecture.md

- **Agent isolation tiers**: `agentIsolation()` returns `os-sandbox` (macOS, Linux/WSL2 with bubblewrap for Claude Code; Codex `--full-auto` workspace-write), `permission-rules` (native Windows Claude Code), or `none` (OpenCode). Shown per project in the sidebar. Every Claude Code engineer gets `--settings` with permanent deny rules (push, remote, config, curl/wget/ssh/scp, WebFetch/WebSearch, secrets paths, `.env`) and bypass mode disabled.
- **WSL runner** (branch only, unmerged — T-01): `WslProvider` wraps another provider; `wslPlan` writes `args` (NUL-separated) and `run.sh` into `<worktree>.tmp/` and invokes `wsl.exe -d <distro> --cd /mnt/<drive>/... -e sh .../run.sh`; the control plane, Git and verification stay on Windows.
- **Windows process handling**: npm/claude `.cmd` shims resolved to their `.js`/`.exe` and spawned without a shell; PATHEXT honoured; PTY opt-in.
- **Data layout**: `~/.agent-office/<repo-name>/{state.db, worktrees/task-<id>, worktrees/merge, profile.json}` and `~/.agent-office/bin`; worktrees outside the repo. Repo name collisions between two repos with the same folder name are not handled [?].
- **Desktop**: repo list in Electron userData (`Agent Office` folder); `AO_REPO`, `AO_NODE` env overrides.
- **Known divergences from the briefs**: no React/PixiJS (D-04); no typed IPC (HTTP+token instead, preload has one call); one DB per repo rather than a projects table; no `Agent`/`Session`/`Worktree` tables.
