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

1. **Core loop (this slice, done):** Git control plane, state machine, SQLite, provider interface + command provider, verification, review gate, backup/merge/rollback, recovery, tests, demo.
2. **Real agents and PTY:** (done: CLI detection, argv builders, PTY provider) remaining: wire providers into a real run and verify flags per installed CLI version, agent-backed reviewer, OS-level sandboxing of agent processes (cwd-jail / container), main-tree write prevention instead of detection.
3. **Manager and task graph (done):** Manager proposes JSON, deterministic validator accepts, smallest-team limit. Remaining: project memory, goal input in the UI.
4. **Office UI (done in browser):** tasks, terminal, event log, merges, backups, rollback and cancel. Remaining: diff and reviews views, agents inspector, settings (CLI detection), Electron packaging with typed IPC.
5. **Visual office (done, v1):** canvas scene driven only by `EventBus` events. Remaining: richer states, sprites, sounds.
6. **Later:** dedicated merge worktree, Ops mode, optional VPS coordinator.
