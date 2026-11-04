# Agent Office: architecture

Principle: **agents propose, deterministic software enforces.** Agents influence decomposition, code, analysis and review. They never control Git safety, backups, filesystem boundaries, protected operations or the audit trail.

```
UI (browser now, Electron later) -- views of real state + user intents   ui/*
  ↓ local HTTP + SSE today (token-protected); typed IPC under Electron
Event / State layer             -- EventBus + SQLite (events are the audit trail)
  ↓
Orchestrator                    -- pipeline + scheduler + recovery        src/core/orchestrator.ts
  ↓
Task engine                     -- explicit state machine, dependencies   src/core/taskMachine.ts, store.ts
  ↓
Agent runtime                   -- AgentProvider (real processes)         src/agents/provider.ts
  ↓
Git control plane               -- worktrees, backup, merge, rollback     src/git/*
  ↓
Repository / worktrees
```

The UI never touches Git or the OS. It is a subscriber of `EventBus` and a reader of persisted evidence.

## Stack decisions

| Area | Decision | Why |
|---|---|---|
| Language | TypeScript, run directly by Node 22 type stripping (`node --test`, no build step) | Zero toolchain for the core; `tsc --noEmit` for typechecking |
| DB | SQLite via built-in `node:sqlite` | No native addon to rebuild for Electron. Revisit (`better-sqlite3`) only if the experimental API becomes a problem |
| Git | System `git` via `execFile` with argv arrays, no shell | Deterministic, auditable |
| Agent processes | `AgentProvider` with two implementations: `CommandProvider` (pipes, used by the orchestrator tests) and `PtyProvider` (`node-pty`, for interactive terminals) | `node-pty` is native and needs an Electron rebuild when the shell lands |
| UI | Plain ES modules + xterm.js, served by the local server | No build step, one dependency. React was considered; the UI is a few views over JSON, so a framework and bundler add toolchain without removing code. Revisit if the component count grows. |

No paid inference API is used anywhere. Agents are CLI processes (Claude Code, Codex, OpenCode) using the user's own logins; `scrubbedEnv` strips `*_API_KEY/_TOKEN/_SECRET/PASSWORD` from agent environments.

## Task state machine

`QUEUED → ASSIGNED → WORKING → VERIFYING → REVIEWING → READY_TO_MERGE → MERGING → COMPLETED`
Exceptional: `BLOCKED` (dependency failed), `FAILED`, `CONFLICT`, `CANCELLED`. `FAILED → QUEUED` is an explicit retry. Only `Store.transition()` changes status and it validates against the table in `taskMachine.ts`. There is no path that skips VERIFYING/REVIEWING/backup.

## Auto-merge pipeline

1. **Worktree.** Git service creates `agent/task-<id>-<slug>` at `<worktreesDir>/task-<id>` from the target head. `worktreesDir` must be outside the repo. Ids and paths are validated (`paths.ts`, symlinks resolved).
2. **Agent** runs with cwd = worktree, timeout, process-group kill. After exit the main tree must still be clean (isolation-breach check).
3. **Commit** in the worktree. Refuses empty commits and `.git/` / `.agent-office/` paths.
4. **Verify** by running the repository's own checks (`lint`, `typecheck`, `test`, `build` scripts from `package.json`, only if present). Results stored per task/phase.
5. **Independent review.** `Reviewer` returns `{approved, blockingIssues, warnings, summary}`. A deterministic reviewer always runs (empty diff, failed verification); `ClaudeReviewer` (a separate Claude Code process in read-only plan mode that only sees the task, the verification result and the diff) is composed on top. Its output is parsed strictly: malformed output or any blocking issue means not approved. Reviewer id must differ from the implementing agent.
6. **Merge gate** (re-derived from persisted evidence and live Git, not agent claims): verification passed, review approved, worktree HEAD == verified commit, target ref resolves, no conflict (`git merge-tree`).
7. **Backup.** `refs/heads/backup/pre-merge-<UTC stamp>-task-<id>` created with an expect-not-exists `update-ref`, then re-read and compared to the target sha. Persisted (task, target branch+sha, source branch+sha, ref, time). Failure aborts the merge.
8. **Merge** (`--no-ff`) in the main tree, serialized by a per-repo lock. Preconditions in `GitService.merge`: target checked out, clean tree, head == expected sha, backup ref == expected sha, source exists. Conflict → abort, `CONFLICT`.
9. **Post-merge verification** on the merged tree. Success → `merge.success`, `COMPLETED`, worktree removed. Failure → `merge.verification_failed`, task `FAILED`; merged commit, backup, logs, review and diff are all kept.
10. **Rollback** (`Orchestrator.rollback`) uses only persisted state: refuses unless the target still points at the merged commit, the tree is clean and the backup ref still equals the recorded sha; then `reset --hard <backup sha>`. Rollback is user-triggered, never silent.

The merge runs in a dedicated detached worktree at `<worktrees>/merge`, reset to the expected target commit each time (ignored files such as installed dependencies are kept). The target branch then moves from the expected sha to the merge commit: by `git merge --ff-only` in the worktree that has it checked out, which must be clean, or by a compare-and-swap `update-ref` when no worktree has it. Rollback moves it back the same way. Post-merge checks run on the merged commit in the merge worktree, so the user's own tree is never used for merging or verification.

## Protected operations

`GitService` has no method to force-push, delete protected branches, delete backups, or rewrite shared history; `deleteAgentBranch` only accepts `agent/task-*`. `policy.ts` is the deny-by-default allowlist for agent-requested Git operations. Agents are not OS-sandboxed in this slice (see Phase 2); we detect and fail escapes into the main tree, and do not yet prevent them.

## Events and audit

Typed `EventType` union in `events.ts` (a subset of the brief's list is implemented; the rest is added as producers appear). Every event is persisted in `events` (this doubles as the audit log). Subscriber errors are swallowed.

## Persistent state (SQLite)

`tasks`, `task_deps`, `verification_runs`, `reviews`, `backups`, `merges`, `messages` (mailbox), `events`. Agents/sessions/worktrees/projects are not separate tables yet: the brief says not to add tables speculatively, and single-project MVP state fits on `tasks`.

**Recovery** (`Orchestrator.recover()`): tasks interrupted in `ASSIGNED/WORKING/VERIFYING/REVIEWING` are requeued with a fresh worktree; `MERGING` is reconciled against Git (merge present → resume post-merge verify; absent → `READY_TO_MERGE`, merge row `aborted`).

## Agent provider interface

`spawn(req) → AgentHandle { getStatus, sendInput, interrupt, terminate, subscribeOutput, exited }`. `CommandProvider`/`PtyProvider` run any argv. `src/agents/cliAgents.ts` is the only place that knows Claude Code / Codex / OpenCode: PATH detection (no shell) and one-shot argv builders. The unattended flags (`--permission-mode acceptEdits`, `--full-auto`) are a security decision to revisit before real runs; not exercised by tests. Tests use a scripted fake agent (`test/fixtures/fake-agent.mjs`), a real OS process, so CI needs no AI CLI or keys.

## Manager

`src/manager/plan.ts`: the Manager (Claude Code in read-only plan mode, `ClaudePlanner`) proposes JSON. `validatePlan` is the deterministic gate: bounded task count (smallest useful team), unique kebab-case keys, known dependencies, no cycles. Only a validated plan reaches `Orchestrator.createTask`. An invalid proposal creates no tasks.

## Workspace UI (local web UI, Electron later)

`src/server/server.ts` serves `ui/` and streams the persisted event trail plus live events and terminal output over SSE. It binds `127.0.0.1`, rejects foreign `Host` headers (DNS rebinding), sends no CORS headers, and protects every mutation with a per-run token: `POST /api/goal` (Manager), `POST /api/tasks/:id/cancel`, `POST /api/tasks/:id/rollback`. Read endpoints: `/api/state`, `/api/tasks/:id/detail` (verification runs, reviews, backups, merge, events), `/api/tasks/:id/diff` (live worktree diff while a task runs, otherwise the committed range via `GitService.diffCommits`). Actions call `Orchestrator` methods, so the UI cannot bypass the state machine.

Threat model of the local endpoint: any local process can read state (same as reading the SQLite file); writes need the token, which is only delivered to pages served from the bound origin. It is not safe to expose beyond loopback.

`ui/model.js` holds the pure derivations (pipeline counts, agent process state from `agent.*` events, attention inbox, goal state, graph layout, event text), tested in Node. `ui/app.js` renders the views: Overview, Inbox, Sessions, Tasks (graph and table), Reviews, Git, Activity, the task inspector (terminal, diff, review, events) and the Ctrl+K command palette. Nothing is inferred beyond what events and stored rows say; an agent is RUNNING only between `agent.spawned` and its exit event. Visual rules: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

`scripts/app.ts` (`npm start -- <repo>`) runs Agent Office on a real repository: state and worktrees in `~/.agent-office/<repo-name>`, `recover()` at start, the selected CLI for engineers, `ClaudePlanner` for goals and `ClaudeReviewer` for independent review. One runner loop at a time; tasks from a goal entered while it runs start when one of the running tasks finishes (the loop re-reads the queue then).

Electron is still last: it only wraps this UI (main process owns the orchestrator, preload exposes the fixed API below) and `node-pty` needs a native rebuild against Electron.

## Electron IPC boundary (design, not built)

- Main process owns Orchestrator, Store, GitService, providers. Renderer has `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes a fixed typed API (`getState`, `subscribeEvents`, `createGoal`, `sendMessage`, `sendTerminalInput`, `interrupt`, `terminate`, `rollback`). No generic `invoke(channel)`, no fs/git/shell access.
- Every IPC handler validates its payload (schema) and resolves ids server-side; the renderer never supplies paths or commands. Terminal input goes to the agent PTY only, never to a shell in the main repo.
- Manual user actions call the same Orchestrator methods as the automated flow, so they cannot bypass the state machine.

## Future (extension points only)

Ops mode = new event sources (Docker, CI, Prometheus) that emit `incident.*` events and create fix tasks through the same pipeline. Remote mode = same core behind a server with PostgreSQL; local mode never requires it.
