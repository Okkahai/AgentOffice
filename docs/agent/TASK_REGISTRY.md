# Task registry

Snapshot 2026-11-06. Tags: see [PROJECT_STATE.md](PROJECT_STATE.md). "Verified complete" below means a recorded test or real run, not a thread saying so. Origin thread = the cloud project thread `cmsg_01Tj5vfFJX3rKtPgPKHnqGPH3DxpnS6QAKUwTqwqZPncMq` (186 replies, 2026-09-29 → 2026-11-05); author sessions: Claude Code cloud session `session_01F56nWSY1x9pcKeWp6EoUu7`; device sessions `cse_01F56nWSY1x9pcKeWp6EoUu7` (expired), `cse_01RPz9xKT5njC6zPPX8MFd1d`, `cse_01EkSrumRMVX2QTxmtuHYtTU` (offline since 2026-11-05T13:29Z). No live thread is running work; the cloud sessions are idle/ended.

## Summary

| ID | Title | Status | Pri | Depends |
|---|---|---|---|---|
| T-01 | WSL2 agent isolation: end-to-end run and merge | IMPLEMENTED, UNVERIFIED, UNMERGED | P1 | — |
| T-02 | Sandbox escape probe (WSL) | NOT DONE (attempted, result lost) | P1 | T-01 |
| T-03 | CI (GitHub Actions) | NOT STARTED | P1 | — |
| T-04 | Merge handoff docs PR | PR open (this) | P1 | — |
| T-05 | Interactive sessions: input, interrupt, resume, waiting-for-input | NOT STARTED | P2 | — |
| T-06 | Review comments + agent fix loop on blocking review | NOT STARTED | P2 | — |
| T-07 | Permission profiles + autonomy modes | NOT STARTED | P2 | T-01 |
| T-08 | Attention items for permission/input requests | NOT STARTED | P2 | T-05 |
| T-09 | Rollback safe for published history (revert) | NOT STARTED | P2 | — |
| T-10 | Real Codex and OpenCode runs | NOT STARTED | P2 | — |
| T-11 | Desktop release: installer, window state, in-place add, logging | PARTIAL | P3 | — |
| T-12 | Terminal: persisted history, input, search, PTY on Windows | PARTIAL | P3 | T-05 |
| T-13 | Project policy and memory (saved goals, review/merge policy) | NOT STARTED | P3 | — |
| T-14 | Repo hygiene and doc drift | PARTIAL | P3 | — |
| T-15 | GitHub integration | NOT STARTED | P3 | T-03 |
| T-16 | Agent profiles (full), dev-server preview, usage tracking | NOT STARTED | P4 | — |

Closed / do not restart: pixel-art office and sprite pipelines (rejected, removed in PR #4); LimeZu asset integration (never committed, moot); AppContainer sandbox (technically failed, code removed in `1c49336`, history only); Electron-vs-web question (both kept); Vercel hosting (not applicable). PRs #1–#7 are merged, verified as below.

## Completed and verified (for reference, not to redo)

Core loop, state machine, recovery, GitService, merge worktree, multi-project, Manager gate, ClaudeReviewer, workspace UI, deny-rule hardening, Electron shell. Evidence: [VERIFICATION.md](VERIFICATION.md) ledger. Each is "implementation complete" and test-backed; items with a single real run only (reviewer, planner, Windows e2e) are noted **single-run**.

## Unfinished tasks

### T-01 WSL2 agent isolation — end-to-end and merge
- **Status**: code and unit tests done; real e2e never completed. **Priority** P1. **Confidence** medium that the code works, low that the sandbox holds.
- **Objective / acceptance**: On Windows, `profile.json` `{"wsl":"<distro>"}` runs Claude Code engineers inside WSL2 under Claude Code's Linux sandbox. Accept when (a) `npm test` + typecheck green on Windows and Linux, (b) a disposable repo goal runs plan → engineer in WSL → review → backup → merge with isolation reported `os-sandbox`, (c) T-02 passes, (d) the PR is reviewed independently and merged to `main`.
- **Branch / commit / PR**: `claude/project-thread-fn37mk` @ `1c49336` [V on origin]. **No PR exists.** Compare `main...branch` is 4 files (+93/−14) [V].
- **Done**: `src/agents/wslAgent.ts` (path mapping `C:\x`→`/mnt/c/x`, deny list for `/mnt/*/Users/*/{.ssh,.aws,.config/gh,.claude,AppData}`, args passed NUL-separated through a file read by `xargs`, so no shell re-parses the prompt), `WslProvider`, `parseProfile` `wsl` key (claude-only, name-validated), `agentIsolation(...,wsl)`; `test/wslAgent.test.ts`. [V today: typecheck clean, 59/59 on Linux.] Kali had `bubblewrap`, `socat` installed by the owner; native Linux Claude Code 2.1.318 installed and logged in by the owner [R].
- **Remaining**: run e2e on the Windows machine (recipe in VERIFICATION.md §WSL); run T-02; fix whatever appears; open PR; independent review; merge. Also: `.tmp` dir next to each worktree is never removed (code comment shortcut); WSL `/mnt/c` mount assumption; `$HOME/.local/bin/claude` hard-coded path inside the distro.
- **Blockers**: needs the owner's Windows machine and a working Claude login inside the distro. The previous attempt failed silently because the device session went idle/offline (usage limit) — no result was ever reported [R: thread 2026-11-05 12:45–17:02Z].
- **Files**: `src/agents/wslAgent.ts`, `src/agents/cliAgents.ts` (`claudeAgentSettings`, `agentIsolation`, `parseProfile`), `scripts/app.ts`, `test/wslAgent.test.ts`.
- **Decisions made**: WSL2 chosen over AppContainer or "low integrity" or deferral (owner picked option 1 on a decision card 2026-11-05T12:36Z). Control plane stays on Windows; only the agent runs in WSL.
- **Next action**: Open a PR from `claude/project-thread-fn37mk` (do not merge); on the Windows machine run the e2e + probe, attach outputs verbatim, then merge if green.
- **Do not**: restart the AppContainer approach (D-09), or merge before T-02.

### T-02 Sandbox escape probe
- **Objective**: Prove a WSL-run engineer cannot read `/mnt/c/Users/<user>/.ssh/known_hosts` nor create `/mnt/c/Users/<user>/ao-escape.txt`, and that a normal edit inside the worktree works.
- **Status**: attempted by a device session 2026-11-05; usage limit hit; **no result recorded** [R]. Treat as not done.
- **Steps**: use the exact prompt in VERIFICATION.md; pass `--settings` JSON from `wslClaudeArgv`; afterwards confirm `ao-escape.txt` does not exist (delete if it does and report); also test a bypass attempt via `sh -c`. **Acceptance**: read refused, write refused, file absent, evidence pasted.
- **Confidence** in outcome: unknown. Note: deny rules alone do not stop `sh -c`; the bubblewrap sandbox must (that is what is being tested). If the probe fails, WSL isolation must be labelled `rules only` and T-01 not merged.

### T-03 CI
- **State**: no `.github/`. [V] **Objective**: workflow running `npm ci` (scripts allowed for node-pty is optional), `npm run typecheck`, `npm test` on ubuntu and windows, Node 22 and 24. **Acceptance**: green on `main`, required for merge. **Next action**: add `.github/workflows/ci.yml`; watch the PTY tests on Windows (opt-in via `AO_PTY`). Needed because the new environment's "independent reviewers + GitHub CI" assume it.

### T-04 Handoff docs PR
- This PR. Not merged. After merge, mark T-04 done, then keep these docs current (single authoritative set).

### T-05 Interactive sessions
- **Objective** (brief §9): create/resume/send input/interrupt/terminate/retry; distinguish running, waiting-for-input, idle, exited, failed, interrupted, disconnected, recoverable; never show "paused" unless a provider can pause. **State**: agents run one-shot non-interactively; only running/exited/failed/timed-out exist; retry implemented; `AgentHandle.sendInput/interrupt` exist in the provider interface but are not exposed. **Files**: `src/agents/provider.ts`, `ptyProvider.ts`, `src/core/orchestrator.ts`, `src/server/server.ts`, `ui/app.js`, `ui/model.js`. **Blocker**: ConPTY never reports exit on the owner's Windows (D-11). **Next**: design which CLIs support resume (`claude --resume`), add `interrupt`/`terminate` API + UI, then input.

### T-06 Review comments and fix loop
- **Objective** (brief §13, §2 step 11): comments tied to file/line, send feedback to the responsible agent, agent responds; blocking review triggers a bounded correction pass instead of a plain FAILED. **State**: reviewer returns `{approved, blockingIssues, warnings, summary}`; no comments, no loop [V grep]. **Next**: add a bounded re-run (1–2 attempts) that gives the engineer the blocking findings in the same worktree, then re-verify/re-review; keep gates unchanged.

### T-07 Permission profiles and autonomy modes
- **Objective** (brief §12, §16): RESTRICTED / DEVELOPMENT / TRUSTED PROJECT profiles with enforceable capabilities; Supervised / Standard / Autonomous policies; no unrestricted mode. **State**: none; only the fixed deny list and profile allowlist exist. **Depends** on T-01 outcome (what can really be enforced per platform). **Rule**: where no OS sandbox exists, restrict autonomy rather than claim isolation.

### T-08 Attention items for permission/input requests
- Needs T-05. Today inbox covers failures, conflicts, blocked, failed post-merge, plan failures; notifications are opt-in browser notifications.

### T-09 Rollback for published history
- Brief §14: do not blindly reset shared branches; prefer `git revert` if published. **State**: rollback = `update-ref`/reset to the recorded backup sha, only if target still equals the merged commit (`Orchestrator.rollback`). No remote awareness. **Next**: detect whether target is on a remote/upstream; if so offer revert commit through GitService with the same gates and tests on disposable repos.

### T-10 Real Codex and OpenCode runs
- Detection and argv are unit-tested; `--model` flags for codex/opencode unchecked against installed versions; `--full-auto` untested for real [R]. Earlier detection (2026-09-29) found neither installed; `~/.codex` now exists on the Windows machine [V listing], so Codex may be installed [?]. **Next**: run `scripts/real-agent.ts codex` on a disposable repo and record.

### T-11 Desktop release
- **State**: `npm run desktop` works (PR #6/#7, Windows-verified [R]). Missing: installer/packaged exe, window-state persistence, in-place project add (adding restarts the server), crash recovery, logging/diagnostics, version display, security verification of the preload/IPC boundary. Electron binary may need manual fetch when npm skips install scripts (README). **Next**: pick packager (electron-builder or forge), keep server-as-child-process design (D-05).

### T-12 Terminal
- Read-only output; no input, resize-to-PTY, search or persisted history. PTY opt-in on Windows. Depends on T-05.

### T-13 Project policy and memory
- Brief §8: saved goals, review/merge policy, verification config, persistent project memory per project. None exist; state is `tasks`, `task_deps`, `verification_runs`, `reviews`, `backups`, `merges`, `messages`, `events` per repo DB. Avoid speculative tables.

### T-14 Repo hygiene and doc drift
- README badge "51 passing" and progress-doc counts are stale [V]; `docs/DEVELOPMENT_PROGRESS.md` "Next" list predates the WSL decision; no `docs/SECURITY.md` / `PRODUCT_SPEC.md` (this handoff covers product spec in PROJECT_STATE); `.claude/settings.json` committed with commit/push allow rules; stray `Codebase\AgentOffice-pr4`; Windows checkout left on the WSL branch; a memory link `[[agent-office-windows-testing]]` points to a file that does not exist. All low risk. Deletions on the owner's machine need approval or owner-run commands.

### T-15 GitHub integration
- Brief §15: repo identification, issue import, PR create/status/CI/review comments/merge readiness, branch-protection awareness; local merge and PR merge are separate events; optional. Not started.

### T-16 Agent profiles (full), dev-server preview, usage tracking
- Phase 5. Profiles today: `agent`, `model`, `branch`, `wsl` only (deliberate allowlist). Dev preview needs port management and Electron webContents isolation. Usage tracking only from provider-reported numbers; never estimate.

## Dependency graph / execution order

`T-04 → T-03 → T-01 → T-02 → (merge WSL) → T-07`; `T-05 → T-08, T-12`; `T-06`, `T-09`, `T-10` independent; `T-11` after T-03; `T-15` after T-03; `T-13`, `T-16` last. Recommended order is in [HANDOFF.md](HANDOFF.md).
