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

    const { workflow_id } = req.body.input;
    const sessionVars = req.body.session_variables || {};
    const userId = sessionVars['x-hasura-user-id'];

    if (!userId) {
      return res.status(401).json({ message: 'User context is missing' });
    }

    const workflowData = await queryHasura(`
      query GetWorkflowOrg($workflowId: uuid!) {
        workflows_by_pk(id: $workflowId) {
          id
          org_id
          organization {
            id
            calls_used
            calls_allowed
          }
        }
      }
    `, { workflowId: workflow_id });

    const w = workflowData.workflows_by_pk;
    if (!w) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const orgId = w.org_id;
    const org = w.organization;

    const memberData = await queryHasura(`
      query GetMemberRole($orgId: uuid!, $userId: uuid!) {
        org_members(where: {org_id: {_eq: $orgId}, user_id: {_eq: $userId}}) {
          role
        }
      }
    `, { orgId, userId });

    const member = memberData.org_members[0];
    if (!member || (member.role !== 'owner' && member.role !== 'editor')) {
      return res.status(403).json({ message: 'Only owners and editors can trigger workflows' });
    }

    if (org.calls_used >= org.calls_allowed) {
      return res.status(400).json({ message: 'Organization quota is exhausted' });
    }

    const runInsert = await queryHasura(`
      mutation InsertRun($workflowId: uuid!, $userId: uuid!) {
        insert_workflow_runs_one(object: {
          workflow_id: $workflowId,
          status: "running",
          triggered_by: $userId
        }) {
          id
        }
      }
    `, { workflowId: workflow_id, userId });

    const runId = runInsert.insert_workflow_runs_one.id;

    runEngine(runId);

    return res.status(200).json({
      run_id: runId,
      status: 'running'
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};
