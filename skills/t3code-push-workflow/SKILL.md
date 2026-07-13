---
name: t3code-push-workflow
description: Safely synchronize this T3 Code fork with the official pingdotgg/t3code repository, maintain a clean mirrored main branch, and commit and push scoped work on codex/* feature branches. Use when asked to sync official updates, configure fork remotes, rebase a T3 Code feature branch, or publish local T3 Code changes to the user's fork.
---

# T3 Code Fork Sync and Push

Keep `origin` as the user's writable fork and `upstream` as the read-only official repository:

```text
origin   https://github.com/Neonity2020/t3code.git
upstream https://github.com/pingdotgg/t3code.git
```

Treat `main` as an exact fast-forward mirror of `upstream/main`. Put all local work on a `codex/<description>` branch.

## Preflight

Run before changing Git state:

```bash
git status --short --branch
git remote -v
```

Stop and ask for direction if the working tree includes changes unrelated to the requested work. Do not stage a mixed worktree with `git add -A`.

If `upstream` is missing, configure it once:

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git remote set-url --push upstream DISABLED
```

Never push to `upstream`.

## Sync the Fork

Only synchronize `main` from a clean working tree:

```bash
git fetch upstream --prune
git switch main
git pull --ff-only origin main
git merge --ff-only upstream/main
git push origin main
```

If either fast-forward step fails, do not force-push or merge arbitrary histories. Inspect the divergence and ask the user how to preserve the fork-only commits.

## Update a Feature Branch

Commit or stash all changes first. Then rebase the feature branch on the freshly synchronized `main`:

```bash
git switch codex/<description>
git rebase main
```

Resolve conflicts deliberately, run the relevant checks, then use `git rebase --continue`. Use `git rebase --abort` to return to the pre-rebase state. Because rebase rewrites branch history, update an already-published feature branch with:

```bash
git push --force-with-lease
```

Never use `--force` or `--force-with-lease` on `main`.

## Commit and Push Feature Work

1. Confirm the intended files with `git status --short` and `git diff --check`.
2. Stage only those paths explicitly.
3. Run the required checks:

   ```bash
   vp check
   vp run typecheck
   ```

   Run `vp run lint:mobile` too when native mobile code changed.

4. Commit with a concise, imperative message.
5. Push a new branch with tracking:

   ```bash
   git push -u origin "$(git branch --show-current)"
   ```

6. For a rebased branch, use `git push --force-with-lease` instead.

Report the branch name, commit SHA, validation results, and any intentionally untracked generated files. Do not create a pull request unless the user asks for one.
