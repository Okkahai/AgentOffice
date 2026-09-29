# Agent Office

Local-first visual workspace where real coding agents work in isolated Git worktrees. Agents propose; deterministic code enforces safety (backups, merges, rollback, audit).

Status: **core loop slice**. No UI yet. See [docs/architecture.md](docs/architecture.md) and [docs/plan.md](docs/plan.md).

```
npm install
npm test          # 31 integration tests on disposable temp repos (Node >= 22.18, git)
npm run typecheck
npm run demo      # full loop on a throwaway repo, prints the event trail
```

No AI CLI or API key is needed; tests use a scripted fake agent process.
