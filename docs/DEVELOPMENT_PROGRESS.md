# Development progress

Last updated 2026-11-04. Evidence: `npm test` 59/59 passing and `npm run typecheck` clean on Linux (Node 22.23). Windows (Node 24, 2026-11-04): typecheck clean, the suite passed except that the PTY probe hung and `claude.CMD` could not be spawned (`spawn EINVAL`); shims fixed since; the PTY tests and PTY sessions are now opt-in on Windows (`AO_PTY=1`) and agents use pipes there. Windows run of e1ea247: `npm test` 56/56 passing (PTY tests not run), no hang. Real end-to-end on Windows (2026-11-05, Claude Code 2.1.283, disposable repo): goal from `POST /api/goal`, `ClaudePlanner` planned 1 task, a Claude Code engineer wrote it, `ClaudeReviewer` approved with 2 warnings, verified merge `f8367ab`, about 1 minute.

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
| Manager goal entry from the UI | VERIFIED | `POST /api/goal` (token, 501 without a Manager: `server.test.ts`); end to end from the browser with the scripted planner in `npm run ui`, and through `ClaudePlanner` with a stub `claude` binary. Run once with the real Claude Code CLI on Windows (see top) |
| Agent-backed independent review | PARTIAL | `ClaudeReviewer` (separate read-only Claude Code process, strict parsing tested in `manager.test.ts`, wiring exercised with a stub binary). Approved a real task on Windows with the real CLI (once); review comments and agent responses to feedback are not built |
| Real-repository launcher | IMPLEMENTED | `npm start -- <repo>`. Run end to end on Linux with a stub `claude` executable on PATH: goal via `POST /api/goal`, plan of 2 dependent tasks, `ClaudeReviewer` approvals, 2 verified merges. Run once on Windows with the real Claude Code CLI (1 task, 1 verified merge). Codex and OpenCode not yet run |
| Workspace UI: overview, inbox, sessions, task graph and table, reviews, git, activity, inspector, Ctrl+K | IMPLEMENTED | Screenshot-reviewed against the demo; pure derivations tested in `ui-model.test.ts` |
| Diff viewer | PARTIAL | Unified and side-by-side views with old/new line numbers, find in diff (Enter cycles hits), file list, live worktree or committed range, line-local syntax highlighting for common languages (`server.test.ts`; `parseDiff` and `highlight`, including HTML escaping, in `ui-model.test.ts`). The highlighter does not track multi-line strings or comments |
| Terminal | PARTIAL | Real PTY output, read-only (pipes on Windows unless `AO_PTY=1`). Agents run one-shot non-interactively, so input, resize to the PTY and search are not wired |
| Attention inbox | PARTIAL | Failures, conflicts, blocked tasks, failed post-merge checks, plan failures (`ui-model.test.ts`). Opt-in browser notifications for new items while the window is unfocused (enable from Ctrl+K), checked in Chromium with a refused merge. No permission or input requests yet (no provider reports them) |
| Session states | PARTIAL | Running / exited / failed / timed out from real events. Retry of failed, conflicted or blocked tasks (re-queues tasks blocked on it, refused while a merge is still on the target) is in the inspector (`orchestrator.test.ts`, `server.test.ts`, checked in Chromium). Interrupt, resume and waiting-for-input are not exposed |
| Multi-project workspace | VERIFIED | `npm start -- <repo> <repo> ...`: one Orchestrator per repository (own state.db, worktrees, merge lock), `?project=` on every API route, project switcher in the sidebar and Ctrl+K (`server.test.ts`). Run end to end on Linux with two disposable repos and a stub `claude`: both goals planned, 4 verified merges, the user's branch and uncommitted file in one repo untouched |
| OS-level sandboxing, permission profiles | PARTIAL | Claude Code engineers always run with deny rules (push, remote/config changes, curl/wget/ssh/scp, WebFetch/WebSearch, `~/.ssh`, `~/.aws`, `~/.config/gh`, `.env`) and bypass mode disabled; Claude Code's OS sandbox is enabled on macOS and Linux/WSL2 with bubblewrap (`pty.test.ts`). Checked on Windows with the real CLI (2026-11-05): `git push` and the `~/.ssh` read were refused, the bare remote did not move, and the normal goal-to-merge flow still worked. Native Windows has no Claude Code OS sandbox (docs, checked 2026-11-05), so there the rules are the only layer and the sidebar says so. Our own Windows sandbox (restricted token / AppContainer) is not built |
| Dedicated merge worktree | VERIFIED | `git.test.ts`: merge and rollback while the user's tree is on another branch with uncommitted work; the branch moves by CAS ref update, or by fast-forward when a clean worktree has it checked out. Post-merge checks run on the merged commit in `<worktrees>/merge` |
| Desktop shell (Electron) | PARTIAL | `npm run desktop`: Electron 45 window over the same local server, started as a child Node process; sandboxed renderer, one preload call (add repository via folder picker, list kept in Electron userData). Run on Linux under Xvfb with a disposable repo: UI loads, bridge present, no `require` in the renderer, server stops when the window closes. Not yet: installer, window state, in-place project add (adding restarts the server) |
| GitHub integration | NOT IMPLEMENTED | |
| Agent profiles | IMPLEMENTED | Per project `~/.agent-office/<repo>/profile.json` with only `agent`, `model` and `branch` (allowlist, so no profile can add a permission-bypass flag; `pty.test.ts`). Shown in the sidebar. Run end to end with a stub `claude` (model passed through, merges onto `trunk`). The `--model` flags of codex and opencode are not yet checked against installed versions |
| Dev-server preview, usage tracking | NOT IMPLEMENTED | Phase 5 |
| Pixel-art office UI | REMOVED | Replaced by the workspace UI on 2026-11-04 |

## Known security limitations
- On native Windows, agents are not OS-sandboxed (Claude Code deny rules only; they match command text, so `sh -c` or a script can get around them). They run as the user with a scrubbed environment (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, `PASSWORD` removed). Unattended flags (`--permission-mode acceptEdits`, `--full-auto`) widen what an agent may do inside its worktree.
- The local server is loopback-only with a Host check and a per-run token for writes; any local process can still read state.
- If the target branch is checked out somewhere, that tree must be clean and is fast-forwarded (or reset on rollback).

## Next
1. Own Windows OS isolation for agents (restricted token / AppContainer via a small native helper), since Claude Code has no native Windows sandbox. Until then, WSL2 is the sandboxed option on Windows.
2. Interactive sessions (input, interrupt, resume where the CLI supports it) and the attention items they produce.
3. Desktop installer and in-place project add.
4. Real runs with Codex and OpenCode.
