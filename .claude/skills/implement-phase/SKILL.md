---
name: implement-phase
description: Implement a phase (or sub-task within a phase) from the project plan with full quality process — plan, implement, cross-model review/fix loop, verify. Use when the user says "implement phase N", "work on phase N", "start phase N", or references a specific phase from docs/project/PROJECT_PLAN.md.
model: claude-opus-4-6
allowed-tools: Agent, Bash, Read, Write, Edit, Grep, Glob
argument-hint: "<phase number or description, e.g. 'Phase 1' or 'Phase 5 - Container Lifecycle'>"
---

# Implement Phase — Full Quality Development Process

You are implementing a phase (or part of a phase) from the Brewet project plan (`docs/project/PROJECT_PLAN.md`). Every change goes through a cross-model review loop before completion.

**Task:** $ARGUMENTS

## GitHub Milestones & Issues

Each phase has a corresponding GitHub Milestone in the repository. Use milestones and issues to track work:

| Phase | Milestone |
|---|---|
| Phase 1 | `Phase 1: Foundation & Project Restructure` |
| Phase 2 | `Phase 2: Storage Backend — Core Setup` |
| Phase 3 | `Phase 3: Storage Backend — Advanced Features` |
| Phase 4 | `Phase 4: BFF Proxy Layer` |
| Phase 5 | `Phase 5: Container Lifecycle Management` |
| Phase 6 | `Phase 6: Storage Service & Management Page` |
| Phase 7 | `Phase 7: Storage Browser — Core` |
| Phase 8 | `Phase 8: Storage Browser — Advanced Features` |
| Phase 9 | `Phase 9: Transfer System` |
| Phase 10 | `Phase 10: Settings Page` |
| Phase 11 | `Phase 11: Helm Chart, Deployment & CI/CD` |
| Phase 12 | `Phase 12: Testing, Polish & Documentation` |

### When to create GitHub Issues

Create issues assigned to the phase milestone in these situations:

- **Deferred work**: A deliverable that cannot be completed in the current session (too large, blocked by an external factor, requires user input that isn't available).
- **Implementation failures**: A feature that was attempted but could not be made to work — document what was tried, what failed, and suggested next steps.
- **Review findings not fixed**: Low-severity review findings that are deferred rather than fixed immediately. Include the reviewer's finding and reasoning for deferral.
- **Known limitations**: Functionality that works but has known edge cases, missing error handling, or incomplete coverage that should be addressed later.
- **Follow-up improvements**: Ideas or improvements discovered during implementation that are out of scope for the current phase but should be tracked.
- **Cross-phase dependencies**: When implementing a phase reveals that a prior phase is missing something, or a future phase needs adjustment.

### Issue format

Use `gh issue create` with appropriate labels:

```bash
gh issue create \
  --title "Brief, actionable title" \
  --body "$(cat <<'EOF'
## Context
[Which phase deliverable this relates to]

## Description
[What needs to be done and why it wasn't done now]

## Acceptance Criteria
- [ ] Specific condition 1
- [ ] Specific condition 2

## Notes
[What was tried, error messages, relevant code locations]
EOF
)" \
  --milestone "Phase N: Title" \
  --label "label1,label2"
```

Use these labels (create them if they don't exist):

| Label | Color | When to use |
|---|---|---|
| `deferred` | `#d4c5f9` | Work postponed to a later session |
| `bug` | `#d73a4a` | Something broken that needs fixing |
| `enhancement` | `#a2eeef` | Improvement or new sub-feature |
| `review-finding` | `#fbca04` | Deferred finding from cross-model review |
| `blocked` | `#b60205` | Cannot proceed without external input or prior work |
| `tech-debt` | `#e4e669` | Known shortcuts or limitations to address later |
| `frontend` | `#1d76db` | Affects plugin frontend (src/) |
| `bff` | `#0e8a16` | Affects BFF (bff/) |
| `storage-backend` | `#5319e7` | Affects storage backend (storage-backend/) |
| `infrastructure` | `#c5def5` | Affects Helm chart, CI/CD, Containerfiles |

### At phase start

Check the milestone for existing open issues — prior sessions may have created issues that are now unblocked or that provide context for the current work:

```bash
gh issue list --milestone "Phase N: Title" --state open
```

If any open issues are addressed during implementation, close them with a reference to the commit:

```bash
gh issue close <number> --comment "Fixed in commit <sha>"
```

### At phase end

After the summary, review uncompleted deliverables and create issues for each one. The summary should reference issue numbers for any deferred work.

## Step 1: Branch Setup

Check the current branch:

```bash
git branch --show-current
```

- If on a long-lived branch (`main`, `dev`, `develop`, `master`): create and checkout a new feature branch from the current HEAD with a descriptive name (e.g., `feat/phase-1-foundation`, `feat/storage-backend-core`, `feat/container-lifecycle`). Feature branches should derive from `dev` (the development branch); if on `main`, switch to `dev` first. Use the phase content to pick a meaningful name.
- If on a feature/topic branch (anything else): proceed on the current branch (the user has already set up their branch).

## Step 2: Understand the Phase

Before writing any code:

1. **Read the project plan** — Read `docs/project/PROJECT_PLAN.md` and locate the phase referenced in the task. Extract:
   - The phase goal
   - All deliverables and sub-tasks
   - Dependencies (which prior phases must be complete)
   - Which components are affected (frontend `src/`, BFF `bff/`, storage backend `storage-backend/`)

2. **Check dependency phases** — If the phase has dependencies, verify they are complete:
   - Check if the expected files/directories from prior phases exist
   - Check git log for commits related to prior phases
   - If dependencies are not met, inform the user and ask how to proceed

3. **Check existing issues** — List open issues for this phase's milestone:
   ```bash
   gh issue list --milestone "Phase N: Title" --state open
   ```
   Factor any existing issues into the implementation plan — some may represent work deferred from a prior session.

4. **Read relevant context** — Launch parallel Explore agents as needed:
   - Read `AGENTS.md` for architecture and conventions
   - Read existing code in the areas that will be modified
   - If porting from ODH-TEC, fetch the relevant source files from `https://github.com/rh-aiservices-bu/odh-tec` using `gh api` commands
   - Read existing skills (`add-page`, `add-bff-endpoint`) if the phase involves adding pages or endpoints

5. **Identify the implementation approach:**
   - List all files to create or modify
   - Determine which sub-tasks can run in parallel vs. which have sequential dependencies
   - Note any decisions that need user input (the plan may have open questions)

## Step 3: Plan & Confirm

Create a task list using `TaskCreate` for each deliverable in the phase. Group related sub-tasks under a single task when they are tightly coupled (e.g., "Create route handler + register route + write test" is one task, not three).

Present a brief summary to the user:

- **Phase N: [Title]** — [goal in one sentence]
- **Tasks:** [numbered list of tasks with estimated complexity: small/medium/large]
- **Components affected:** [frontend / BFF / storage-backend / helm chart / CI]
- **Existing issues:** [list any open issues from the milestone, and whether they'll be addressed]
- **Open questions:** [anything from the plan that needs clarification]
- **Approach:** [whether you'll use parallel agents, which existing skills apply]

Wait for the user to confirm before proceeding. If the phase is large, offer to implement it in sub-batches (e.g., "I can do deliverables 1–4 first, then 5–8").

## Step 4: Implement

Execute the plan, updating task status as you go (`in_progress` when starting, `completed` when done).

### Implementation Rules

- **Read before writing** — always read existing code before modifying or creating similar files
- **Match existing patterns** — follow conventions already in the codebase (import style, component structure, hook patterns, test patterns)
- **Use PatternFly 6** — all UI components use `@patternfly/react-core`, `@patternfly/react-icons`, `@patternfly/react-table`
- **Path alias** — use `~` prefix for imports from `src/` in frontend code (e.g., `import Foo from '~/app/components/Foo'`)
- **TypeScript strict mode** — no `any` types unless absolutely necessary; define proper interfaces
- **Keep `CommunityBanner`** — never remove the community banner component
- **Separate type definitions** — frontend and BFF/storage-backend are separate build targets; duplicate types rather than importing across boundaries

### When Porting from ODH-TEC

- Fetch source files using `gh api repos/rh-aiservices-bu/odh-tec/contents/{path} -q .content | base64 -d`
- Adapt imports: ODH-TEC uses different path aliases and React Router v7 (Brewet uses v7 too but with different routing setup)
- Adapt API URLs: ODH-TEC calls `/api/...` directly; Brewet frontend calls `/brewet/api/{namespace}/...` through the BFF
- Keep the same data structures and algorithms — they are battle-tested
- Update UI patterns to match Brewet's existing component style (check `CommunityBanner`, `ProjectSelector`)

### Parallel Execution

For independent sub-tasks, spawn implementation agents in parallel:

- Use `subagent_type: "general-purpose"` with `model: "sonnet"` for implementation work
- Each agent gets a self-contained brief: what to create, which patterns to follow, which files to read first
- After agents complete, review their output and fix any integration issues

### Commit Strategy

Commit incrementally as logical units complete. Use conventional commit messages:

- `feat: add storage backend bucket routes` (new functionality)
- `refactor: restructure BFF for namespace-scoped proxy` (restructuring)
- `test: add unit tests for transfer queue` (tests only)
- `chore: update Helm chart for storage backend` (infrastructure)
- `fix: address review findings (round N)` (review fixes)

### When Something Cannot Be Completed

If a deliverable cannot be completed during implementation:

1. **Stop and assess** — don't spend excessive time on a single blocker
2. **Create a GitHub issue** assigned to the phase milestone with the appropriate labels
3. **Document clearly**: what was attempted, what failed, error messages, and suggested next steps
4. **Mark the task** as completed with a note referencing the issue number
5. **Continue** with the remaining deliverables

## Step 5: Cross-Model Review Loop

Repeat **up to 3 times**. Stop early if no high or medium severity issues are found.

### 5a: Review

Launch **parallel review agents** for each applicable dimension. Use `model: "opus"` for review agents to get a different perspective from the implementation model.

1. **Code Quality Agent:**
   > Review all code written in this phase. Check:
   > - TypeScript strict compliance (no implicit any, proper null checks)
   > - PatternFly 6 usage (correct component imports, proper props)
   > - React best practices (proper hook dependencies, cleanup in useEffect, no stale closures)
   > - Error handling (loading states, error states, network failures)
   > - Security: no XSS, no command injection, proper input validation
   > - API patterns: correct URL construction, proper streaming handling
   > - Code duplication: ensure no unnecessary repetition
   > - Over-engineering: no premature abstractions, no speculative code
   > Classify issues as high, medium, or low severity.
   > Read AGENTS.md for project conventions.

2. **Architecture Consistency Agent:**
   > Review for architectural consistency with the Brewet three-container model:
   > - Management plane operations use dashboard /api/k8s proxy (not BFF)
   > - Data plane operations go through BFF to storage backend (not direct)
   > - Frontend does not import from bff/ or storage-backend/ directories
   > - BFF handles streaming correctly (no buffering SSE, no corrupting binary)
   > - Storage backend has no auth logic (relies on NetworkPolicy)
   > - K8s resource names follow the conventions in the project plan
   > Read AGENTS.md and docs/project/PROJECT_PLAN.md for the architecture.
   > Classify issues as high, medium, or low severity.

3. **Security Agent** (if phase involves API routes, auth, or K8s operations):
   > Review for security vulnerabilities:
   > - Path traversal in file operations (check validatePath has all 11 security checks)
   > - Injection via user-controlled S3 bucket names or file paths
   > - Sensitive data in logs (S3 credentials, tokens)
   > - CORS misconfiguration
   > - Missing input validation on API endpoints
   > - Proper Bearer token forwarding (not logging, not storing)
   > Classify issues as high, medium, or low severity.

### 5b: Assess

Collect all findings. If there are **no high or medium severity issues**, proceed to Step 6.

### 5c: Fix

If there are high or medium issues:

1. Fix each issue
2. Verify the fix doesn't break other things
3. Commit: `fix: address review findings (round N)`

For **low-severity findings** that are not fixed:
- Create a GitHub issue assigned to the phase milestone with the `review-finding` label
- Include the reviewer's finding, severity, and reasoning for deferral

Then **repeat from 5a** with the updated code.

## Step 6: Verify

Run the full quality gate on affected components:

### Frontend (if `src/` was modified)

```bash
npm run typecheck    # TypeScript compilation
npm run lint         # ESLint + markdownlint
npm test             # Jest tests
```

### BFF (if `bff/` was modified)

```bash
cd bff && npm run lint && npm test
```

### Storage Backend (if `storage-backend/` was modified)

```bash
cd storage-backend && npm run lint && npm test
```

All commands must pass with zero errors. Fix any issues found and commit: `fix: resolve verification issues`

If a command fails because the component doesn't exist yet (e.g., `storage-backend/` hasn't been created in a prior phase), note it in the summary rather than failing.

## Step 7: Issue Cleanup

Before writing the summary:

1. **Close resolved issues** — If any open issues from the milestone were addressed during this session, close them:
   ```bash
   gh issue close <number> --comment "Fixed in commit <sha> during Phase N implementation"
   ```

2. **Create issues for incomplete work** — For each deliverable not completed, create an issue assigned to the milestone.

3. **Create issues for deferred review findings** — For each low-severity finding not fixed, create an issue with the `review-finding` label.

4. **List final issue state**:
   ```bash
   gh issue list --milestone "Phase N: Title" --state all
   ```

## Step 8: Summary

Summarize what was accomplished:

```markdown
## Phase N Implementation Summary

### Phase
[Phase number]: [Phase title] — [one-line goal]

### Branch
[Branch name]

### Changes by Component
- **Frontend (src/):** [files created/modified or "n/a"]
- **BFF (bff/):** [files created/modified or "n/a"]
- **Storage Backend (storage-backend/):** [files created/modified or "n/a"]
- **Helm Chart (chart/):** [files created/modified or "n/a"]
- **CI/CD (.github/):** [files created/modified or "n/a"]
- **Docs:** [files created/modified or "n/a"]
- Total files created: [count]
- Total files modified: [count]

### Review
- Review iterations: [count]
- Issues found and fixed: [count by severity]

### Verification
- Frontend — TypeScript: PASS/FAIL/N/A | Lint: PASS/FAIL/N/A | Tests: PASS/FAIL/N/A
- BFF — Lint: PASS/FAIL/N/A | Tests: PASS/FAIL/N/A
- Storage Backend — Lint: PASS/FAIL/N/A | Tests: PASS/FAIL/N/A

### Phase Deliverables Checklist
[For each deliverable listed in the project plan for this phase:]
- [x] Deliverable 1 — completed
- [x] Deliverable 2 — completed
- [ ] Deliverable 3 — deferred → #[issue number]

### GitHub Issues
- Issues closed this session: [list with numbers]
- Issues created this session: [list with numbers and titles]
- Open issues remaining on milestone: [count]

### Commits
[List of commits created during this implementation]

### Next Phase
[What phase comes next and whether its dependencies are now met]
```
