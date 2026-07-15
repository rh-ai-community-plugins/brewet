---
name: fix-issues
description: Sequentially fix GitHub issues labelled for a given phase — implement, commit/push/PR, review/fix loop, merge, close. Use when the user says "fix issues for phase N", "resolve phase N issues", "fix phase-N issues", or wants to batch-fix labelled issues.
model: claude-opus-4-6
allowed-tools: Agent, Bash, Read, Write, Edit, Grep, Glob
argument-hint: "<phase label, e.g. 'phase-1'> [issue-number]"
---

# Fix Issues — Autonomous Issue Resolution Pipeline

You are an orchestrator that fetches open GitHub issues by phase label, then fixes each one through a full pipeline: branch creation, implementation, PR, review/fix loop, merge, close.

**Context clearing is critical.** Spawn a **fresh subagent** for every implementation, review, and fix phase. This ensures unbiased reviews — the review agent must never share context with the implementation agent.

**Task:** Process issues from `$ARGUMENTS`

## Step 1: Parse Inputs & Setup

Parse `$ARGUMENTS` to extract:

- **Phase label** (required) — e.g., `phase-1`, `phase-2`. This is the GitHub label used to filter issues.
- **Issue number** (optional) — if provided, only fix that specific issue (still must carry the phase label).

Then:

1. **Fetch open issues** for the phase label, sorted by issue number (oldest first):

   ```bash
   gh issue list --label "<phase-label>" --state open --json number,title,labels,body --limit 100
   ```

2. **For each issue**, extract:
   - Issue number
   - Title
   - Labels (to determine type: `bug` → `fix/`, `tech-debt` → `chore/`, `enhancement` → `feat/`, default → `fix/`)
   - Body (full description with root cause, failure scenario, suggested fix)

3. **Filter:** If an issue number was provided, select only that issue. Otherwise, process all open issues in order.

4. **Determine the base branch.** Read the branching strategy from CLAUDE.md/AGENTS.md:
   - If a long-lived feature branch exists for this phase (e.g., `feat/phase-1-foundation`), use it as `$BASE_BRANCH`
   - Otherwise use `dev` as `$BASE_BRANCH`
   - Confirm the branch exists: `git branch -a | grep <branch>`

   ```bash
   git checkout $BASE_BRANCH
   git pull origin $BASE_BRANCH
   ```

5. **Ensure `$BASE_BRANCH` is on remote** (push if needed):

   ```bash
   git push -u origin $BASE_BRANCH
   ```

6. **Map labels to branch prefixes:**
   - `bug` → `fix/`
   - `enhancement` → `feat/`
   - `tech-debt` → `chore/`
   - Default → `fix/`

## Step 1b: Build Execution Plan

Before processing issues, analyze them to determine which can be parallelized safely using worktree isolation.

For each issue, extract the **files and areas** it references from its body (issue bodies typically mention specific file paths). Group issues into **parallel batches**:

- Issues referencing **non-overlapping files** can run in the same batch (parallel via worktrees)
- Issues referencing **overlapping files** must be in separate batches (sequential)
- If file scope is unclear from the issue body, default to sequential (safer)

**Output an execution plan** like:

```
Batch 1 (parallel): #72 (k8sResources, webpack, values.yaml), #73 (BrewetContext)
Batch 2 (parallel): #76 (useBrewetContainer), #81 (ContainerWizard imports)
Batch 3 (sequential): #79 (context + hook), #80 (ContainerWizard + parents)
```

**Rules:**
- Order batches so that foundational changes (types, context, shared utilities) come first
- Within a batch, each issue gets its own worktree — no shared state
- If only a single issue was requested, skip batching entirely

## Step 2: Process Batches

For each batch from the execution plan:

### 2a: Implement Batch (parallel worktrees)

For each issue in the batch, simultaneously:

1. Fetch full issue details:

   ```bash
   gh issue view <number>
   ```

2. Spawn an implementation **Agent** with `model: "sonnet"` and `isolation: "worktree"`:

   > **Context:** You are fixing GitHub issue #`<number>` for the Brewet project.
   >
   > **Issue details:**
   > `<full output from gh issue view>`
   >
   > **Instructions:**
   >
   > 1. Read the CLAUDE.md and AGENTS.md files for project conventions
   > 2. Read existing code in the areas that need modification
   > 3. Plan the fix — identify root cause (the issue body usually contains this), determine which files to change
   > 4. Implement the fix following project conventions (PatternFly 6, TypeScript strict, `~` path alias in source)
   > 5. Update or add tests as needed for the fix
   > 6. Run verification:
   >    - Lint: `npm run lint`
   >    - Tests: `npm test`
   >    - If BFF files changed: `cd bff && npm test && npm run lint`
   >    - If storage-backend files changed: `cd storage-backend && npm test && npm run lint`
   > 7. Commit with a conventional commit message: `fix(<scope>): <description>`
   >    - Do NOT manually add `Signed-off-by` or `Co-Authored-By` lines — the commit hook handles this automatically
   > 8. Push the branch: `git push -u origin HEAD`
   >
   > Do NOT create a PR — only implement, commit, and push.

Wait for all agents in the batch to complete.

### 2b: Push & Create PR

For each completed issue in the batch, the orchestrator creates the PR:

1. Identify the branch name from the agent's worktree result.

2. Clean up commit message trailers before creating the PR:

   ```bash
   # Strip duplicate Signed-off-by / Co-Authored-By trailers left by agent commits
   # The commit hook will add the correct ones automatically
   git checkout <branch-name>
   CLEAN_MSG=$(git log -1 --format='%B' | sed '/^---$/,/^$/d; /^Signed-off-by:/d; /^Co-Authored-By:/d' | sed -e :a -e '/^\n*$/{$d;N;ba}')
   git commit --amend -m "$CLEAN_MSG"
   git push --force-with-lease
   ```

3. Create the PR:

   ```bash
   gh pr create --base $BASE_BRANCH \
     --title "<type>(<scope>): <description>" \
     --body "$(cat <<'PREOF'
   ## Summary
   <1-3 bullet points describing the fix>

   Closes #<issue>

   ## Test Plan
   - [ ] Lint passes (`npm run lint`)
   - [ ] Frontend tests pass (`npm test`)
   - [ ] BFF tests pass (if applicable: `cd bff && npm test`)
   - [ ] Storage backend tests pass (if applicable: `cd storage-backend && npm test`)
   PREOF
   )"
   ```

4. Save the PR number for subsequent steps.

### 2c: Review/Fix Loop (up to 4 iterations per issue)

For each issue's PR, sequentially:

Repeat the following **up to 4 times**. Stop early if the review finds no high or medium severity issues.

#### Review Phase

Spawn a **fresh Agent** with `model: "opus"`:

> **Task:** Review PR #`<pr-number>` for the Brewet project.
>
> 1. Fetch the PR diff:
>
>    ```bash
>    gh pr diff <pr-number>
>    ```
>
> 2. Read every changed file in full to understand context.
>
> 3. Check for:
>    - **Correctness:** Does the fix actually address the issue? Any new bugs introduced?
>    - **Tests:** Are the tests adequate? Do they cover the failure scenario from the issue?
>    - **Conventions:** PatternFly 6, TypeScript strict, `~` path alias, no unnecessary comments
>    - **Regressions:** Does the fix break any existing functionality?
>    - **TypeScript compilation:** Run `npx tsc --noEmit` and report any errors
>
> 4. Compile a structured summary:
>    - **High severity:** Issues that must be fixed (bugs, broken functionality, missing error handling)
>    - **Medium severity:** Issues that should be fixed (inadequate tests, convention violations)
>    - **Low severity:** Cosmetic or trivial (naming, minor style)
>    - **Verdict:** PASS (no high/medium issues) or NEEDS_FIXES (list specific actionable items)
>
> Return ONLY the structured summary.

#### Assess

Evaluate the review summary:

- **PASS** (no high/medium issues) → proceed to **Step 2d** (merge)
- **NEEDS_FIXES** → continue to Fix Phase
- If this is **iteration 4** and still NEEDS_FIXES:
  - If only a few medium issues remain → proceed to merge anyway (pragmatic cutoff)
  - If high severity issues remain → **skip this issue** — leave the PR open, add a comment noting it needs manual attention, and move to the next issue

#### Fix Phase

Spawn a **fresh Agent** with `model: "sonnet"` and `isolation: "worktree"`:

> **Context:** You are fixing review findings for PR #`<pr-number>` (round `<N>` of 4) on the Brewet project.
>
> **Review findings to address (high and medium severity only):**
> `<paste the specific actionable items from the review>`
>
> **Instructions:**
>
> 1. Read the files mentioned in the review findings
> 2. Fix each issue, ensuring the fix doesn't break anything
> 3. Run verification:
>    - Lint: `npm run lint`
>    - Tests: `npm test`
>    - If BFF files changed: `cd bff && npm test && npm run lint`
> 4. Commit with message: `fix: address PR review findings (round <N>)`
>    - Do NOT manually add `Signed-off-by` or `Co-Authored-By` lines — the commit hook handles this automatically
> 5. Push the changes: `git push`
>
> Do NOT create a new PR — just fix, commit, and push to the existing branch.

After the fix agent completes, clean up commit trailers (same as Step 2b), then **repeat from Review Phase** with a fresh review agent.

### 2d: Merge & Close

Once the review passes:

```bash
# Squash merge to keep history clean
gh pr merge <pr-number> --squash --delete-branch

# Switch back to base branch and pull
git checkout $BASE_BRANCH
git pull origin $BASE_BRANCH
```

The `Closes #<issue>` in the PR body auto-closes the issue on merge to the default branch. Since feature branches are not the default branch, verify and close manually:

```bash
gh issue view <number> --json state --jq '.state'
```

If still open:

```bash
gh issue close <number> --comment "Fixed in #<pr-number>"
```

### 2e: Cleanup Batch

After all issues in the batch are processed:

1. Switch to `$BASE_BRANCH` and pull:

   ```bash
   git checkout $BASE_BRANCH
   git pull origin $BASE_BRANCH
   ```

2. Verify clean working tree:

   ```bash
   git status
   ```

   If there are uncommitted changes (agent leftovers), restore files to HEAD:

   ```bash
   git restore --staged . 2>/dev/null
   git checkout -- . 2>/dev/null
   ```

3. Delete orphaned remote branches from this batch (agent worktrees may push branches that `--delete-branch` doesn't know about):

   ```bash
   git fetch --prune origin
   git branch -r | grep -E "origin/(worktree-agent|fix/|feat/|chore/)" | grep -v "$BASE_BRANCH" | sed 's|origin/||' | while read b; do
     # Only delete if the branch has no open PR
     pr_state=$(gh pr list --head "$b" --state open --json number --jq 'length' 2>/dev/null)
     if [ "$pr_state" = "0" ] || [ -z "$pr_state" ]; then
       git push origin --delete "$b" 2>/dev/null
     fi
   done
   ```

4. Continue to the next batch.

**Important:** Do NOT use `git stash` during the pipeline. If uncommitted changes from one issue are present when switching to the next, either commit them to the current branch before switching, or discard them with `git checkout -- .`. Stashes create cleanup debt and may be blocked by safety hooks.

## Step 3: Summary

After all batches have been processed, output a structured summary:

```markdown
## Fix Issues Summary

### Phase Label
<label>

### Base Branch
<branch name>

### Results
| Issue | Title | Branch | PR | Review Rounds | Result |
|-------|-------|--------|-----|---------------|--------|
| #NNN  | ...   | ...    | #XX | N             | Merged / Skipped / Failed |

### Statistics
- Issues attempted: X
- Issues merged: X
- Issues skipped (unresolved review findings): X
- Issues failed (implementation error): X
- Total review iterations: X

### Open Items
[List any issues left open with reasons]
```

## Step 4: Final Cleanup

Before finishing, ensure the repository is left in a clean state:

1. Checkout `$BASE_BRANCH` and pull latest:

   ```bash
   git checkout $BASE_BRANCH
   git pull origin $BASE_BRANCH
   ```

2. Verify clean working tree:

   ```bash
   git status
   ```

   If uncommitted changes exist, discard them:

   ```bash
   git restore --staged . 2>/dev/null
   git checkout -- . 2>/dev/null
   ```

3. Delete leftover local branches from this session that weren't cleaned up by `--delete-branch`:

   ```bash
   git branch | grep -E "^  (fix|feat|chore|worktree-agent)/" | xargs git branch -d 2>/dev/null
   ```

4. Delete orphaned remote branches from this session (agent worktrees, un-cleaned fix branches):

   ```bash
   git fetch --prune origin
   git branch -r | grep -E "origin/(worktree-agent|fix/|feat/|chore/)" | grep -v "$BASE_BRANCH" | sed 's|origin/||' | while read b; do
     pr_state=$(gh pr list --head "$b" --state open --json number --jq 'length' 2>/dev/null)
     if [ "$pr_state" = "0" ] || [ -z "$pr_state" ]; then
       git push origin --delete "$b" 2>/dev/null
     fi
   done
   ```

5. Verify no stashes were left behind:

   ```bash
   git stash list
   ```

   If any exist, warn the user (do not force-drop — safety hooks may block it).

6. Final verification:

   ```bash
   git status
   git stash list
   git branch
   git branch -r | grep -v "$BASE_BRANCH\|main\|dev\|HEAD"
   ```

   Report the final state to the user, including any remaining remote branches.

## Error Handling

- **Implementation agent fails:** Log the error, skip the issue, clean up the branch, move to next issue.
- **PR creation fails:** Log the error, skip the issue, move to next issue.
- **Review agent fails:** Treat as PASS for that round (don't block on review infrastructure issues). Log a warning.
- **Merge conflicts:** If the base branch has diverged and merge fails, attempt `git pull origin $BASE_BRANCH --rebase` on the fix branch and retry. If that fails, skip the issue.
- **Branch cleanup on skip:** If skipping an issue, leave the branch and PR open for manual attention.
