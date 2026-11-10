# Decisions

Status: **Active**, **Superseded**, **Rejected**. Source = where it can be checked. Dates are UTC.

| ID | Decision | Status | Why | Source |
|---|---|---|---|---|
| D-01 | Agents propose, deterministic code enforces safety (Git, backups, FS boundaries, audit) | Active | LLM behaviour is not a safety mechanism | Owner brief 2026-09-29; `docs/architecture.md` |
| D-02 | Mandatory verified pre-merge backup; no backup, no merge; rollback only from persisted evidence | Active | Recoverability is the product promise | Brief; `GitService`; `git.test.ts` |
| D-03 | No paid inference API / API keys; agents are the user's logged-in CLIs; `*_API_KEY/_TOKEN/_SECRET/PASSWORD` stripped | Active | Cost and trust constraint | Brief; `scrubbedEnv` |
| D-04 | TS run by Node type stripping, built-in `node:sqlite`, plain ES-module UI, no bundler/React | Active (revisit if components grow) | No toolchain, no native module for Electron | `docs/architecture.md`. Differs from the brief's preferred React/PixiJS; reasons recorded there |
| D-05 | Electron wraps the same local server as a child Node process; renderer sandboxed, one preload call | Active | System Node needed for `node:sqlite`, strip-types, `node-pty`; web and desktop run identical code | PR #6, `docs/architecture.md`. Owner 2026-11-05: keep **both** web and Electron |
| D-06 | Local server: 127.0.0.1, Host check, no CORS, per-run token for mutations | Active | Threat model: local processes may read state; writes need token | `server.ts`, `server.test.ts` |
| D-07 | Remove pixel-art office; UI is a black-terminal engineering workspace | Active, owner-mandated 2026-11-04 | Product is a professional tool; the game look was judged poor ("art hala çok kötü") | PR #4; `docs/DESIGN_SYSTEM.md`. **Rejected earlier approaches**: code-drawn rectangles/sprites, AI-generated portraits/furniture (ElevenLabs, ~4 cents), "Gods Will Be Watching"-style portraits, world-first open lobby with A* walking (art bible, 32×48 sprite sheets), LimeZu Modern Interiors/Office 16 px packs |
| D-08 | LimeZu assets are never committed (licence forbids redistribution; free Interiors is non-commercial) | Moot | Assets were gitignored, then the whole pixel UI was removed | [V] `git log --all -- ui/assets/limezu*` empty; no mention on `main` |
| D-09 | Windows isolation: **WSL2 + Claude Code's Linux sandbox**, not AppContainer | Active (unverified) | AppContainer blocked file edits (path checks → every file "sensitive") and Git Bash cannot start inside it; a fundamental Windows limitation. Owner picked WSL2 on decision card 2026-11-05T12:36Z | Branch history `7406370`→`1c49336`. Options not taken: low integrity, defer |
| D-10 | Native Windows keeps deny rules only; UI says "rules only"; autonomy must not overstate it | Active | Claude Code has no native Windows sandbox (docs checked 2026-11-05) | PR #5 |
| D-11 | PTY opt-in on Windows (`AO_PTY=1`); pipes by default | Active | ConPTY never reported process exit; PTY probe hung | PR #4; `e1ea247` |
| D-12 | Merge in a dedicated detached worktree `<worktrees>/merge`; branch moves by ff-only or CAS `update-ref` | Active | User's checkout is never used for merge/verify | PR #4, `git.test.ts` |
| D-13 | One Orchestrator + SQLite DB + merge lock per repository; `?project=` on API routes | Active | Project isolation | PR #4 |
| D-14 | Project `profile.json` is an allowlist and lives outside the repo | Active | An agent must not rewrite its own permissions | PR #4/#5 |
| D-15 | Reviewer is a separate read-only Claude Code process with strict parsing; malformed output = not approved | Active | Independence and no rubber stamp | PR #4 |
| D-16 | Failed post-merge verification keeps the merge and offers explicit rollback; never silent rollback | Active | Preserve evidence | Brief; `architecture.md` |
| D-17 | Owner standing rule (2026-11-05): after tests, typecheck and review pass, agents merge their own PRs and delete obsolete stashes without asking; owner reviews only final aesthetic design | Active | Owner is mostly away | Project memory `agent-office-autonomy` (copied here) |
| D-18 | Do not host on Vercel | Active | App needs local repos, Git, CLIs and the user's login; a static demo only if asked | Thread 2026-09-29 17:52Z |
| D-19 | Real-CLI verification happens on the owner's machine, never in a cloud sandbox | Active | The sandbox has other credentials; tokens are scrubbed | Thread 2026-09-29 15:08Z |
| D-20 | Phase 6 (scheduled agents, VPS, Ops/SRE) not before core reliable | Active | Brief | Brief §26 |
| D-21 | New environment (this migration): T3 Code + Claude Code + Codex CLI + worktrees + independent reviewers + GitHub CI | Active | Owner request 2026-11-06 | Migration brief |

## Corrections and constraints the owner gave (preferences)

Be action-first; do not stop at plans; explain in plain language and give copy-paste Windows (PowerShell/cmd) commands; owner writes Turkish and English, answer in the language used; show screenshots for design; the owner will not be at the computer, so run checks yourself (including through the device session) and only come back for aesthetics; ask before spending/credentials; ElevenLabs free credit was used for ~4 cents of art (no longer relevant).
