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
    const event = req.body.event;
    if (!event || event.op !== 'INSERT') {
      return res.status(200).json({ success: true, message: 'Skipped non-insert event' });
    }

    const newRow = event.data.new;
    const { workflow_id, data: triggerData } = newRow;

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

    if (org.calls_used >= org.calls_allowed) {
      return res.status(400).json({ message: 'Organization quota is exhausted' });
    }

    const runInsert = await queryHasura(`
      mutation InsertRun($workflowId: uuid!, $input: jsonb!) {
        insert_workflow_runs_one(object: {
          workflow_id: $workflowId,
          status: "running",
          input: $input
        }) {
          id
        }
      }
    `, { workflowId: workflow_id, input: triggerData });

    const runId = runInsert.insert_workflow_runs_one.id;

    runEngine(runId);

    return res.status(200).json({
      success: true,
      run_id: runId
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
