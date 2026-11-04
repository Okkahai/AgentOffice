<h1 align="center">Agent Office</h1>

<p align="center">
  <b>Give one goal to several real coding agents. Watch every change, review and merge.</b><br>
  A local-first workspace where autonomous agents propose, and deterministic code enforces safety.
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-workspace%20foundation-orange">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A522.18-339933">
  <img alt="tests" src="https://img.shields.io/badge/tests-51%20passing-brightgreen">
  <img alt="api keys" src="https://img.shields.io/badge/API%20keys-none%20needed-blue">
</p>

---

## What it does

Give Agent Office a goal. The Manager turns it into a validated task graph; for each task it creates an isolated Git worktree, starts a real agent process in it, and runs the result through a fixed pipeline before anything touches your main branch:

```
 task ─▶ worktree ─▶ agent ─▶ commit ─▶ verify ─▶ independent review
                                                        │
   result ◀─ post-merge verify ◀─ auto-merge ◀─ pre-merge backup
```

Every step is recorded in SQLite. Every automatic merge has a recoverable pre-merge state, and rollback needs nothing but that recorded state.

<p align="center"><img src="docs/screenshots/workspace.png" alt="Agent Office workspace: pipeline, sessions, task graph, live agent terminal and event log" width="900"></p>

> **Status:** the core loop, the Manager, goal entry from the UI, an independent Claude Code reviewer and the workspace UI, several repositories in one window and a dedicated merge worktree work. Sandboxing and the Electron app are next. Feature-by-feature state: [docs/DEVELOPMENT_PROGRESS.md](docs/DEVELOPMENT_PROGRESS.md).

## Guarantees (enforced in code, not by prompting)

| Guarantee | How |
|---|---|
| Agents never work in your main tree | One branch + worktree per task, outside the repo; any write to the main tree fails the task |
| No merge without a backup | `refs/heads/backup/pre-merge-<time>-task-<id>` is created, re-read and compared before merging; backup failure aborts |
| No merge on stale or unverified state | Target head, source commit, backup, clean tree, passed checks and approved review are all re-checked at merge time |
| Agent claims are not evidence | Checks (`test`, `typecheck`, `lint`, `build`) are actually run, before and after the merge |
| Author does not review own work | The reviewer id must differ from the implementing agent |
| Rollback is deterministic | `reset` to the recorded backup sha, only if the target still points at the merge |
| No paid inference API | Agents are CLI processes using your existing login; `*_API_KEY`/`*_TOKEN`/`*_SECRET` are stripped from their environment |

## Quick start

Requirements: Node.js 22.18 or newer, Git.

```bash
npm install
npm test           # 51 tests on disposable temp repos
npm run typecheck
npm run demo       # full loop on a throwaway repo, prints the event trail
npm run ui         # workspace UI on a throwaway repo with scripted agents: http://127.0.0.1:4173
```

Run on one of your repositories with real agents (their own logins; state and worktrees go to `~/.agent-office/<repo>`; the repository must be clean and on the target branch):

```bash
npm start -- path/to/repo --agent claude --branch main   # then open http://127.0.0.1:4174
npm start -- path/to/api path/to/web                      # several repositories, one project each
```

Run one task with a real agent CLI on a throwaway repo:

```bash
node scripts/real-agent.ts claude      # or: codex | opencode
```

<details>
<summary>Windows notes</summary>

- PowerShell stub run: `$env:AGENT_OFFICE_FAKE=1; node scripts/real-agent.ts` (cmd: `set AGENT_OFFICE_FAKE=1 && node scripts/real-agent.ts`).
- `node-pty` has install scripts. If npm warns about `allow-scripts`, run `npm approve-scripts node-pty` then `npm rebuild node-pty`.
- The suite has not been run on Windows by the author; please report failures with the first failing block.
</details>

## Architecture

```
UI (web now) ─ HTTP/SSE ─▶  Event / State  ─▶  Orchestrator  ─▶  Task engine
                                                                     │
                       Repository / worktrees ◀─ Git control plane ◀─ Agent runtime
```

| Piece | File |
|---|---|
| Typed events (also the audit log) | `src/core/events.ts` |
| Explicit task state machine | `src/core/taskMachine.ts` |
| SQLite state (`node:sqlite`) | `src/core/store.ts` |
| Pipeline, scheduler, recovery | `src/core/orchestrator.ts` |
| Verification and review gates | `src/core/verify.ts`, `src/core/review.ts` |
| Worktrees, backup, merge, rollback, policy | `src/git/*` |
| Agent providers (pipes, PTY, CLI detection) | `src/agents/*` |
| Manager: plan validation, Claude planner | `src/manager/*` |
| Manager and independent reviewer (Claude Code, read-only) | `src/manager/claudePlanner.ts`, `src/manager/claudeReviewer.ts` |
| Local UI server (HTTP + SSE, token-protected actions) | `src/server/server.ts` |
| Workspace UI: views, inspector, palette; pure derivations | `ui/app.js`, `ui/model.js` |
| Real-repository launcher | `scripts/app.ts` |

Task lifecycle: `QUEUED → ASSIGNED → WORKING → VERIFYING → REVIEWING → READY_TO_MERGE → MERGING → COMPLETED`, plus `BLOCKED`, `FAILED`, `CONFLICT`, `CANCELLED`. Illegal transitions throw.

Full design, stack decisions and the Electron IPC boundary: [docs/architecture.md](docs/architecture.md). Phases: [docs/plan.md](docs/plan.md). Visual rules: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md). Other tools compared: [docs/COMPETITIVE_ANALYSIS.md](docs/COMPETITIVE_ANALYSIS.md).

## What is tested

51 tests, all on disposable temp repositories: worktree isolation and parallelism, path and symlink validation, task dependencies, process termination and timeouts, backup creation and backup failure, merge with stale target / wrong backup / dirty tree, conflicts, failed pre- and post-merge verification, rollback, isolation breach, PTY sessions, and restart recovery at three crash points, the UI API (detail, diff, goal), strict parsing of reviewer output and the UI's state derivations.

## Roadmap

- [x] Git control plane, state machine, SQLite, verification, review gate, backup, merge, rollback, recovery
- [x] Provider interface, pipe and PTY providers, Claude Code / Codex / OpenCode detection and argv
- [x] First verified run with a real CLI agent (Claude Code via PTY on Windows: worktree → agent → verify → review → backup → merge → post-verify, `COMPLETED`)
- [x] Manager agent: goal → validated, dependency-aware task graph (deterministic gate)
- [x] Workspace UI: overview, attention inbox, sessions, task graph, reviews, git, activity, inspector (terminal, diff, review, events), command palette
- [x] Goal entry from the UI, independent Claude Code reviewer, `npm start` on a real repository
- [x] Dedicated merge worktree (your working tree is never merged into)
- [ ] OS-level sandboxing and permission profiles
- [x] Multi-project workspace
- [ ] Interactive sessions, desktop notifications
- [ ] Electron packaging (typed IPC), GitHub PR workflow

## Known limits

Agents are not OS-sandboxed yet (escapes into the main tree are detected, not prevented). Merges run in a dedicated merge worktree; if you have the target branch checked out, that tree must be clean so it can be fast-forwarded. The unattended CLI flags (`--permission-mode acceptEdits`, `--full-auto`) are a decision to revisit before real use. A failed post-merge check keeps the merge and offers rollback; it does not roll back on its own.
