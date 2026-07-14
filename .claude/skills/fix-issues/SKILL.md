---
name: fix-issues
description: Sequentially fix GitHub issues labelled for a given phase — implement, commit/push/PR, review/fix loop, merge, close. Use when the user says "fix issues for phase N", "resolve phase N issues", "fix phase-N issues", or wants to batch-fix labelled issues.
model: claude-opus-4-6
allowed-tools: Agent, Bash, Read, Write, Edit, Grep, Glob
argument-hint: "<phase label, e.g. 'phase-1'> [issue-number]"
---

# Fix Issues — Autonomous Issue Resolution Pipeline

You are an orchestrator that fetches open GitHub issues by phase label, then sequentially fixes each one through a full pipeline: branch creation, implementation, PR, review/fix loop, merge, close.

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

## Step 2: Issue Loop

Process each selected issue sequentially. For each issue:

### 2a: Create Branch

```bash
git checkout $BASE_BRANCH
git pull origin $BASE_BRANCH
git checkout -b <type>/<issue#>-<short-kebab-description>
```

Branch name example: `fix/2-scale-put-unchecked-response`

Fetch full issue details for the implementation agent:

```bash
gh issue view <number>
```

### 2b: Implement (Sonnet Agent)

Spawn an implementation **Agent** with `model: "sonnet"`:

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
>
> Do NOT push or create a PR — only implement and commit locally.

### 2c: Push & Create PR

After the implementation agent completes, the orchestrator handles PR creation directly:

```bash
git push -u origin <branch-name>

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

Save the PR number from the output for subsequent steps.

### 2d: Review/Fix Loop (up to 4 iterations)

Repeat the following **up to 4 times**. Stop early if the review finds no high or medium severity issues.

#### Review Phase

Spawn a **fresh general-purpose Agent** (default model — Opus):

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

- **PASS** (no high/medium issues) → proceed to **Step 2e** (merge)
- **NEEDS_FIXES** → continue to Fix Phase
- If this is **iteration 4** and still NEEDS_FIXES:
  - If only a few medium issues remain → proceed to merge anyway (pragmatic cutoff)
  - If high severity issues remain → **skip this issue** — leave the PR open, add a comment noting it needs manual attention, and move to the next issue

#### Fix Phase

Spawn a **fresh Sonnet Agent** with `model: "sonnet"`:

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
> 5. Push the changes: `git push`
>
> Do NOT create a new PR — just fix, commit, and push to the existing branch.

Then **repeat from Review Phase** with a fresh review agent.

### 2e: Merge & Close

Once the review passes:

```bash
# Squash merge to keep history clean
gh pr merge <pr-number> --squash --delete-branch

# Switch back to base branch and pull
git checkout $BASE_BRANCH
git pull origin $BASE_BRANCH
```

The `Closes #<issue>` in the PR body auto-closes the issue on merge. Verify:

```bash
gh issue view <number> --json state --jq '.state'
```

If still open:

```bash
gh issue close <number>
```

### 2f: Continue

Proceed to the next open issue with the phase label. Repeat from **Step 2a**.

## Step 3: Summary

After all issues have been processed, output a structured summary:

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

## Error Handling

- **Implementation agent fails:** Log the error, skip the issue, clean up the branch, move to next issue.
- **PR creation fails:** Log the error, skip the issue, move to next issue.
- **Review agent fails:** Treat as PASS for that round (don't block on review infrastructure issues). Log a warning.
- **Merge conflicts:** If the base branch has diverged and merge fails, attempt `git pull origin $BASE_BRANCH --rebase` on the fix branch and retry. If that fails, skip the issue.
- **Branch cleanup on skip:** If skipping an issue, leave the branch and PR open for manual attention.
