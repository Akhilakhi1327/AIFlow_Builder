# AIFlow Builder - AI Agent Workflow Platform

A multi-tenant workflow builder for chaining AI agent steps, built with Next.js, Hasura, PostgreSQL, and Nhost.

## Architecture & Permissions Write-up

### 1. Schema Design Reasoning
The database is structured to support strict multi-tenancy, granular execution tracking, and metadata version control:
- **`organizations` & `org_members`**: Establish boundaries for tenants. Users are associated with organizations with specific roles (`owner`, `editor`, `viewer`).
- **`workflows` & `workflow_steps` & `workflow_triggers`**: Store workflow configurations. Steps are ordered via a `position` column.
- **`workflow_runs` & `step_runs`**: Capture runtime execution logs. Every execution gets a `workflow_run` (which tracks overall status like `running`, `paused`, `completed`, `failed` and stores initial input payload), and every step in the run creates a `step_run` (which tracks individual step inputs, outputs, errors, attempt counts, and approval logs).
- **`db_write_results` & `notifications`**: Provide isolated audit tables for the `db_write` and `notify` steps.

### 2. Two-Layer Permission Model
To guarantee absolute security, permissions are implemented in two distinct layers:
- **Layer 1: Tenant & Core Role Isolation (Hasura Row-Level Security)**
  Row-level checks are applied on all query and mutation entries:
  - *Read operations*: A user can only select workflows, steps, triggers, and runs if they belong to an organization where they are a registered member (checked via a join filter `members.user_id = X-Hasura-User-Id`).
  - *Write operations*: Insert, update, and delete actions require the user to be a member and have either the `owner` or `editor` role. `viewer` roles are restricted to read-only access.
- **Layer 2: Step-Level Gating & Mid-Execution Authorization**
  - *Schema restrictions*: Custom check filters on `workflow_steps` and `workflow_triggers` enforce that only users with the `owner` role can add or edit `db_write` and `notify` steps, or configure `webhook` triggers. Editors are blocked from executing these actions.
  - *Mid-execution gating*: Resuming a run paused at an `approval_gate` is handled by the `approveStep` Action. The handler verifies the user's role on the server side using a GraphQL check. Only an `owner` or `editor` can clear the gate.

### 3. Approval Gate Pause/Resume Engine
- When the execution engine (`runEngine`) encounters an `approval_gate` step, it inserts a `step_run` record with status `paused`, updates the parent `workflow_run` to `paused`, and exits the execution thread.
- To resume, the authorized user triggers the `approveStep` mutation. The Action handler validates the user's membership and role in the target organization. If authorized, it marks the step run as `completed` (updating `approved_by` and `approved_at`) and triggers the engine asynchronously in a background thread.
- The engine fetches the current run state, skips all previously completed steps, and resumes execution from the first incomplete step.

---

## Local Setup Instructions

### Environment Variables
Create a `.env.local` file in the root directory:
```env
NEXT_PUBLIC_NHOST_SUBDOMAIN=your-nhost-subdomain
NEXT_PUBLIC_NHOST_REGION=your-nhost-region
GEMINI_API_KEY=your-gemini-api-key
```

If you are running the serverless function endpoints, configure the following inside your Nhost Dashboard environment variables or `.secrets` file:
```env
NHOST_GRAPHQL_URL=https://<subdomain>.graphql.<region>.nhost.run/v1/graphql
NHOST_ADMIN_SECRET=your-admin-secret
NHOST_AUTH_URL=https://<subdomain>.auth.<region>.nhost.run/v1
ACTION_SECRET=your-shared-action-secret
GEMINI_API_KEY=your-gemini-api-key
```

### Installation & Run
1. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```
2. Run development server:
   ```bash
   npm run dev
   ```
3. Run automated tests (requires Node 18+ and devDependencies):
   ```bash
   npx tsx scratch/test_flow.ts
   ```

---

## Step-by-Step Demo Walkthrough

### 1. Seeding and Setup
1. Open the application.
2. Click **Seed Testing Environment** on the login screen.
3. This creates:
   - **Org A**: Members are `owner_a@example.com`, `editor_a@example.com`, and `viewer_a@example.com` (password: `password123` for all). Exposes a pre-configured 5-step sentiment analysis workflow.
   - **Org B**: Members are `owner_b@example.com` and `editor_b@example.com` (password: `password123` for all).

### 2. Multi-Role Verification (Org A)
1. **Log in as `viewer_a@example.com`**:
   - Verify you can view the workflow but the **Run Workflow**, **Save Configuration**, and step/trigger editing buttons are hidden/disabled.
2. **Log in as `editor_a@example.com`**:
   - Verify you can edit steps (except `db_write` or `notify` which will trigger permission errors on save).
   - Click **Run Workflow**.
3. **Approval Gate & Live Status**:
   - Watch the live execution status stream progress.
   - The execution runs through `llm_call` and `conditional_branch` and pauses at the `approval_gate` (Step 3).
   - The UI shows "Awaiting Approver Authorization".
4. **Log in as `owner_a@example.com` / `editor_a@example.com`**:
   - Click **Approve and Resume Execution** on the paused step.
   - Watch the workflow resume in real-time, execute the remaining steps (`db_write`), and transition to `completed`.
   - Verify the organization quota usage incremented.

### 3. Inbound Trigger (Database Event)
1. In the sidebar, enter a JSON payload under **Database Event Test**:
   ```json
   { "text": "This product is absolutely amazing!" }
   ```
2. Click **Fire Event Trigger**.
3. This inserts a row in `event_trigger_source` for the workflow.
4. The database event trigger automatically spawns a background run.
5. Inspect the execution history to verify the new run started, ran the LLM check, and paused at the approval gate.

### 4. Cross-Tenant Database Isolation (Org B)
1. **Log in as `owner_b@example.com`**:
   - Verify that you cannot see Org A's workflows.
   - Attempt to manually query Org A's workflow ID or trigger run ID in Apollo Studio/Console, and verify it returns empty/null results due to Layer 1 permissions.
   - Attempt to call `approveStep` on Org A's paused step run ID, and verify the Action returns a `403 Forbidden` error due to Layer 2 server-side validation.
