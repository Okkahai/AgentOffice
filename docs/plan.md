# MVP definition, acceptance tests, phases

**MVP:** one local repo, one Manager, up to two implementation agents, one QA/Reviewer, real agent processes, worktree isolation, task tracking, verification, independent review, mandatory pre-merge backup, auto-merge, post-merge verification, rollback, persistent state, minimal visual office, live terminal inspection.

## Acceptance tests (`npm test`, all on disposable temp repos)

| Area | Covered by |
|---|---|
| worktree creation / isolation / parallel | `git.test.ts`, `orchestrator.test.ts` (parallel + deps) |
| safe path validation | `git.test.ts` (traversal, symlink, foreign removal, protected paths) |
| task dependencies, blocking | `orchestrator.test.ts` |
| process termination, timeout, cancel | `provider.test.ts`, `orchestrator.test.ts` |
| backup creation, backup failure blocks merge | `git.test.ts`, `orchestrator.test.ts` |
| merge with expected commits (target moved, wrong backup, dirty tree) | `git.test.ts` |
| merge conflicts | `git.test.ts`, `orchestrator.test.ts` |
| failed pre-merge verification / blocking review | `orchestrator.test.ts` |
| failed post-merge verification + rollback | `orchestrator.test.ts` |
| restart recovery (3 crash points) | `orchestrator.test.ts` |
| state machine | `taskMachine.test.ts` |

## Phases

Current status per feature: [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md). Roadmap from the 2026-11 product brief:

0. **Baseline and safety audit:** done (inventory in DEVELOPMENT_PROGRESS.md, competitor notes in COMPETITIVE_ANALYSIS.md).
1. **Professional interface foundation:** done. Pixel office removed; black terminal design system; shell, navigation, overview, inspector, activity panel, command palette on real data.
2. **Core workflow:** goal entry, task graph and real-repo launcher done. Multi-project done. Remaining: interactive sessions, persisted terminal history. Desktop notifications: done.
3. **Review and safety:** agent-backed reviewer and diff viewer started. Remaining: review comments and feedback to agents, syntax-highlighted diff (side-by-side and search done), OS sandboxing and permission profiles. Dedicated merge worktree: done.
4. **Desktop release:** Electron with typed preload, notifications, window state, Windows installer.
5. **Developer experience:** GitHub issues and PRs, dev-server preview, agent profiles, usage tracking.
6. **Later:** scheduled agents, remote workers, Ops mode. Not before the core is reliable.
