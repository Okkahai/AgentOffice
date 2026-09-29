# Agent Office: architecture

Principle: **agents propose, deterministic software enforces.** Agents influence decomposition, code, analysis and review. They never control Git safety, backups, filesystem boundaries, protected operations or the audit trail.

```
UI (Electron renderer, later)   -- read-only view + user intents
  ↓ typed IPC (preload, allowlisted channels)
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

The UI never touches Git or the OS. Business logic never depends on animations: the office (later) is a subscriber of `EventBus`.

## Stack decisions

| Area | Decision | Why |
|---|---|---|
| Language | TypeScript, run directly by Node 22 type stripping (`node --test`, no build step) | Zero toolchain for the core; `tsc --noEmit` for typechecking |
| DB | SQLite via built-in `node:sqlite` | No native addon to rebuild for Electron. Revisit (`better-sqlite3`) only if the experimental API becomes a problem |
| Git | System `git` via `execFile` with argv arrays, no shell | Deterministic, auditable |
| Agent processes | `AgentProvider` with two implementations: `CommandProvider` (pipes, used by the orchestrator tests) and `PtyProvider` (`node-pty`, for interactive terminals) | `node-pty` is native and needs an Electron rebuild when the shell lands |
| UI (later) | Electron + React + PixiJS + xterm.js | As briefed; not started |

No paid inference API is used anywhere. Agents are CLI processes (Claude Code, Codex, OpenCode) using the user's own logins; `scrubbedEnv` strips `*_API_KEY/_TOKEN/_SECRET/PASSWORD` from agent environments.

## Task state machine

`QUEUED → ASSIGNED → WORKING → VERIFYING → REVIEWING → READY_TO_MERGE → MERGING → COMPLETED`
Exceptional: `BLOCKED` (dependency failed), `FAILED`, `CONFLICT`, `CANCELLED`. `FAILED → QUEUED` is an explicit retry. Only `Store.transition()` changes status and it validates against the table in `taskMachine.ts`. There is no path that skips VERIFYING/REVIEWING/backup.

## Auto-merge pipeline

1. **Worktree.** Git service creates `agent/task-<id>-<slug>` at `<worktreesDir>/task-<id>` from the target head. `worktreesDir` must be outside the repo. Ids and paths are validated (`paths.ts`, symlinks resolved).
2. **Agent** runs with cwd = worktree, timeout, process-group kill. After exit the main tree must still be clean (isolation-breach check).
3. **Commit** in the worktree. Refuses empty commits and `.git/` / `.agent-office/` paths.
4. **Verify** by running the repository's own checks (`lint`, `typecheck`, `test`, `build` scripts from `package.json`, only if present). Results stored per task/phase.
5. **Independent review.** `Reviewer` returns `{approved, blockingIssues, warnings, summary}`. A deterministic reviewer always runs (empty diff, failed verification); an agent/QA reviewer is composed on top. Reviewer id must differ from the implementing agent.
6. **Merge gate** (re-derived from persisted evidence and live Git, not agent claims): verification passed, review approved, worktree HEAD == verified commit, target ref resolves, no conflict (`git merge-tree`).
7. **Backup.** `refs/heads/backup/pre-merge-<UTC stamp>-task-<id>` created with an expect-not-exists `update-ref`, then re-read and compared to the target sha. Persisted (task, target branch+sha, source branch+sha, ref, time). Failure aborts the merge.
8. **Merge** (`--no-ff`) in the main tree, serialized by a per-repo lock. Preconditions in `GitService.merge`: target checked out, clean tree, head == expected sha, backup ref == expected sha, source exists. Conflict → abort, `CONFLICT`.
9. **Post-merge verification** on the merged tree. Success → `merge.success`, `COMPLETED`, worktree removed. Failure → `merge.verification_failed`, task `FAILED`; merged commit, backup, logs, review and diff are all kept.
10. **Rollback** (`Orchestrator.rollback`) uses only persisted state: refuses unless the target still points at the merged commit, the tree is clean and the backup ref still equals the recorded sha; then `reset --hard <backup sha>`. Rollback is user-triggered, never silent.

Known limitation: the merge happens in the user's main working tree, so it needs that tree clean and on the target branch. A dedicated merge worktree is a later option.

## Protected operations

`GitService` has no method to force-push, delete protected branches, delete backups, or rewrite shared history; `deleteAgentBranch` only accepts `agent/task-*`. `policy.ts` is the deny-by-default allowlist for agent-requested Git operations. Agents are not OS-sandboxed in this slice (see Phase 2); we detect and fail escapes into the main tree, and do not yet prevent them.

## Events and audit

Typed `EventType` union in `events.ts` (a subset of the brief's list is implemented; the rest is added as producers appear). Every event is persisted in `events` (this doubles as the audit log). Subscriber errors are swallowed.

## Persistent state (SQLite)

`tasks`, `task_deps`, `verification_runs`, `reviews`, `backups`, `merges`, `messages` (mailbox), `events`. Agents/sessions/worktrees/projects are not separate tables yet: the brief says not to add tables speculatively, and single-project MVP state fits on `tasks`.

**Recovery** (`Orchestrator.recover()`): tasks interrupted in `ASSIGNED/WORKING/VERIFYING/REVIEWING` are requeued with a fresh worktree; `MERGING` is reconciled against Git (merge present → resume post-merge verify; absent → `READY_TO_MERGE`, merge row `aborted`).

## Agent provider interface

`spawn(req) → AgentHandle { getStatus, sendInput, interrupt, terminate, subscribeOutput, exited }`. `CommandProvider`/`PtyProvider` run any argv. `src/agents/cliAgents.ts` is the only place that knows Claude Code / Codex / OpenCode: PATH detection (no shell) and one-shot argv builders. The unattended flags (`--permission-mode acceptEdits`, `--full-auto`) are a security decision to revisit before real runs; not exercised by tests. Tests use a scripted fake agent (`test/fixtures/fake-agent.mjs`), a real OS process, so CI needs no AI CLI or keys.

## Electron IPC boundary (design, not built)

- Main process owns Orchestrator, Store, GitService, providers. Renderer has `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes a fixed typed API (`getState`, `subscribeEvents`, `createGoal`, `sendMessage`, `sendTerminalInput`, `interrupt`, `terminate`, `rollback`). No generic `invoke(channel)`, no fs/git/shell access.
- Every IPC handler validates its payload (schema) and resolves ids server-side; the renderer never supplies paths or commands. Terminal input goes to the agent PTY only, never to a shell in the main repo.
- Manual user actions call the same Orchestrator methods as the automated flow, so they cannot bypass the state machine.

## Future (extension points only)

Ops mode = new event sources (Docker, CI, Prometheus) that emit `incident.*` events and create fix tasks through the same pipeline. Remote mode = same core behind a server with PostgreSQL; local mode never requires it.
