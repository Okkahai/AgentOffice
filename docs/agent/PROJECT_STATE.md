# Project state — Agent Office

Snapshot **2026-11-06**, written for a coordinator with no access to the cloud project, its memory or its threads.
Evidence tags used in all `docs/agent/*` files:

| Tag | Meaning |
|---|---|
| **[V]** | Verified by the author of this handoff on 2026-11-06 against the repo, GitHub or the user's device (what was checked is named) |
| **[R]** | Reported in a thread, PR body or doc; not re-verified here |
| **[D]** | Historical decision or instruction by the owner (Gün) |
| **[A]** | Assumption |
| **[?]** | Unresolved question |

## 1. Goal, scope, non-goals

**Original spec (owner brief, 2026-09-29) [D]** — A local-first workspace where *real* coding agents run in isolated Git worktrees, with every important state corresponding to a real process, task, Git operation, verification result or event. Pipeline: goal → plan → task graph → worktrees → agents (concurrent where safe) → tests → independent review → **mandatory pre-merge backup** → auto-merge → post-merge verification → audit trail. Layers: UI → event/state → orchestrator → task engine → agent runtime → Git control plane → repo. The UI never touches Git or privileged OS functions. Success criterion: a user can watch several real agents work concurrently on a real repo and trust that work is isolated, visible, reviewed, merged with verification, and that every auto-merge has a recoverable pre-merge state.

**Reframed by master rebuild brief (2026-11-04) [D]** — "Autonomous Engineering Command Center": a serious professional developer tool (Black Terminal × Linear-like precision × UNIX TUI), Windows 11 first, Electron + TypeScript + SQLite + xterm.js + real CLIs. The pixel-art office metaphor is **removed** from the product. Brief sections of record: multi-project workspace, unified session management (running / waiting for input / idle / exited / failed / interrupted / disconnected / recoverable; never label "paused" if only terminate exists), **Attention Inbox**, dependency-aware task graph, Manager reachable from the UI with autonomy modes (Supervised / Standard / Autonomous, never an unrestricted mode), integrated diff + code review (comments tied to file/line, send feedback to the responsible agent), safe merge (dedicated merge worktree, serialized, rollback via persisted evidence, prefer `git revert` for published history), optional GitHub integration (local merge and GitHub PR merge are separate events; never bypass branch protection), sandboxing + permission profiles (RESTRICTED / DEVELOPMENT / TRUSTED PROJECT), real PTY terminal, Ctrl+K palette, observability without fabricated telemetry, dev-server preview (phase 2), reusable agent profiles, Electron packaging, performance polish, visual acceptance via real screenshots. Roadmap phases 0–6; **do not start phase 6** (scheduled agents, remote workers, VPS coordinator, Ops/SRE) before the core is reliable.

**Non-goals (from the briefs) [D]**: paid inference APIs / API keys in the core; hosted orchestration, cloud DB or remote auth requirements; Kubernetes, microservices, Redis unless forced; multiplayer, mobile, marketplaces, billing, SSO, RAG, custom models; dozens of agent roles; pixel-art characters, virtual rooms, cartoon avatars, fake activity, decorative ASCII, neon/CRT/glass effects; fake metrics or progress; estimating token usage from text length and presenting it as billing data. Optional VPS is acceptable only as an extra, never required.

## 2. Architecture and technology (summary)

Authoritative detail: [docs/architecture.md](../architecture.md); agent-layer delta: [ARCHITECTURE.md](ARCHITECTURE.md).
TypeScript run directly by Node ≥22.18 (type stripping, no build), built-in `node:sqlite`, system `git` via `execFile`, `node-pty` (opt-in on Windows), plain ES-module UI + `@xterm/xterm`, loopback HTTP+SSE server, Electron 45 shell that spawns the same server as a child Node process. No framework or bundler. [V] `package.json`, `src/`.

## 3. Current repository and Git state [V] (GitHub API + `git ls-remote` + device ref files, 2026-11-06)

| Item | State |
|---|---|
| Default branch `main` | `c87cf0b` = merge of PR #7. Contains everything delivered through PR #7 |
| PRs #1–#7 | All **merged** (#1,#2,#3: 2026-09-29; #4 2026-11-05T02:06Z; #5 02:17Z; #6 06:31Z; #7 12:12Z). None open before this handoff PR |
| `claude/project-thread-fn37mk` | `1c49336`, **4 commits ahead of `main`, unmerged, no PR**: two AppContainer commits (`7406370`, `a322565`, superseded) and the WSL2 runner (`8cdf244`), then `1c49336` removing the AppContainer code. Net diff vs `main`: `src/agents/wslAgent.ts`, `test/wslAgent.test.ts`, small edits to `scripts/app.ts`, `src/agents/cliAgents.ts`. **Confirmed present on origin.** |
| `backup/main-20260929`, `backup/main-before-lobby-20260929` | Both `630def2`, safety refs from the lobby rewrite. Keep |
| Tags / releases | None |
| CI | **None.** There is no `.github/` directory; "tests pass" has only ever meant someone ran them |
| Stashes (user's Windows checkout `C:\Users\okkah\Codebase\AgentOffice`) | No `refs/stash` in `.git/refs` on 2026-11-06, so the pixel-world and electron-shell stashes appear dropped. Recoverable SHAs recorded in the thread: pixel-world `69b11ea`, electron `482a135` (may be gc'd; not needed) |
| Local branches on that checkout | HEAD is on `claude/project-thread-fn37mk` @ `1c49336` (equals origin); `main` @ `aaac5bc` (behind by PR #7); `claude/pixel-world` @ `72a0da0` which is an ancestor of `origin/main` (nothing unpushed); `claude/electron-shell` absent (deleted) |
| Other local folders | `C:\Users\okkah\Codebase\AgentOffice-pr4` has no `.git` (stray copy of PR #4-era files); `C:\Users\okkah\AgentOffice` is the original clone; `~/.agent-office/` holds per-repo state and `bin/`. [?] Whether the checkout has uncommitted changes could not be read (no `git status` possible through file listing) |

This handoff itself is delivered as one PR from branch `claude/project-thread-nfqllh` (docs only).

## 4. Completed work

Sources: PR bodies [V: read from GitHub], `docs/DEVELOPMENT_PROGRESS.md` [V: read; status column is the previous coordinator's, not re-run], my re-run today.

- Core loop (PR #1): state machine, SQLite store, GitService (worktrees, backup, merge, rollback, policy, path validation), orchestrator with restart recovery, providers, CLI detection. **[V today]** `npm run typecheck` clean and `npm test` pass on Node 22.23.4 / Linux: **57/57 on `main`, 59/59 on `claude/project-thread-fn37mk`** (`node-pty` not built in my sandbox; docs say 59/60 with PTY).
- Manager plan gate + local UI server (PR #2); pixel office iterations (#2, #3) later **removed** (PR #4).
- Workspace UI (PR #4): Overview, Inbox, Sessions, Tasks (graph/table), Reviews, Git, Activity, inspector (Terminal/Diff/Review/Events), Ctrl+K, goal entry, multi-project, dedicated merge worktree, `ClaudeReviewer`, side-by-side diff with highlight/search, notifications, retry, per-project `profile.json`, Windows shim fix, PTY opt-in on Windows.
- Agent hardening (PR #5): permanent deny-rule `--settings`, OS sandbox enabled where Claude Code has one (macOS, Linux/WSL2+bubblewrap), isolation shown per project.
- Electron shell (PR #6, #7): `npm run desktop`, sandboxed renderer, one preload call, repo list in userData, survives a moved repo.

Independently real-world evidence on the owner's Windows 11 machine (reported in thread, **[R]**): real Claude Code end-to-end (PR #1 slice 2026-09-29; PR #4 flow 2026-11-05 with Claude Code 2.1.283: 1 task, reviewer approval + 2 warnings, merge `f8367ab`, ~1 min); `npm test` 56/56 (PR #4) and 57/57 (PR #6); deny rules refused `git push` and a `~/.ssh` read, remote did not move (PR #5); desktop window opened and server stopped on close (PR #6). Not re-run by this handoff.

## 5. Unfinished work

See [TASK_REGISTRY.md](TASK_REGISTRY.md). Headline: **WSL2 isolation branch unmerged and unverified end to end; sandbox escape probe never completed**; interactive sessions; permission profiles/autonomy modes; review comments and agent fix loop; Codex/OpenCode never run for real; GitHub integration; installer; CI.

## 6. Known bugs, debt, risks [V from source/docs unless tagged]

- No CI anywhere; test counts in docs disagree (README badge "51", progress doc "59/60", observed 57/59).
- Native Windows: no OS sandbox; deny rules match command text and are not a security boundary. Agents run as the user with scrubbed env.
- PTY on Windows is opt-in (`AO_PTY=1`): ConPTY never reported a process exit; agents use pipes there. Terminal is read-only everywhere (agents are one-shot `-p` runs).
- Rollback is `reset`/CAS to the recorded backup sha; it does not yet check whether the merge was published (the brief asks for `revert` in that case). **Gap [V: no `pushed`/`upstream` handling in `src/`].**
- Autonomy modes (Supervised/Standard/Autonomous), RESTRICTED/DEVELOPMENT/TRUSTED profiles, project merge/review policy, saved goals and persistent project memory: **not implemented** [V: grep].
- No agent fix loop: a blocking review fails the task; retry is manual [V: orchestrator has no review-feedback loop].
- Multi-project is one SQLite DB per repo under `~/.agent-office/<repo>`; the spec's "migration from the single-project model" was satisfied by not having one [?].
- Merge/rollback in the user's tree: if the target branch is checked out, that tree must be clean and is fast-forwarded.
- Highlighter ignores multi-line strings/comments; installer, window-state persistence, in-place add-repo, crash recovery/logging/version display in Electron are missing.
- `.claude/settings.json` (git commit/push allow rule) is committed; `docs/DEVELOPMENT_PROGRESS.md` and README contain stale counts.

## 7. Environment, services, secrets

No environment variable is required. Optional: `AO_PTY=1` (enable PTY on Windows), `AO_REPO` (desktop: initial repo), `AO_NODE` (desktop: Node binary), `AGENT_OFFICE_FAKE=1` (`scripts/real-agent.ts` stub agent), `UI_DEMO_DELAY` (demo pacing); `AGENT_OFFICE_TASK_ID` is set *for* agents. Required external tools: Node ≥22.18, Git, and the agent CLIs the user is logged in to (`claude` required for Manager + reviewer; `codex`, `opencode` optional). Windows extras: Visual Studio C++ Build Tools only if building `node-pty`; WSL2 + distro with `bubblewrap`, `socat`, native Linux Claude Code for T-01. Data: `~/.agent-office/<repo-name>/{state.db,worktrees/,profile.json}`. No secrets live in the repo or this handoff. The owner's machine: Windows 11 (10.0.26200), Node 24.x, WSL2 `kali-linux` distro (Claude Code 2.1.318 installed there by the owner [R]); `~/.t3` exists, so T3 Code is already installed [V: home directory listing].

## 8. Knowledge not recoverable from the repo alone

- Owner working style and standing rules: see [HANDOFF.md](HANDOFF.md) §"Owner preferences".
- Everything in [DECISIONS.md](DECISIONS.md) marked with a thread source (rejected approaches and why).
- The Windows/WSL verification recipes used so far and their gotchas: [VERIFICATION.md](VERIFICATION.md).
- Original and rebuild briefs are summarised in §1; their full text lives only in the cloud thread (see HANDOFF §"Sources and gaps").
