import { Request, Response } from 'express';
import { runEngine } from './engine';

async function queryHasura(query: string, variables: any = {}) {
  const res = await fetch(process.env.NHOST_GRAPHQL_URL || 'http://localhost:8080/v1/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': process.env.NHOST_ADMIN_SECRET || 'nhost-admin-secret'
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(JSON.stringify(data.errors));
  }
  return data.data;
}

export default async (req: Request, res: Response) => {
  try {
    const actionSecret = req.headers['x-action-secret'];
    const expectedSecret = process.env.ACTION_SECRET;
    if (expectedSecret && actionSecret !== expectedSecret) {
      return res.status(401).json({ message: 'Unauthorized action call' });
    }

    const { step_run_id } = req.body.input;
    const sessionVars = req.body.session_variables || {};
    const userId = sessionVars['x-hasura-user-id'];

    if (!userId) {
      return res.status(401).json({ message: 'User context is missing' });
    }

    const stepRunData = await queryHasura(`
      query GetStepRunDetails($stepRunId: uuid!) {
        step_runs_by_pk(id: $stepRunId) {
          id
          status
          workflow_run_id
          workflow_run {
            id
            workflow {
              id
              org_id
            }
          }
        }
      }
    `, { stepRunId: step_run_id });

    const sr = stepRunData.step_runs_by_pk;
    if (!sr) {
      return res.status(404).json({ message: 'Step run not found' });
    }

    if (sr.status !== 'paused') {
      return res.status(400).json({ message: 'Step run is not paused' });
    }

    const orgId = sr.workflow_run.workflow.org_id;
    const runId = sr.workflow_run_id;

    const memberData = await queryHasura(`
      query GetMemberRole($orgId: uuid!, $userId: uuid!) {
        org_members(where: {org_id: {_eq: $orgId}, user_id: {_eq: $userId}}) {
          role
        }
      }
    `, { orgId, userId });

    const member = memberData.org_members[0];
    if (!member || (member.role !== 'owner' && member.role !== 'editor')) {
      return res.status(403).json({ message: 'Only owners and editors can approve steps' });
    }

    await queryHasura(`
      mutation ApproveStep($id: uuid!, $userId: uuid!, $now: timestamptz!) {
        update_step_runs_by_pk(
          pk_columns: {id: $id},
          _set: {
            status: "completed",
            approved_by: $userId,
            approved_at: $now,
            output: { approved: true }
          }
        ) {
          id
        }
        update_workflow_runs_by_pk(
          pk_columns: {id: $workflow_run_id},
          _set: { status: "running" }
        ) {
          id
        }
      }
    `, { id: step_run_id, userId, now: new Date().toISOString(), workflow_run_id: runId });

    runEngine(runId);

    return res.status(200).json({
      success: true,
      status: 'resumed'
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
