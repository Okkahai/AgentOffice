# Handoff — start here

For a new coordinator (T3 Code + Claude Code + Codex CLI + worktrees + independent reviewers + GitHub CI) with zero history. Date 2026-11-06. Companion files: [PROJECT_STATE](PROJECT_STATE.md), [TASK_REGISTRY](TASK_REGISTRY.md), [DECISIONS](DECISIONS.md), [VERIFICATION](VERIFICATION.md), [ARCHITECTURE](ARCHITECTURE.md), [../../AGENTS.md](../../AGENTS.md).

## 1. Read order and first hour

1. AGENTS.md (invariants) → PROJECT_STATE §1, §3 → this file → TASK_REGISTRY.
2. `git clone https://github.com/Okkahai/AgentOffice`, `npm ci`, `npm run typecheck`, `npm test`. Expect fail 0 (57 on `main` without PTY build).
3. Merge or keep this docs PR so the handoff lives on `main`.
4. Do T-03 (CI) before anything else so independent review has a gate.

## 2. Recommended execution order in T3 Code

1. **T-04** land this PR. 2. **T-03** CI (ubuntu + windows). 3. **T-01 → T-02** open a PR from `claude/project-thread-fn37mk`, run the Windows/WSL e2e and escape probe on the owner's machine, merge only if both pass; else mark WSL as `rules only` and decide with the owner. 4. **T-06** review comments + bounded fix loop and **T-09** revert-based rollback (independent, parallel worktrees, different files). 5. **T-05** interactive sessions → **T-08**, **T-12**. 6. **T-07** profiles/autonomy modes using T-01's outcome. 7. **T-10** Codex/OpenCode real runs. 8. **T-11** installer. 9. **T-15**, **T-13**, **T-16**. Never T-phase-6 items.
Each task: worktree per task, tests on disposable repos, independent reviewer ≠ implementer, evidence in VERIFICATION.md, then merge (owner rule D-17).

## 3. Owner preferences

Gün (GitHub `Okkahai`), Windows 11, writes Turkish and English, usually away. Wants autonomous progress, self-QC and self-merge when checks pass; will only judge final aesthetics (give real screenshots). Wants copy-paste PowerShell steps when a step is theirs. No API keys or paid services. Dislikes pixel-art/game visuals now. Approvals needed: spending, credentials, irreversible actions outside the repo, anything touching their real repos/files.

## 4. Readiness audit

**Verified today**: all 7 PRs merged; `main`=`c87cf0b`; WSL commit `1c49336` exists on origin; the only unmerged product work is that branch; no `refs/stash` and no unpushed commits on the Windows checkout (`pixel-world` is already in `main`); tests/typecheck pass (57 and 59).

**Missing context / gaps**
- Full thread text was read (186 messages) but images/screenshots in the Library (`agent-office/redesign`, `screenshots/`) were not inspected here; they show the removed/current UI only. Two long briefs are summarised, not reproduced; the original thread remains the only full copy.
- `git status` of the Windows checkout (dirty or not) is unknown. The device session ended before I could run Git; I could only read ref files. Local run data in `~/.agent-office/` is not needed.
- Project memory had a dangling link (`agent-office-windows-testing`); its content was never written. Windows lessons are now in VERIFICATION.md.
- Device approval for `C:\Users\okkah\Codebase` expires after ~30 days of non-use; sessions there stall on plan usage limits.
- Whether Codex/OpenCode are installed on the owner's machine is unknown (`~/.codex` exists).
- Real e2e results for the WSL attempt were lost (session idle).

**Contradictions / stale**
- README badge says 51 tests; progress doc says 59/60; observed 57/59; WSL thread claimed 62 (not reproduced).
- `docs/DEVELOPMENT_PROGRESS.md` "Next" still lists AppContainer as item 1; superseded by D-09.
- Brief says React/PixiJS/typed IPC; implementation deliberately differs (D-04, D-05).
- Thread status "Electron"/"web" resolved: both.

**Duplicates**: none in the registry; "sandbox" appears as T-01/T-02/T-07 on purpose (runner, proof, policy).

**Work that exists only in cloud sessions**: none found. All code is on origin; the three device sessions (`cse_…`) hold no committed-only state I could find, but their local worktrees/temp repos are disposable. The original cloud container's uncommitted files cannot be inspected; the last agent report says nothing was left uncommitted besides what was pushed (WSL branch) [R].

**Must not be restarted**: pixel-art/sprite/art-bible/LimeZu work; AppContainer sandbox; PR #1–#7 features (re-verify, don't rebuild); Electron-vs-web debate.

**Needs user approval**: spending; deleting anything on the Windows machine (`Codebase\AgentOffice-pr4`, branches); changing `.claude/settings.json` allow rules; accepting WSL as the Windows isolation story if T-02 is ambiguous; final aesthetics.

**Risks of stopping the cloud sessions**: low for code (pushed). Losing: the project memory text (copied into D-17 / this handoff), the thread history (keep the project readable or export it), pending device sessions (idle anyway), and the decision-card record. Not yet preserved anywhere else: screenshots in the Library — copy `agent-office/` and `screenshots/` if you want them; they are not in git.

## 5. Verdict: **READY FOR MIGRATION** (conditional)

Reason: every line of product code and every merged PR is on GitHub and reproducible; the single unmerged piece (WSL runner) is pushed at a known SHA with a documented acceptance plan; no unique cloud-only work was found. Conditions: (1) this docs branch stays on origin or is merged; (2) ask Gün to run `git status` in `C:\Users\okkah\Codebase\AgentOffice` and confirm clean, or discard it; (3) the new coordinator treats T-01/T-02 as **not verified**, not done. Not claimed: migration success; that requires the first T3 session to build and test from a clean clone.
