# Competitive Analysis: AI Coding Agent Orchestrators

All sources were checked on 2026-11-04. We used official sites, official docs and GitHub READMEs only. "Claimed" means only a landing page states it. "?" means we found no evidence either way.

## Comparison

| Product | Parallel agents | Worktree isolation | Task dependencies | Diff/review UI | Merge from app | Session persistence | Windows | License |
|---|---|---|---|---|---|---|---|---|
| Conductor | yes (docs) | yes (docs) | ? | yes (docs) | yes (docs, details thin) | ? | no (Mac only) | proprietary |
| Emdash | yes | yes | ? | yes | yes | yes (SQLite) | yes | Apache-2.0 |
| Superset | yes | yes | ? | yes, with comments | yes (PR pane) | yes (terminals) | no ("not yet available") | Elastic 2.0 (source-available) |
| OpenHands Agent Canvas | yes | claimed | ? | ? | ? | ? | yes (WSL 2 for multi-container) | MIT (repo) |
| Opcode | no (single Claude Code companion) | no | no | checkpoint diffs only | no | yes (checkpoints, fork) | yes (build from source) | AGPL-3.0 |
| Claude Squad | yes (TUI) | yes | ? | yes (diff tab) | no (commit + push only) | pause/resume | ? (needs tmux) | AGPL-3.0 |
| Vibe Kanban | yes | yes | sub-issues, no explicit deps | yes, inline comments | yes (PR + merge) | ? | ? | Apache-2.0, sunsetting |
| cmux | yes (terminal panes) | no | no | no | no | yes (layout + scrollback) | no (macOS only) | GPL-3.0+ (app) |

## Per product

**Conductor** ([site](https://www.conductor.build/), [docs](https://www.conductor.build/docs/), [workspaces](https://www.conductor.build/docs/concepts/workspaces-and-branches))
- The docs say Claude Code, Codex, Cursor and OpenCode can run in parallel, and that each task gets its own workspace, branch, terminal, diff and review path.
- The docs confirm that workspaces are Git worktrees. The flow is diff review, then PR, merge and archive. There is a separate "checks" reference page.
- It is Mac only. We found no license or source, and no documentation of notifications, task dependencies or persistence. The docs show one shortcut (Cmd+Shift+N).

**Emdash** ([site](https://emdash.com/), [repo](https://github.com/generalaction/emdash))
- It is Apache-2.0 and ships builds for macOS, Windows (installer and portable) and Linux. The README says each task runs in its own worktree on its own branch.
- You can review diffs, create PRs, inspect CI checks and merge without leaving the app. App state lives in a local SQLite database.
- Notifications and status work only for agents that support lifecycle hooks. It also has SSH remote projects and issue intake from Linear, Jira and GitHub. The README does not mention task dependencies.

**Superset** ([repo](https://github.com/superset-sh/superset))
- Each task gets its own worktree, branch and terminals. The README says terminal sessions "survive restarts".
- It has a diff viewer with comment and edit, plus a PR pane that shows checks and review threads and can merge.
- Attention features include sidebar status, completion chimes and dock badges, and all shortcuts can be remapped. It is macOS only, Linux is experimental, and the README says "Windows is not yet available". The Elastic License 2.0 is not an OSI open source license.

**OpenHands Agent Canvas** ([product](https://www.openhands.dev/product/canvas), [repo](https://github.com/OpenHands/OpenHands), [old repo, archived](https://github.com/OpenHands/agent-canvas))
- The product page says each agent is "isolated in its own git worktree". The README only advises users to set up separate directories or worktrees themselves, so we count worktree isolation as claimed.
- It is a self-hosted web UI on localhost that can drive any ACP agent. It can run conversations in per-conversation Docker sandboxes, and it supports cron, webhook and Slack automations.
- The repo is MIT and has install guides for macOS, Linux and Windows. We found no documented diff, merge or task-dependency features.

**Opcode** ([site](https://opcode.sh/), [repo](https://github.com/getAsterisk/opcode))
- It is a desktop GUI around a single Claude Code. It manages sessions with checkpoints, a branching timeline, forks and diffs between checkpoints.
- It runs custom agents in background processes. It is not a parallel orchestrator and has no worktrees or merge.
- It is AGPL-3.0. The README lists Windows, macOS and Linux, but says prebuilt binaries "will be published soon". The landing page had no feature text we could read.

**Claude Squad** ([repo](https://github.com/smtg-ai/claude-squad))
- It is a terminal UI that runs one tmux session plus one git worktree per agent. It works with Claude Code, Codex, Gemini, Aider and others.
- It has a diff tab, can commit and push (`s`) and can pause and resume (`c` and `r`). It does not merge.
- It is keyboard driven. It is AGPL-3.0, needs tmux, and does not state Windows support.

**Vibe Kanban** ([site](https://vibekanban.com/), [repo](https://github.com/BloopAI/vibe-kanban))
- The site and README both say "Vibe Kanban is sunsetting", with the project continuing as a community-maintained open source project.
- It is a kanban of issues and sub-issues. Each workspace has a branch, terminal and dev server, uses an auto-created worktree, and can run setup scripts.
- You can review diffs with inline comments that go back to the agent. It can create a PR with an AI-written description, merge it, and preview in a built-in browser. It is Apache-2.0. Neither source mentions explicit task dependencies.

**cmux** ([site](https://cmux.com/), [repo](https://github.com/manaflow-ai/cmux))
- It is a native macOS terminal built on libghostty with vertical tabs, splits and an in-app browser. It is a terminal, not a task orchestrator.
- It has the strongest attention model we saw: notification rings on panes, unread badges, a notification panel and desktop notifications. Agents can trigger these through escape sequences or the CLI.
- Session restore brings back the layout, working directories and scrollback. It has a CLI and socket API. The app is GPL-3.0+ and the server parts are BSL 1.1. It is macOS only, and other platforms have a waitlist.

## What Agent Office takes from this

- **Validated task graph.** None of these tools documents real task dependencies. The closest is Vibe Kanban's sub-issues. A dependency graph that is validated before any agent starts is still Agent Office's main difference.
- **One worktree and branch per task, created automatically, with a setup script.** This is now standard (Conductor, Emdash, Superset, Claude Squad, Vibe Kanban), so Agent Office should match it rather than invent a new model.
- **Review that feeds back.** Following Superset and Vibe Kanban, diff comments should go back to the agent as instructions. In Agent Office this happens only after automated verification passes, and the reviewer must be independent of the agent that wrote the code.
- **Checks shown next to the merge button.** Conductor, Emdash and Superset all put CI status beside merge. Agent Office adds a verified pre-merge backup and verification after the merge, and none of the products documents either.
- **Attention signals.** Following cmux and Superset, use badges and notifications for "needs you", "failed" and "done", driven by agent hooks rather than by polling terminal output.
- **Persistence and Windows.** Following Emdash, keep state in a durable local store and restore it after a restart. Emdash and OpenHands show that Windows support is achievable, while Conductor, Superset and cmux leave it out.

**What Agent Office does not copy:** a terminal emulator or browser as the core product (cmux), a free-form kanban board without dependencies (Vibe Kanban), merging without a verification gate and a backup, auto-accept modes that skip review (the Claude Squad `-y` flag), source-available licensing (Elastic, BSL), and any proprietary code, UI or branding from these products.
