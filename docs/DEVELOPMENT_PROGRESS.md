# Development progress

Last updated 2026-11-04. Evidence: `npm test` 56/56 passing and `npm run typecheck` clean on Linux (Node 22.23). The Windows run of the suite is still pending for this revision.

## Feature inventory

Legend: **VERIFIED** = implemented and covered by tests or a recorded real run. **IMPLEMENTED** = works, checked by hand or by a demo, no automated test. **PARTIAL** = some of the requirement. **NOT IMPLEMENTED**. **NEEDS REWORK**.

| Area | State | Evidence / gap |
|---|---|---|
| Typed events, persisted audit trail | VERIFIED | `orchestrator.test.ts`, `server.test.ts` (SSE replay) |
| Task state machine, dependencies, blocking | VERIFIED | `taskMachine.test.ts`, `orchestrator.test.ts` |
| SQLite state, restart recovery (3 crash points) | VERIFIED | `orchestrator.test.ts` |
| Worktree isolation, path and symlink validation | VERIFIED | `git.test.ts`, `orchestrator.test.ts`; escapes into the main tree are detected and fail the task, not prevented. Detection compares the main tree before and after each run, so the user's existing uncommitted work is allowed, but edits the user makes there during a run are also flagged |
| Verification before and after merge | VERIFIED | `orchestrator.test.ts` |
| Mandatory verified pre-merge backup, merge gates, conflicts | VERIFIED | `git.test.ts`, `orchestrator.test.ts` |
| Rollback from persisted evidence | VERIFIED | `git.test.ts`, `server.test.ts` |
| Claude Code / Codex / OpenCode detection and argv | VERIFIED | `provider.test.ts`; one real Claude Code run on Windows recorded earlier (README) |
| PTY sessions | VERIFIED | `pty.test.ts` |
| Manager: goal to validated task graph | VERIFIED | `manager.test.ts` (validator); `ClaudePlanner` itself is not exercised in CI |
| Manager goal entry from the UI | IMPLEMENTED | `POST /api/goal` (token, 501 without a Manager: `server.test.ts`); end to end from the browser with the scripted planner in `npm run ui`, and through `ClaudePlanner` with a stub `claude` binary. Not yet run with the real Claude Code CLI |
| Agent-backed independent review | PARTIAL | `ClaudeReviewer` (separate read-only Claude Code process, strict parsing tested in `manager.test.ts`, wiring exercised with a stub binary). Not yet run with the real CLI; review comments and agent responses to feedback are not built |
| Real-repository launcher | IMPLEMENTED | `npm start -- <repo>`. Run end to end on Linux with a stub `claude` executable on PATH: goal via `POST /api/goal`, plan of 2 dependent tasks, `ClaudeReviewer` approvals, 2 verified merges. Not yet run with the real CLIs |
| Workspace UI: overview, inbox, sessions, task graph and table, reviews, git, activity, inspector, Ctrl+K | IMPLEMENTED | Screenshot-reviewed against the demo; pure derivations tested in `ui-model.test.ts` |
| Diff viewer | PARTIAL | Unified and side-by-side views with old/new line numbers, find in diff (Enter cycles hits), file list, live worktree or committed range (`server.test.ts`, `parseDiff` in `ui-model.test.ts`). No syntax highlighting yet |
| Terminal | PARTIAL | Real PTY output, read-only. Agents run one-shot non-interactively, so input, resize to the PTY and search are not wired |
| Attention inbox | PARTIAL | Failures, conflicts, blocked tasks, failed post-merge checks, plan failures (`ui-model.test.ts`). Opt-in browser notifications for new items while the window is unfocused (enable from Ctrl+K), checked in Chromium with a refused merge. No permission or input requests yet (no provider reports them) |
| Session states | PARTIAL | Running / exited / failed / timed out from real events. Retry of failed, conflicted or blocked tasks (re-queues tasks blocked on it, refused while a merge is still on the target) is in the inspector (`orchestrator.test.ts`, `server.test.ts`, checked in Chromium). Interrupt, resume and waiting-for-input are not exposed |
| Multi-project workspace | VERIFIED | `npm start -- <repo> <repo> ...`: one Orchestrator per repository (own state.db, worktrees, merge lock), `?project=` on every API route, project switcher in the sidebar and Ctrl+K (`server.test.ts`). Run end to end on Linux with two disposable repos and a stub `claude`: both goals planned, 4 verified merges, the user's branch and uncommitted file in one repo untouched |
| OS-level sandboxing, permission profiles | NOT IMPLEMENTED | Highest-priority safety gap before more unattended use |
| Dedicated merge worktree | VERIFIED | `git.test.ts`: merge and rollback while the user's tree is on another branch with uncommitted work; the branch moves by CAS ref update, or by fast-forward when a clean worktree has it checked out. Post-merge checks run on the merged commit in `<worktrees>/merge` |
| Electron packaging, native notifications, installer | NOT IMPLEMENTED | IPC boundary designed in `architecture.md` |
| GitHub integration | NOT IMPLEMENTED | |
| Dev-server preview, agent profiles, usage tracking | NOT IMPLEMENTED | Phase 5 |
| Pixel-art office UI | REMOVED | Replaced by the workspace UI on 2026-11-04 |

## Known security limitations
- Agents are not OS-sandboxed. They run as the user with a scrubbed environment (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, `PASSWORD` removed). Unattended flags (`--permission-mode acceptEdits`, `--full-auto`) widen what an agent may do inside its worktree.
- The local server is loopback-only with a Host check and a per-run token for writes; any local process can still read state.
- If the target branch is checked out somewhere, that tree must be clean and is fast-forwarded (or reset on rollback).

## Next
1. OS-level sandboxing on Windows (restricted token / AppContainer evaluation) and permission profiles, before broader autonomy.
2. Real end-to-end run from the UI: goal, `ClaudePlanner`, Claude Code engineers, `ClaudeReviewer`, on a disposable repo, on Windows.
3. Interactive sessions (input, interrupt, resume where the CLI supports it) and the attention items they produce.
4. Electron shell with the typed preload API.
