# CLAUDE.md

Shared project rules live in [AGENTS.md](AGENTS.md); read it first. State and next actions: [docs/agent/HANDOFF.md](docs/agent/HANDOFF.md). This file only adds Claude-specific points.

## Claude Code specifics

- **Claude Code is both a runtime and a dependency of the product.** `ClaudePlanner` (Manager, read-only plan mode) and `ClaudeReviewer` (separate read-only process) shell out to the user's `claude` CLI; engineers run `claude -p <prompt> --permission-mode acceptEdits --settings <json>`. Argv, deny rules and the OS-sandbox flag are built in `src/agents/cliAgents.ts` (`buildAgentArgv`, `claudeAgentSettings`, `claudeOsSandbox`, `agentIsolation`). Change them only with a test in `test/pty.test.ts` / `test/provider.test.ts` and a real-CLI check on Windows.
- The deny-rule JSON passed with `--settings` cannot be removed by a project profile and disables bypass mode. Do not add flags that skip permissions.
- Do not run a real nested agent in a cloud sandbox: it has the session's own credentials, not the user's login, and Agent Office strips `*_TOKEN` variables. Real-CLI runs belong on the user's Windows machine (see VERIFICATION.md recipes).
- Login can expire (`OAuth session expired`). Fix with `claude auth login` in a terminal, check `claude auth status` / `claude -p "say ok"`. Seen twice on the Windows machine.
- Permission classifiers on the user's device blocked installs, `sudo`, and `stash drop` / `branch -D` when run through remote sessions; those steps must be given to the user as commands.
- `.claude/settings.json` in this repo allows `git commit` / `git push` Bash rules (added by the owner 2026-09-29 to unblock a cloud session). It is not part of the product; reconsider it in the new environment (TASK T-14).

## Skills (use when relevant, do not invoke blindly)

The owner's earlier brief named: Superpowers (planning, TDD, systematic debugging, verification-before-completion, requesting/receiving code review, git worktrees), Matt Pocock engineering skills, Ponytail (smallest complete change), taste-skill (UI design, only for user-facing interface work), claude-mem (session continuity; Agent Office's own state must never depend on it), task-observer. They are tooling for the developer, not code in this repo.

## Commit / PR conventions

- Small commits with a "why" message; PR body in the Before / After / How / Evidence shape used by PRs #4–#7 (evidence = commands run and results, including what was **not** run).
- Environment-specific attribution lines (commit trailers, PR attribution block) come from the host environment's instructions; follow them where given.
