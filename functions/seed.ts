import { Request, Response } from 'express';

const TEST_USERS = [
  { email: 'owner_a@example.com', password: 'password123', role: 'owner', orgName: 'Org A' },
  { email: 'editor_a@example.com', password: 'password123', role: 'editor', orgName: 'Org A' },
  { email: 'viewer_a@example.com', password: 'password123', role: 'viewer', orgName: 'Org A' },
  { email: 'owner_b@example.com', password: 'password123', role: 'owner', orgName: 'Org B' },
  { email: 'editor_b@example.com', password: 'password123', role: 'editor', orgName: 'Org B' }
];

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
    const authUrl = process.env.NHOST_AUTH_URL || 'http://localhost:1337/v1/auth';
    
    for (const u of TEST_USERS) {
      try {
        await fetch(`${authUrl}/signup/email-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: u.email,
            password: u.password,
            options: { defaultRole: 'user' }
          })
        });
      } catch (err) {}
    }

    const authUsersData = await queryHasura(`
      query GetAuthUsers {
        users {
          id
          email
        }
      }
    `);

    const usersMap: Record<string, string> = {};
    for (const u of authUsersData.users) {
      usersMap[u.email] = u.id;
    }

    const orgsExist = await queryHasura(`
      query CheckOrgs {
        organizations {
          id
          name
        }
      }
    `);

    let orgAId = orgsExist.organizations.find((o: any) => o.name === 'Org A')?.id;
    let orgBId = orgsExist.organizations.find((o: any) => o.name === 'Org B')?.id;

    if (!orgAId) {
      const insertOrgA = await queryHasura(`
        mutation InsertOrgA {
          insert_organizations_one(object: { name: "Org A", calls_allowed: 1000 }) {
            id
          }
        }
      `);
      orgAId = insertOrgA.insert_organizations_one.id;
    }

    if (!orgBId) {
      const insertOrgB = await queryHasura(`
        mutation InsertOrgB {
          insert_organizations_one(object: { name: "Org B", calls_allowed: 5 }) {
            id
          }
        }
      `);
      orgBId = insertOrgB.insert_organizations_one.id;
    }

    for (const u of TEST_USERS) {
      const orgId = u.orgName === 'Org A' ? orgAId : orgBId;
      const userId = usersMap[u.email];
      if (userId) {
        await queryHasura(`
          mutation InsertMember($orgId: uuid!, $userId: uuid!, $role: String!) {
            insert_org_members_one(
              object: { org_id: $orgId, user_id: $userId, role: $role }
              on_conflict: { constraint: org_members_org_id_user_id_key, update_columns: [role] }
            ) {
              id
            }
          }
        `, { orgId, userId, role: u.role });
      }
    }

    const workflowsExist = await queryHasura(`
      query GetWorkflows($orgAId: uuid!) {
        workflows(where: { org_id: { _eq: $orgAId } }) {
          id
        }
      }
    `, { orgAId });

    if (workflowsExist.workflows.length === 0) {
      const insertWorkflow = await queryHasura(`
        mutation InsertWorkflow($orgId: uuid!) {
          insert_workflows_one(object: {
            org_id: $orgId,
            name: "Customer Feedback Router",
            steps: {
              data: [
                {
                  type: "llm_call",
                  position: 1,
                  config: {
                    prompt: "Categorize the sentiment of the following customer feedback: \"{{input}}\". Respond with only one word: positive or negative."
                  }
                },
                {
                  type: "conditional_branch",
                  position: 2,
                  config: {
                    expression: "input.text.trim().toLowerCase().includes('positive')",
                    true_position: 3,
                    false_position: 4
                  }
                },
                {
                  type: "approval_gate",
                  position: 3,
                  config: {}
                },
                {
                  type: "http_request",
                  position: 4,
                  config: {
                    url: "https://httpbin.org/post",
                    method: "POST",
                    body: "{\"text\": \"{{input}}\", \"sentiment\": \"negative\"}"
                  }
                },
                {
                  type: "db_write",
                  position: 5,
                  config: {
                    data: {
                      message: "Feedback processed successfully"
                    }
                  }
                }
              ]
            },
            triggers: {
              data: [
                {
                  type: "manual",
                  config: {}
                },
                {
                  type: "webhook",
                  config: {}
                }
              ]
            }
          }) {
            id
          }
        }
      `, { orgId: orgAId });
    }

    return res.status(200).json({ success: true, orgAId, orgBId });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
