import triggerWorkflowRun from '../functions/triggerWorkflowRun';
import approveStep from '../functions/approveStep';

const mockWorkflow = {
  id: 'wf-1111-1111',
  org_id: 'org-a-1111',
  organization: {
    id: 'org-a-1111',
    calls_used: 10,
    calls_allowed: 100
  }
};

const mockWorkflowExhausted = {
  id: 'wf-2222-2222',
  org_id: 'org-a-1111',
  organization: {
    id: 'org-a-1111',
    calls_used: 100,
    calls_allowed: 100
  }
};

const mockMembers: Record<string, string> = {
  'user-owner-a': 'owner',
  'user-editor-a': 'editor',
  'user-viewer-a': 'viewer'
};

const mockStepRun = {
  id: 'step-run-999',
  status: 'paused',
  workflow_run_id: 'run-777',
  workflow_run: {
    id: 'run-777',
    workflow: {
      id: 'wf-1111-1111',
      org_id: 'org-a-1111'
    }
  }
};

const mockRes = () => {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.jsonData = data;
    return res;
  };
  return res;
};

const runTests = async () => {
  process.env.ACTION_SECRET = 'secret123';
  process.env.NHOST_GRAPHQL_URL = 'http://localhost:8080/v1/graphql';
  process.env.NHOST_ADMIN_SECRET = 'nhost-admin-secret';

  global.fetch = async (url: any, options: any) => {
    if (String(url).includes('/graphql')) {
      const body = JSON.parse(options.body);
      const query = body.query;
      const vars = body.variables;

      if (query.includes('GetWorkflowOrg')) {
        if (vars.workflowId === 'wf-1111-1111') {
          return {
            json: async () => ({ data: { workflows_by_pk: mockWorkflow } })
          } as any;
        }
        if (vars.workflowId === 'wf-2222-2222') {
          return {
            json: async () => ({ data: { workflows_by_pk: mockWorkflowExhausted } })
          } as any;
        }
        return { json: async () => ({ data: { workflows_by_pk: null } }) } as any;
      }

      if (query.includes('GetMemberRole')) {
        const role = mockMembers[vars.userId];
        if (role && vars.orgId === 'org-a-1111') {
          return {
            json: async () => ({ data: { org_members: [{ role }] } })
          } as any;
        }
        return { json: async () => ({ data: { org_members: [] } }) } as any;
      }

      if (query.includes('InsertRun')) {
        return {
          json: async () => ({ data: { insert_workflow_runs_one: { id: 'run-777' } } })
        } as any;
      }

      if (query.includes('GetStepRunDetails')) {
        if (vars.stepRunId === 'step-run-999') {
          return {
            json: async () => ({ data: { step_runs_by_pk: mockStepRun } })
          } as any;
        }
        return { json: async () => ({ data: { step_runs_by_pk: null } }) } as any;
      }

      if (query.includes('ApproveStep')) {
        return {
          json: async () => ({ data: { update_step_runs_by_pk: { id: vars.id } } })
        } as any;
      }

      if (query.includes('GetRunDetails')) {
        return {
          json: async () => ({
            data: {
              workflow_runs_by_pk: {
                id: 'run-777',
                status: 'running',
                input: { text: 'test input' },
                workflow: {
                  id: 'wf-1111-1111',
                  org_id: 'org-a-1111',
                  steps: []
                }
              }
            }
          })
        } as any;
      }

      if (query.includes('GetStepRuns')) {
        return {
          json: async () => ({ data: { step_runs: [] } })
        } as any;
      }
    }
    return { json: async () => ({ data: {} }) } as any;
  };

  console.log('--- RUNNING TRIGGER WORKFLOW RUN TESTS ---');

  const req1 = {
    headers: { 'x-action-secret': 'secret123' },
    body: {
      input: { workflow_id: 'wf-1111-1111' },
      session_variables: { 'x-hasura-user-id': 'user-owner-a' }
    }
  } as any;
  const res1 = mockRes();
  await triggerWorkflowRun(req1, res1);
  console.log('Owner trigger result:', res1.statusCode, res1.jsonData);
  if (res1.statusCode !== 200 || !res1.jsonData.run_id) {
    throw new Error('Owner failed to trigger workflow');
  }

  const req2 = {
    headers: { 'x-action-secret': 'secret123' },
    body: {
      input: { workflow_id: 'wf-1111-1111' },
      session_variables: { 'x-hasura-user-id': 'user-editor-a' }
    }
  } as any;
  const res2 = mockRes();
  await triggerWorkflowRun(req2, res2);
  console.log('Editor trigger result:', res2.statusCode, res2.jsonData);
  if (res2.statusCode !== 200 || !res2.jsonData.run_id) {
    throw new Error('Editor failed to trigger workflow');
  }

  const req3 = {
    headers: { 'x-action-secret': 'secret123' },
    body: {
      input: { workflow_id: 'wf-1111-1111' },
      session_variables: { 'x-hasura-user-id': 'user-viewer-a' }
    }
  } as any;
  const res3 = mockRes();
  await triggerWorkflowRun(req3, res3);
  console.log('Viewer trigger result (should be 403):', res3.statusCode, res3.jsonData);
  if (res3.statusCode !== 403) {
    throw new Error('Viewer was allowed to trigger workflow');
  }

  const req4 = {
    headers: { 'x-action-secret': 'secret123' },
    body: {
      input: { workflow_id: 'wf-1111-1111' },
      session_variables: { 'x-hasura-user-id': 'user-owner-b' }
    }
  } as any;
  const res4 = mockRes();
  await triggerWorkflowRun(req4, res4);
  console.log('External Org User trigger result (should be 403):', res4.statusCode, res4.jsonData);
  if (res4.statusCode !== 403) {
    throw new Error('External Org User was allowed to trigger workflow');
  }

  const req5 = {
    headers: { 'x-action-secret': 'secret123' },
    body: {
      input: { workflow_id: 'wf-2222-2222' },
      session_variables: { 'x-hasura-user-id': 'user-owner-a' }
    }
  } as any;
  const res5 = mockRes();
  await triggerWorkflowRun(req5, res5);
  console.log('Quota exhausted trigger result (should be 400):', res5.statusCode, res5.jsonData);
  if (res5.statusCode !== 400) {
    throw new Error('Quota exhausted workflow was triggered');
  }

  console.log('\n--- RUNNING APPROVE STEP TESTS ---');

  const reqApp1 = {
    headers: { 'x-action-secret': 'secret123' },
    body: {
      input: { step_run_id: 'step-run-999' },
      session_variables: { 'x-hasura-user-id': 'user-owner-a' }
    }
  } as any;
  const resApp1 = mockRes();
  await approveStep(reqApp1, resApp1);
  console.log('Owner approve result:', resApp1.statusCode, resApp1.jsonData);
  if (resApp1.statusCode !== 200 || !resApp1.jsonData.success) {
    throw new Error('Owner failed to approve step');
  }

  const reqApp2 = {
    headers: { 'x-action-secret': 'secret123' },
    body: {
      input: { step_run_id: 'step-run-999' },
      session_variables: { 'x-hasura-user-id': 'user-editor-a' }
    }
  } as any;
  const resApp2 = mockRes();
  await approveStep(reqApp2, resApp2);
  console.log('Editor approve result:', resApp2.statusCode, resApp2.jsonData);
  if (resApp2.statusCode !== 200 || !resApp2.jsonData.success) {
    throw new Error('Editor failed to approve step');
  }

  const reqApp3 = {
    headers: { 'x-action-secret': 'secret123' },
    body: {
      input: { step_run_id: 'step-run-999' },
      session_variables: { 'x-hasura-user-id': 'user-viewer-a' }
    }
  } as any;
  const resApp3 = mockRes();
  await approveStep(reqApp3, resApp3);
  console.log('Viewer approve result (should be 403):', resApp3.statusCode, resApp3.jsonData);
  if (resApp3.statusCode !== 403) {
    throw new Error('Viewer was allowed to approve step');
  }

  const reqApp4 = {
    headers: { 'x-action-secret': 'secret123' },
    body: {
      input: { step_run_id: 'step-run-999' },
      session_variables: { 'x-hasura-user-id': 'user-owner-b' }
    }
  } as any;
  const resApp4 = mockRes();
  await approveStep(reqApp4, resApp4);
  console.log('External Org User approve result (should be 403):', resApp4.statusCode, resApp4.jsonData);
  if (resApp4.statusCode !== 403) {
    throw new Error('External Org User was allowed to approve step');
  }

  console.log('\nALL TESTS PASSED SUCCESSFULLY!');
};

runTests().catch(err => {
  console.error('TEST FAIL:', err.message);
  process.exit(1);
});
