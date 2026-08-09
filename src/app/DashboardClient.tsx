'use client';

import React, { useState, useEffect } from 'react';
import { useSignInEmailPassword, useSignOut, useAuthenticated, useNhostClient, useUserData } from '@nhost/react';
import { useQuery, useMutation, useSubscription, gql } from '@apollo/client';

const GET_MY_ORGS = gql`
  query GetMyOrgs {
    org_members {
      role
      organization {
        id
        name
        calls_used
        calls_allowed
      }
    }
  }
`;

const GET_WORKFLOWS = gql`
  query GetWorkflows($orgId: uuid!) {
    workflows(where: {org_id: {_eq: $orgId}}) {
      id
      name
      steps(order_by: {position: asc}) {
        id
        type
        config
        position
      }
      triggers {
        id
        type
        config
      }
      runs(order_by: {created_at: desc}, limit: 5) {
        id
        status
        created_at
      }
    }
  }
`;

const SAVE_WORKFLOW = gql`
  mutation SaveWorkflow($workflowId: uuid!, $name: String!, $steps: [workflow_steps_insert_input!]!, $triggers: [workflow_triggers_insert_input!]!) {
    update_workflows_by_pk(pk_columns: {id: $workflowId}, _set: {name: $name}) {
      id
    }
    delete_workflow_steps(where: {workflow_id: {_eq: $workflowId}}) {
      affected_rows
    }
    insert_workflow_steps(objects: $steps) {
      affected_rows
    }
    delete_workflow_triggers(where: {workflow_id: {_eq: $workflowId}}) {
      affected_rows
    }
    insert_workflow_triggers(objects: $triggers) {
      affected_rows
    }
  }
`;

const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!) {
    insert_workflows_one(object: {org_id: $orgId, name: $name}) {
      id
      name
    }
  }
`;

const TRIGGER_RUN = gql`
  mutation TriggerRun($workflowId: uuid!) {
    triggerWorkflowRun(workflow_id: $workflowId) {
      run_id
      status
    }
  }
`;

const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(step_run_id: $stepRunId) {
      success
      status
    }
  }
`;

const INSERT_EVENT_SOURCE = gql`
  mutation InsertEventSource($workflowId: uuid!, $data: jsonb!) {
    insert_event_trigger_source_one(object: {workflow_id: $workflowId, data: $data}) {
      id
    }
  }
`;

const RUN_SUBSCRIPTION = gql`
  subscription GetStepRuns($runId: uuid!) {
    step_runs(where: {workflow_run_id: {_eq: $runId}}, order_by: {created_at: asc}) {
      id
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      step {
        id
        type
        position
      }
    }
    workflow_runs_by_pk(id: $runId) {
      id
      status
    }
  }
`;

interface MockOrg {
  id: string;
  name: string;
  calls_used: number;
  calls_allowed: number;
}

interface MockMember {
  userId: string;
  email: string;
  orgId: string;
  role: string;
}

interface MockWorkflow {
  id: string;
  orgId: string;
  name: string;
  steps: any[];
  triggers: any[];
}

interface MockRun {
  id: string;
  workflowId: string;
  status: string;
  input: any;
  created_at: string;
}

interface MockStepRun {
  id: string;
  runId: string;
  stepId: string;
  status: string;
  input: any;
  output: any;
  error: string;
  attempt_count: number;
  approved_by?: string;
  approved_at?: string;
}

const DEFAULT_MOCK_USERS = [
  { email: 'owner@gmail.com', password: 'owner123', role: 'owner', orgName: 'Org A' },
  { email: 'editor@gmail.com', password: 'editor123', role: 'editor', orgName: 'Org A' },
  { email: 'viewer@gmail.com', password: 'viewer123', role: 'viewer', orgName: 'Org A' },
  { email: 'owner_b@gmail.com', password: 'owner_b123', role: 'owner', orgName: 'Org B' },
  { email: 'editor_b@gmail.com', password: 'editor_b123', role: 'editor', orgName: 'Org B' }
];

export default function DashboardClient() {
  const nhostIsAuthenticated = useAuthenticated();
  const nhost = useNhostClient();
  const nhostUserData = useUserData();
  const { signOut: nhostSignOut } = useSignOut();

  const [useMocks, setUseMocks] = useState(false);
  const [mockUser, setMockUser] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [authError, setAuthError] = useState('');

  const { signInEmailPassword, isLoading: isAuthLoading } = useSignInEmailPassword();

  const [activeOrg, setActiveOrg] = useState<{ id: string; name: string; role: string; calls_used: number; calls_allowed: number } | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [newWorkflowName, setNewWorkflowName] = useState('');

  const [editingName, setEditingName] = useState('');
  const [steps, setSteps] = useState<any[]>([]);
  const [triggers, setTriggers] = useState<any[]>([]);
  const [saveStatus, setSaveStatus] = useState('');
  const [dbEventPayload, setDbEventPayload] = useState('{"text": "I love the new features, great job!"}');

  const [mockOrgs, setMockOrgs] = useState<MockOrg[]>([]);
  const [mockMembers, setMockMembers] = useState<MockMember[]>([]);
  const [mockWorkflows, setMockWorkflows] = useState<MockWorkflow[]>([]);
  const [mockRuns, setMockRuns] = useState<MockRun[]>([]);
  const [mockStepRuns, setMockStepRuns] = useState<MockStepRun[]>([]);

  const seedLocalDatabase = () => {
    const orgs = [
      { id: 'org-a-uuid', name: 'Org A', calls_used: 0, calls_allowed: 1000 },
      { id: 'org-b-uuid', name: 'Org B', calls_used: 5, calls_allowed: 5 }
    ];
    const members = DEFAULT_MOCK_USERS.map((u, i) => ({
      userId: `user-id-${i}`,
      email: u.email,
      orgId: u.orgName === 'Org A' ? 'org-a-uuid' : 'org-b-uuid',
      role: u.role
    }));
    const wfs = [
      {
        id: 'wf-a-uuid',
        orgId: 'org-a-uuid',
        name: 'Customer Feedback Router',
        steps: [
          {
            id: 'step-1-uuid',
            type: 'llm_call',
            position: 1,
            config: {
              prompt: 'Categorize the sentiment of the following customer feedback: "{{input}}". Respond with only one word: positive or negative.'
            }
          },
          {
            id: 'step-2-uuid',
            type: 'conditional_branch',
            position: 2,
            config: {
              expression: "input.text.trim().toLowerCase().includes('positive')",
              true_position: 3,
              false_position: 4
            }
          },
          {
            id: 'step-3-uuid',
            type: 'approval_gate',
            position: 3,
            config: {}
          },
          {
            id: 'step-4-uuid',
            type: 'http_request',
            position: 4,
            config: {
              url: 'https://httpbin.org/post',
              method: 'POST',
              body: '{"text": "{{input}}", "sentiment": "negative"}'
            }
          },
          {
            id: 'step-5-uuid',
            type: 'db_write',
            position: 5,
            config: {
              data: {
                message: 'Feedback processed successfully'
              }
            }
          }
        ],
        triggers: [
          { id: 'trig-1', type: 'manual', config: {} },
          { id: 'trig-2', type: 'webhook', config: {} }
        ]
      }
    ];

    localStorage.setItem('mock_orgs', JSON.stringify(orgs));
    localStorage.setItem('mock_members', JSON.stringify(members));
    localStorage.setItem('mock_workflows', JSON.stringify(wfs));
    localStorage.setItem('mock_runs', JSON.stringify([]));
    localStorage.setItem('mock_step_runs', JSON.stringify([]));

    setMockOrgs(orgs);
    setMockMembers(members);
    setMockWorkflows(wfs);
  };

  useEffect(() => {
    const isLocal = !process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN ||
                    process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN === 'local' ||
                    process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN === 'your-nhost-subdomain' ||
                    (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'));

    if (isLocal) {
      localStorage.setItem('use_local_mocks', 'true');
      setUseMocks(true);
      if (!localStorage.getItem('mock_orgs')) {
        seedLocalDatabase();
      }
      setMockUser(localStorage.getItem('mock_logged_in_user'));
      setMockOrgs(JSON.parse(localStorage.getItem('mock_orgs') || '[]'));
      setMockMembers(JSON.parse(localStorage.getItem('mock_members') || '[]'));
      setMockWorkflows(JSON.parse(localStorage.getItem('mock_workflows') || '[]'));
      setMockRuns(JSON.parse(localStorage.getItem('mock_runs') || '[]'));
      setMockStepRuns(JSON.parse(localStorage.getItem('mock_step_runs') || '[]'));
    } else {
      const enabled = localStorage.getItem('use_local_mocks') === 'true';
      setUseMocks(enabled);
      if (enabled) {
        setMockUser(localStorage.getItem('mock_logged_in_user'));
        setMockOrgs(JSON.parse(localStorage.getItem('mock_orgs') || '[]'));
        setMockMembers(JSON.parse(localStorage.getItem('mock_members') || '[]'));
        setMockWorkflows(JSON.parse(localStorage.getItem('mock_workflows') || '[]'));
        setMockRuns(JSON.parse(localStorage.getItem('mock_runs') || '[]'));
        setMockStepRuns(JSON.parse(localStorage.getItem('mock_step_runs') || '[]'));
      }
    }
  }, []);

  const isAuthenticated = useMocks ? !!mockUser : nhostIsAuthenticated;
  const userData = useMocks ? { email: mockUser } : nhostUserData;

  const { data: orgsData, refetch: refetchOrgs } = useQuery(GET_MY_ORGS, {
    skip: !isAuthenticated || useMocks
  });

  const { data: workflowsData, refetch: refetchWorkflows } = useQuery(GET_WORKFLOWS, {
    variables: { orgId: activeOrg?.id },
    skip: !activeOrg || useMocks
  });

  const [saveWorkflow] = useMutation(SAVE_WORKFLOW);
  const [createWorkflow] = useMutation(CREATE_WORKFLOW);
  const [triggerRun] = useMutation(TRIGGER_RUN);
  const [approveStep] = useMutation(APPROVE_STEP);
  const [insertEventSource] = useMutation(INSERT_EVENT_SOURCE);

  useEffect(() => {
    if (useMocks && mockUser) {
      const uMembership = mockMembers.find(m => m.email === mockUser);
      if (uMembership) {
        const org = mockOrgs.find(o => o.id === uMembership.orgId);
        if (org) {
          setActiveOrg({
            id: org.id,
            name: org.name,
            role: uMembership.role,
            calls_used: org.calls_used,
            calls_allowed: org.calls_allowed
          });
        }
      }
    }
  }, [useMocks, mockUser, mockOrgs, mockMembers]);

  useEffect(() => {
    if (useMocks && activeOrg) {
      const wfs = mockWorkflows.filter(w => w.orgId === activeOrg.id);
      if (wfs.length > 0) {
        if (!selectedWorkflowId) {
          setSelectedWorkflowId(wfs[0].id);
        }
      } else {
        setSelectedWorkflowId(null);
      }
    }
  }, [useMocks, activeOrg, mockWorkflows]);

  useEffect(() => {
    if (useMocks && selectedWorkflowId) {
      const wf = mockWorkflows.find(w => w.id === selectedWorkflowId);
      if (wf) {
        setEditingName(wf.name);
        setSteps(wf.steps.map((s: any) => ({
          id: s.id,
          type: s.type,
          position: s.position,
          config: JSON.stringify(s.config, null, 2)
        })));
        setTriggers(wf.triggers.map((t: any) => ({
          id: t.id,
          type: t.type,
          config: JSON.stringify(t.config, null, 2)
        })));
      }
    }
  }, [useMocks, selectedWorkflowId, mockWorkflows]);

  useEffect(() => {
    if (!useMocks && orgsData?.org_members?.length > 0) {
      if (!activeOrg) {
        const first = orgsData.org_members[0];
        setActiveOrg({
          id: first.organization.id,
          name: first.organization.name,
          role: first.role,
          calls_used: first.organization.calls_used,
          calls_allowed: first.organization.calls_allowed
        });
      } else {
        const updated = orgsData.org_members.find((om: any) => om.organization.id === activeOrg.id);
        if (updated) {
          setActiveOrg({
            id: updated.organization.id,
            name: updated.organization.name,
            role: updated.role,
            calls_used: updated.organization.calls_used,
            calls_allowed: updated.organization.calls_allowed
          });
        }
      }
    }
  }, [orgsData, useMocks]);

  useEffect(() => {
    if (!useMocks && workflowsData?.workflows?.length > 0) {
      if (!selectedWorkflowId) {
        setSelectedWorkflowId(workflowsData.workflows[0].id);
      }
    } else if (!useMocks) {
      setSelectedWorkflowId(null);
    }
  }, [workflowsData, useMocks]);

  useEffect(() => {
    if (!useMocks && selectedWorkflowId && workflowsData?.workflows) {
      const wf = workflowsData.workflows.find((w: any) => w.id === selectedWorkflowId);
      if (wf) {
        setEditingName(wf.name);
        setSteps(wf.steps.map((s: any) => ({
          id: s.id,
          type: s.type,
          position: s.position,
          config: JSON.stringify(s.config, null, 2)
        })));
        setTriggers(wf.triggers.map((t: any) => ({
          id: t.id,
          type: t.type,
          config: JSON.stringify(t.config, null, 2)
        })));
      }
    }
  }, [selectedWorkflowId, workflowsData, useMocks]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (useMocks) {
      const matched = DEFAULT_MOCK_USERS.find(u => u.email === email && u.password === password);
      if (matched) {
        localStorage.setItem('mock_logged_in_user', email);
        setMockUser(email);
      } else {
        setAuthError('Incorrect email or password. Use owner@gmail.com (owner123) or editor@gmail.com (editor123)');
      }
      return;
    }

    if (isRegister) {
      const res = await nhost.auth.signUp({ email, password });
      if (res.error) {
        setAuthError(res.error.message);
      } else {
        setIsRegister(false);
      }
    } else {
      const res = await signInEmailPassword(email, password);
      if (res.error) {
        setAuthError(res.error.message);
      }
    }
  };

  const forceMockMode = () => {
    localStorage.setItem('use_local_mocks', 'true');
    seedLocalDatabase();
    window.location.reload();
  };

  const handleCreateWorkflow = async () => {
    if (!activeOrg || !newWorkflowName) return;

    if (useMocks) {
      const newWf: MockWorkflow = {
        id: Math.random().toString(),
        orgId: activeOrg.id,
        name: newWorkflowName,
        steps: [],
        triggers: []
      };
      const updated = [...mockWorkflows, newWf];
      localStorage.setItem('mock_workflows', JSON.stringify(updated));
      setMockWorkflows(updated);
      setSelectedWorkflowId(newWf.id);
      setNewWorkflowName('');
      return;
    }

    try {
      const res = await createWorkflow({
        variables: { orgId: activeOrg.id, name: newWorkflowName }
      });
      setNewWorkflowName('');
      refetchWorkflows();
      if (res.data?.insert_workflows_one) {
        setSelectedWorkflowId(res.data.insert_workflows_one.id);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const addStep = (type: string) => {
    const nextPos = steps.length > 0 ? Math.max(...steps.map(s => s.position)) + 1 : 1;
    let defaultConfig = '{}';
    if (type === 'llm_call') {
      defaultConfig = JSON.stringify({ prompt: 'Write a short positive greeting for: "{{input}}"' }, null, 2);
    } else if (type === 'http_request') {
      defaultConfig = JSON.stringify({ url: 'https://httpbin.org/get', method: 'GET' }, null, 2);
    } else if (type === 'db_write') {
      defaultConfig = JSON.stringify({ data: { message: 'Workflow processed successfully' } }, null, 2);
    } else if (type === 'notify') {
      defaultConfig = JSON.stringify({ recipient: 'admin@example.com', message: 'Task complete' }, null, 2);
    } else if (type === 'conditional_branch') {
      defaultConfig = JSON.stringify({ expression: 'input.text.includes("yes")', true_position: 3, false_position: 4 }, null, 2);
    }

    setSteps([...steps, {
      id: Math.random().toString(),
      type,
      position: nextPos,
      config: defaultConfig
    }]);
  };

  const removeStep = (idx: number) => {
    const updated = steps.filter((_, i) => i !== idx);
    setSteps(updated.map((s, i) => ({ ...s, position: i + 1 })));
  };

  const updateStepConfig = (idx: number, value: string) => {
    const updated = [...steps];
    updated[idx].config = value;
    setSteps(updated);
  };

  const addTrigger = (type: string) => {
    setTriggers([...triggers, {
      id: Math.random().toString(),
      type,
      config: '{}'
    }]);
  };

  const removeTrigger = (idx: number) => {
    setTriggers(triggers.filter((_, i) => i !== idx));
  };

  const updateTriggerConfig = (idx: number, value: string) => {
    const updated = [...triggers];
    updated[idx].config = value;
    setTriggers(updated);
  };

  const saveActiveWorkflow = async () => {
    if (!selectedWorkflowId) return;
    setSaveStatus('Saving...');

    if (useMocks) {
      const idx = mockWorkflows.findIndex(w => w.id === selectedWorkflowId);
      if (idx !== -1) {
        const updated = [...mockWorkflows];
        updated[idx].name = editingName;
        updated[idx].steps = steps.map(s => ({
          id: s.id,
          type: s.type,
          position: s.position,
          config: JSON.parse(s.config)
        }));
        updated[idx].triggers = triggers.map(t => ({
          id: t.id,
          type: t.type,
          config: JSON.parse(t.config)
        }));
        localStorage.setItem('mock_workflows', JSON.stringify(updated));
        setMockWorkflows(updated);
        setSaveStatus('Saved!');
      }
      return;
    }

    try {
      const parsedSteps = steps.map(s => {
        let configObj = {};
        try {
          configObj = JSON.parse(s.config);
        } catch (e) {}
        return {
          workflow_id: selectedWorkflowId,
          type: s.type,
          position: s.position,
          config: configObj
        };
      });

      const parsedTriggers = triggers.map(t => {
        let configObj = {};
        try {
          configObj = JSON.parse(t.config);
        } catch (e) {}
        return {
          workflow_id: selectedWorkflowId,
          type: t.type,
          config: configObj
        };
      });

      await saveWorkflow({
        variables: {
          workflowId: selectedWorkflowId,
          name: editingName,
          steps: parsedSteps,
          triggers: parsedTriggers
        }
      });
      setSaveStatus('Saved!');
      refetchWorkflows();
    } catch (err: any) {
      setSaveStatus(`Error: ${err.message}`);
    }
  };

  const runMockEngine = async (runId: string) => {
    const allRuns = JSON.parse(localStorage.getItem('mock_runs') || '[]');
    const run = allRuns.find((r: any) => r.id === runId);
    if (!run) return;

    const allWfs = JSON.parse(localStorage.getItem('mock_workflows') || '[]');
    const wf = allWfs.find((w: any) => w.id === run.workflowId);
    if (!wf) return;

    const allStepRuns = JSON.parse(localStorage.getItem('mock_step_runs') || '[]');
    const stepRunsMap = new Map<string, any>();
    for (const sr of allStepRuns) {
      if (sr.runId === runId) {
        stepRunsMap.set(sr.stepId, sr);
      }
    }

    let lastOutput: any = run.input || { text: '' };
    let currentIdx = 0;
    const steps = wf.steps;

    while (currentIdx < steps.length) {
      const step = steps[currentIdx];
      const existingRun = stepRunsMap.get(step.id);

      if (existingRun && existingRun.status === 'completed') {
        lastOutput = existingRun.output;
        currentIdx++;
        continue;
      }

      if (existingRun && existingRun.status === 'paused') {
        run.status = 'paused';
        localStorage.setItem('mock_runs', JSON.stringify(allRuns));
        setMockRuns(allRuns);
        return;
      }

      let activeStepRun = existingRun;
      if (!activeStepRun) {
        activeStepRun = {
          id: Math.random().toString(),
          runId,
          stepId: step.id,
          status: 'running',
          input: lastOutput,
          output: null,
          error: '',
          attempt_count: 1
        };
        allStepRuns.push(activeStepRun);
        localStorage.setItem('mock_step_runs', JSON.stringify(allStepRuns));
        setMockStepRuns([...allStepRuns]);
      } else {
        activeStepRun.status = 'running';
        localStorage.setItem('mock_step_runs', JSON.stringify(allStepRuns));
        setMockStepRuns([...allStepRuns]);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      let success = false;
      let output: any = null;
      let error = '';

      try {
        if (step.type === 'llm_call') {
          const lower = JSON.stringify(lastOutput).toLowerCase();
          if (lower.includes('good') || lower.includes('great') || lower.includes('love') || lower.includes('positive') || lower.includes('awesome')) {
            output = { text: 'positive' };
          } else {
            output = { text: 'negative' };
          }
          success = true;
        } else if (step.type === 'http_request') {
          output = { status: 200, body: { message: 'Mock HTTP response successful' } };
          success = true;
        } else if (step.type === 'db_write') {
          output = { success: true, id: Math.random().toString() };
          success = true;
        } else if (step.type === 'notify') {
          output = { success: true };
          success = true;
        } else if (step.type === 'conditional_branch') {
          const expression = step.config.expression;
          const truePos = step.config.true_position;
          const falsePos = step.config.false_position;
          const exprRes = String(lastOutput.text || '').trim().toLowerCase().includes('positive');
          output = { result: exprRes, next_position: exprRes ? truePos : falsePos };
          success = true;
        } else if (step.type === 'approval_gate') {
          activeStepRun.status = 'paused';
          run.status = 'paused';
          localStorage.setItem('mock_runs', JSON.stringify(allRuns));
          localStorage.setItem('mock_step_runs', JSON.stringify(allStepRuns));
          setMockRuns([...allRuns]);
          setMockStepRuns([...allStepRuns]);
          return;
        }
      } catch (e: any) {
        error = e.message;
      }

      if (success) {
        activeStepRun.status = 'completed';
        activeStepRun.output = output;
        lastOutput = output;
        localStorage.setItem('mock_step_runs', JSON.stringify(allStepRuns));
        setMockStepRuns([...allStepRuns]);

        if (step.type === 'conditional_branch') {
          const nextPos = output.next_position;
          const nextIndex = steps.findIndex((s: any) => s.position === nextPos);
          if (nextIndex !== -1) {
            currentIdx = nextIndex;
            continue;
          }
        }
        currentIdx++;
      } else {
        activeStepRun.status = 'failed';
        activeStepRun.error = error;
        run.status = 'failed';
        localStorage.setItem('mock_runs', JSON.stringify(allRuns));
        localStorage.setItem('mock_step_runs', JSON.stringify(allStepRuns));
        setMockRuns([...allRuns]);
        setMockStepRuns([...allStepRuns]);
        return;
      }
    }

    run.status = 'completed';
    localStorage.setItem('mock_runs', JSON.stringify(allRuns));
    setMockRuns([...allRuns]);

    const orgs = JSON.parse(localStorage.getItem('mock_orgs') || '[]');
    const oIdx = orgs.findIndex((o: any) => o.id === wf.orgId);
    if (oIdx !== -1) {
      orgs[oIdx].calls_used += 1;
      localStorage.setItem('mock_orgs', JSON.stringify(orgs));
      setMockOrgs(orgs);
      if (activeOrg && activeOrg.id === orgs[oIdx].id) {
        setActiveOrg({ ...activeOrg, calls_used: orgs[oIdx].calls_used });
      }
    }
  };

  const handleTriggerRun = async () => {
    if (!selectedWorkflowId) return;

    if (useMocks) {
      if (activeOrg && activeOrg.calls_used >= activeOrg.calls_allowed) {
        alert('Organization quota is exhausted');
        return;
      }

      const allRuns = JSON.parse(localStorage.getItem('mock_runs') || '[]');
      const newRun: MockRun = {
        id: Math.random().toString(),
        workflowId: selectedWorkflowId,
        status: 'running',
        input: { text: JSON.parse(dbEventPayload).text || 'Feedback message' },
        created_at: new Date().toISOString()
      };
      allRuns.unshift(newRun);
      localStorage.setItem('mock_runs', JSON.stringify(allRuns));
      setMockRuns(allRuns);
      setActiveRunId(newRun.id);
      runMockEngine(newRun.id);
      return;
    }

    try {
      const res = await triggerRun({
        variables: { workflowId: selectedWorkflowId }
      });
      if (res.data?.triggerWorkflowRun?.run_id) {
        setActiveRunId(res.data.triggerWorkflowRun.run_id);
        refetchOrgs();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleApprove = async (stepRunId: string) => {
    if (useMocks) {
      if (activeOrg?.role !== 'owner' && activeOrg?.role !== 'editor') {
        alert('Only owners and editors can approve steps');
        return;
      }

      const allStepRuns = JSON.parse(localStorage.getItem('mock_step_runs') || '[]');
      const sr = allStepRuns.find((s: any) => s.id === stepRunId);
      if (sr) {
        sr.status = 'completed';
        sr.approved_by = mockUser || 'anonymous';
        sr.approved_at = new Date().toISOString();
        sr.output = { approved: true };
        localStorage.setItem('mock_step_runs', JSON.stringify(allStepRuns));
        setMockStepRuns(allStepRuns);

        const allRuns = JSON.parse(localStorage.getItem('mock_runs') || '[]');
        const run = allRuns.find((r: any) => r.id === sr.runId);
        if (run) {
          run.status = 'running';
          localStorage.setItem('mock_runs', JSON.stringify(allRuns));
          setMockRuns(allRuns);
          runMockEngine(run.id);
        }
      }
      return;
    }

    try {
      await approveStep({
        variables: { stepRunId }
      });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleFireDbEvent = async () => {
    if (!selectedWorkflowId) return;

    if (useMocks) {
      if (activeOrg && activeOrg.calls_used >= activeOrg.calls_allowed) {
        alert('Organization quota is exhausted');
        return;
      }

      const allRuns = JSON.parse(localStorage.getItem('mock_runs') || '[]');
      const newRun: MockRun = {
        id: Math.random().toString(),
        workflowId: selectedWorkflowId,
        status: 'running',
        input: { text: JSON.parse(dbEventPayload).text || 'Feedback event write' },
        created_at: new Date().toISOString()
      };
      allRuns.unshift(newRun);
      localStorage.setItem('mock_runs', JSON.stringify(allRuns));
      setMockRuns(allRuns);
      setActiveRunId(newRun.id);
      alert('Event triggered inside database. Starting background workflow run.');
      runMockEngine(newRun.id);
      return;
    }

    try {
      let parsed = {};
      try {
        parsed = JSON.parse(dbEventPayload);
      } catch (e) {
        alert('Invalid JSON payload');
        return;
      }

      await insertEventSource({
        variables: {
          workflowId: selectedWorkflowId,
          data: parsed
        }
      });
      alert('Row inserted into event_trigger_source. The DB Event Trigger will automatically start the run.');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleOrgChange = (orgId: string) => {
    if (useMocks) {
      const selected = mockMembers.find(m => m.orgId === orgId && m.email === mockUser);
      const org = mockOrgs.find(o => o.id === orgId);
      if (org && selected) {
        setActiveOrg({
          id: org.id,
          name: org.name,
          role: selected.role,
          calls_used: org.calls_used,
          calls_allowed: org.calls_allowed
        });
        setSelectedWorkflowId(null);
        setActiveRunId(null);
      }
      return;
    }

    const selected = orgsData.org_members.find((om: any) => om.organization.id === orgId);
    if (selected) {
      setActiveOrg({
        id: selected.organization.id,
        name: selected.organization.name,
        role: selected.role,
        calls_used: selected.organization.calls_used,
        calls_allowed: selected.organization.calls_allowed
      });
      setSelectedWorkflowId(null);
      setActiveRunId(null);
    }
  };

  const handleSignOut = () => {
    if (useMocks) {
      localStorage.removeItem('mock_logged_in_user');
      setMockUser(null);
      return;
    }
    nhostSignOut();
  };

  if (!isAuthenticated) {
    return (
      <div className="app-container">
        <div className="glass-panel auth-card">
          <h2 className="auth-title">AIFlow Builder</h2>
          <div className="auth-tabs">
            <div
              className={`auth-tab ${!isRegister ? 'auth-tab-active' : ''}`}
              onClick={() => setIsRegister(false)}
            >
              Sign In
            </div>
            <div
              className={`auth-tab ${isRegister ? 'auth-tab-active' : ''}`}
              onClick={() => setIsRegister(true)}
            >
              Register
            </div>
          </div>
          <form onSubmit={handleAuthSubmit}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {authError && <div style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '1rem' }}>{authError}</div>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={isAuthLoading}>
              {useMocks ? 'Sign In (Mock Mode)' : isRegister ? 'Register Account' : 'Sign In'}
            </button>
          </form>

          <div className="seed-section" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', marginTop: '1.25rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Demo Accounts (Pre-seeded):
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span><strong>Owner:</strong> owner@gmail.com</span>
                <span style={{ color: 'var(--color-primary)' }}>owner123</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span><strong>Editor:</strong> editor@gmail.com</span>
                <span style={{ color: 'var(--color-primary)' }}>editor123</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span><strong>Viewer:</strong> viewer@gmail.com</span>
                <span style={{ color: 'var(--color-primary)' }}>viewer123</span>
              </div>
            </div>
            {!useMocks && (
              <div style={{ textAlign: 'center', marginTop: '1.25rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                <a href="#" style={{ fontSize: '0.8rem', color: 'var(--color-primary)', textDecoration: 'underline' }} onClick={(e) => {
                  e.preventDefault();
                  forceMockMode();
                }}>
                  Switch to Offline Demo (Mock Mode)
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const listWorkflows = useMocks
    ? mockWorkflows.filter(w => w.orgId === activeOrg?.id)
    : workflowsData?.workflows;

  const activeWorkflow = listWorkflows?.find((w: any) => w.id === selectedWorkflowId);

  return (
    <>
      <nav className="nav-bar">
        <span className="nav-logo">AIFlow Builder {useMocks && '(Client-Side Mock)'}</span>
        <div className="nav-user">
          {activeOrg && (
            <select
              className="input"
              style={{ width: 'auto', background: 'rgba(255,255,255,0.05)' }}
              value={activeOrg.id}
              onChange={(e) => handleOrgChange(e.target.value)}
            >
              {useMocks ? (
                mockOrgs
                  .filter(o => mockMembers.some(m => m.orgId === o.id && m.email === mockUser))
                  .map(o => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))
              ) : (
                orgsData?.org_members?.map((om: any) => (
                  <option key={om.organization.id} value={om.organization.id}>
                    {om.organization.name}
                  </option>
                ))
              )}
            </select>
          )}
          {activeOrg && (
            <span className={`badge badge-${activeOrg.role}`}>
              {activeOrg.role}
            </span>
          )}
          <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {userData?.email}
          </span>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 1rem' }} onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </nav>

      <div className="app-container">
        {activeOrg && (
          <div className="glass-panel quota-container">
            <div className="quota-header">
              <span>Organization Usage Quota ({activeOrg.name})</span>
              <span>{activeOrg.calls_used} / {activeOrg.calls_allowed} Runs Used</span>
            </div>
            <div className="quota-bar-outer">
              <div
                className="quota-bar-inner"
                style={{ width: `${Math.min(100, (activeOrg.calls_used / activeOrg.calls_allowed) * 100)}%` }}
              ></div>
            </div>
          </div>
        )}

        <div className="dashboard-grid">
          <div className="sidebar-section">
            <div className="glass-panel">
              <h3 style={{ marginBottom: '1rem' }}>Workflows</h3>
              {listWorkflows?.map((w: any) => (
                <div
                  key={w.id}
                  style={{
                    padding: '0.75rem',
                    borderRadius: '6px',
                    background: selectedWorkflowId === w.id ? 'rgba(99,102,241,0.1)' : 'transparent',
                    border: '1px solid',
                    borderColor: selectedWorkflowId === w.id ? 'var(--color-primary)' : 'transparent',
                    cursor: 'pointer',
                    marginBottom: '0.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onClick={() => { setSelectedWorkflowId(w.id); setActiveRunId(null); }}
                >
                  <span style={{ fontWeight: 500 }}>{w.name}</span>
                </div>
              ))}

              {activeOrg?.role !== 'viewer' && (
                <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <div className="form-group">
                    <input
                      type="text"
                      className="input"
                      placeholder="New Workflow Name"
                      value={newWorkflowName}
                      onChange={(e) => setNewWorkflowName(e.target.value)}
                    />
                  </div>
                  <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleCreateWorkflow}>
                    Create Workflow
                  </button>
                </div>
              )}
            </div>

            {selectedWorkflowId && (
              <div className="glass-panel">
                <h3 style={{ marginBottom: '1rem' }}>Database Event Test</h3>
                <div className="seed-desc">
                  Simulate an external DB write to start this workflow via a Hasura Event Trigger.
                </div>
                <div className="form-group">
                  <textarea
                    className="input"
                    rows={4}
                    style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    value={dbEventPayload}
                    onChange={(e) => setDbEventPayload(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button className="btn btn-secondary" style={{ width: '100%' }} onClick={handleFireDbEvent}>
                    Fire Event Trigger
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            {selectedWorkflowId ? (
              <div className="editor-layout">
                <div className="glass-panel">
                  <div className="workflow-header">
                    <input
                      type="text"
                      className="input"
                      style={{ fontSize: '1.2rem', fontWeight: 700, width: 'auto', border: 'none', background: 'transparent', padding: 0 }}
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      disabled={activeOrg?.role === 'viewer'}
                    />
                    {activeOrg?.role !== 'viewer' && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-secondary" onClick={saveActiveWorkflow}>
                          Save Configuration
                        </button>
                        <button className="btn btn-primary" onClick={handleTriggerRun}>
                          Run Workflow
                        </button>
                      </div>
                    )}
                  </div>
                  {saveStatus && (
                    <div style={{
                      fontSize: '0.9rem',
                      color: saveStatus.includes('Error') ? 'var(--color-danger)' : 'var(--color-success)',
                      marginBottom: '1rem'
                    }}>
                      {saveStatus}
                    </div>
                  )}

                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ marginBottom: '1rem' }}>Triggers</h4>
                    {triggers.map((t, idx) => (
                      <div key={t.id} className="glass-panel" style={{ background: 'rgba(0,0,0,0.15)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ textTransform: 'capitalize' }}>{t.type}</strong>
                        </div>
                        {activeOrg?.role !== 'viewer' && (
                          <button className="btn btn-danger" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => removeTrigger(idx)}>
                            Delete
                          </button>
                        )}
                      </div>
                    ))}

                    {activeOrg?.role !== 'viewer' && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => addTrigger('manual')}>
                          + Manual
                        </button>
                        {activeOrg?.role === 'owner' && (
                          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => addTrigger('webhook')}>
                            + Webhook
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 style={{ marginBottom: '1rem' }}>Workflow Steps</h4>
                    <div className="steps-list">
                      {steps.map((s, idx) => (
                        <div key={s.id} className="glass-panel step-card" style={{ background: 'rgba(0,0,0,0.15)' }}>
                          <span className="step-number">{s.position}</span>
                          <div className="step-details">
                            <span className="step-type-title">{s.type.replace('_', ' ')}</span>
                            <div className="form-group" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                              <textarea
                                className="input"
                                rows={3}
                                style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: 'rgba(0,0,0,0.3)' }}
                                value={s.config}
                                onChange={(e) => updateStepConfig(idx, e.target.value)}
                                disabled={activeOrg?.role === 'viewer'}
                              />
                            </div>
                          </div>
                          {activeOrg?.role !== 'viewer' && (
                            <button className="btn btn-danger" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => removeStep(idx)}>
                              Delete
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {activeOrg?.role !== 'viewer' && (
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => addStep('llm_call')}>
                          + LLM Call
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => addStep('http_request')}>
                          + HTTP Request
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => addStep('conditional_branch')}>
                          + Condition
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => addStep('approval_gate')}>
                          + Approval Gate
                        </button>
                        {activeOrg?.role === 'owner' && (
                          <>
                            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => addStep('db_write')}>
                              + DB Write
                            </button>
                            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => addStep('notify')}>
                              + Notify
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  {useMocks ? (
                    <LocalRunTracker
                      runId={activeRunId}
                      mockRuns={mockRuns}
                      mockStepRuns={mockStepRuns}
                      mockWorkflows={mockWorkflows}
                      activeOrgRole={activeOrg?.role}
                      onApprove={handleApprove}
                    />
                  ) : (
                    <RunTracker
                      runId={activeRunId}
                      activeOrgRole={activeOrg?.role}
                      onApprove={handleApprove}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                <h3>Select or create a workflow to view editor</h3>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function LocalRunTracker({ runId, mockRuns, mockStepRuns, mockWorkflows, activeOrgRole, onApprove }: any) {
  if (!runId) {
    return (
      <div className="glass-panel">
        <h3>Execution Tracker</h3>
        <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', fontSize: '0.9rem' }}>
          Trigger a run to see live execution state.
        </p>
      </div>
    );
  }

  const run = mockRuns.find((r: any) => r.id === runId);
  const stepRuns = mockStepRuns.filter((sr: any) => sr.runId === runId);
  const wf = mockWorkflows.find((w: any) => w.id === run?.workflowId);

  return (
    <div className="glass-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h3>Execution Progress</h3>
        {run && (
          <span className={`badge`} style={{
            background: run.status === 'completed' ? 'rgba(16, 185, 129, 0.15)' :
                        run.status === 'failed' ? 'rgba(239, 68, 68, 0.15)' :
                        run.status === 'paused' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(14, 165, 233, 0.15)',
            color: run.status === 'completed' ? '#6ee7b7' :
                   run.status === 'failed' ? '#fca5a5' :
                   run.status === 'paused' ? '#fcd34d' : '#7dd3fc',
            border: '1px solid',
            borderColor: run.status === 'completed' ? 'rgba(16, 185, 129, 0.3)' :
                         run.status === 'failed' ? 'rgba(239, 68, 68, 0.3)' :
                         run.status === 'paused' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(14, 165, 233, 0.3)'
          }}>
            {run.status}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {stepRuns.map((sr: any) => {
          const stepObj = wf?.steps.find((s: any) => s.id === sr.stepId);
          return (
            <div key={sr.id} className="glass-panel" style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  <strong>Step {stepObj?.position}</strong> ({stepObj?.type.replace('_', ' ')})
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`status-dot status-${sr.status}`}></span>
                  <span style={{ fontSize: '0.8rem', textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
                    {sr.status}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Attempt Count: {sr.attempt_count}
              </div>

              {sr.input && (
                <div className="step-run-log">
                  <strong>Input:</strong>
                  <pre style={{ marginTop: '0.25rem' }}>{JSON.stringify(sr.input, null, 2)}</pre>
                </div>
              )}

              {sr.output && (
                <div className="step-run-log">
                  <strong className="step-run-output">Output:</strong>
                  <pre style={{ marginTop: '0.25rem' }}>{JSON.stringify(sr.output, null, 2)}</pre>
                </div>
              )}

              {sr.error && (
                <div className="step-run-log">
                  <strong className="step-run-error">Error:</strong>
                  <pre style={{ marginTop: '0.25rem' }}>{sr.error}</pre>
                </div>
              )}

              {sr.status === 'paused' && (
                <div className="approve-box">
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-warning)' }}>
                    Awaiting Approver Authorization
                  </span>
                  {activeOrgRole === 'owner' || activeOrgRole === 'editor' ? (
                    <button className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => onApprove(sr.id)}>
                      Approve and Resume Execution
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Your role (viewer) is not authorized to approve.
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunTracker({ runId, activeOrgRole, onApprove }: { runId: string | null; activeOrgRole: string | undefined; onApprove: (id: string) => void }) {
  if (!runId) {
    return (
      <div className="glass-panel">
        <h3>Execution Tracker</h3>
        <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', fontSize: '0.9rem' }}>
          Trigger a run to see live execution state.
        </p>
      </div>
    );
  }

  return <ActiveRunSubscription runId={runId} activeOrgRole={activeOrgRole} onApprove={onApprove} />;
}

function ActiveRunSubscription({ runId, activeOrgRole, onApprove }: { runId: string; activeOrgRole: string | undefined; onApprove: (id: string) => void }) {
  const { data, loading, error } = useSubscription(RUN_SUBSCRIPTION, {
    variables: { runId }
  });

  if (loading) return <div className="glass-panel">Loading subscription...</div>;
  if (error) return <div className="glass-panel" style={{ color: 'var(--color-danger)' }}>Error: {error.message}</div>;

  const run = data?.workflow_runs_by_pk;
  const stepRuns = data?.step_runs || [];

  return (
    <div className="glass-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h3>Execution Progress</h3>
        {run && (
          <span className={`badge`} style={{
            background: run.status === 'completed' ? 'rgba(16, 185, 129, 0.15)' :
                        run.status === 'failed' ? 'rgba(239, 68, 68, 0.15)' :
                        run.status === 'paused' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(14, 165, 233, 0.15)',
            color: run.status === 'completed' ? '#6ee7b7' :
                   run.status === 'failed' ? '#fca5a5' :
                   run.status === 'paused' ? '#fcd34d' : '#7dd3fc',
            border: '1px solid',
            borderColor: run.status === 'completed' ? 'rgba(16, 185, 129, 0.3)' :
                         run.status === 'failed' ? 'rgba(239, 68, 68, 0.3)' :
                         run.status === 'paused' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(14, 165, 233, 0.3)'
          }}>
            {run.status}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {stepRuns.map((sr: any) => (
          <div key={sr.id} className="glass-panel" style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <strong>Step {sr.step?.position}</strong> ({sr.step?.type.replace('_', ' ')})
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className={`status-dot status-${sr.status}`}></span>
                <span style={{ fontSize: '0.8rem', textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
                  {sr.status}
                </span>
              </div>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Attempt Count: {sr.attempt_count}
            </div>

            {sr.input && (
              <div className="step-run-log">
                <strong>Input:</strong>
                <pre style={{ marginTop: '0.25rem' }}>{JSON.stringify(sr.input, null, 2)}</pre>
              </div>
            )}

            {sr.output && (
              <div className="step-run-log">
                <strong className="step-run-output">Output:</strong>
                <pre style={{ marginTop: '0.25rem' }}>{JSON.stringify(sr.output, null, 2)}</pre>
              </div>
            )}

            {sr.error && (
              <div className="step-run-log">
                <strong className="step-run-error">Error:</strong>
                <pre style={{ marginTop: '0.25rem' }}>{sr.error}</pre>
              </div>
            )}

            {sr.status === 'paused' && (
              <div className="approve-box">
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-warning)' }}>
                  Awaiting Approver Authorization
                </span>
                {activeOrgRole === 'owner' || activeOrgRole === 'editor' ? (
                  <button className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => onApprove(sr.id)}>
                    Approve and Resume Execution
                  </button>
                ) : (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Your role (viewer) is not authorized to approve.
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
