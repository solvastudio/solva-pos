import { Client } from 'pg'

function buildDefaultAdminDbUrl(): string {
  const base = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
  const parsed = new URL(base)
  parsed.pathname = '/solva_test'
  return parsed.toString()
}

export async function ownerClient(): Promise<Client> {
  const url =
    process.env.TEST_OWNER_URL ?? 'postgres://solva_owner:solva_owner_dev@localhost:5432/solva_test'
  const client = new Client({ connectionString: url })
  await client.connect()
  return client
}

export async function appClient(): Promise<Client> {
  const url =
    process.env.TEST_APP_URL ?? 'postgres://solva_app_login:solva_app_dev@localhost:5432/solva_test'
  const client = new Client({ connectionString: url })
  await client.connect()
  return client
}

export async function adminClient(): Promise<Client> {
  const url = process.env.TEST_ADMIN_DB_URL ?? buildDefaultAdminDbUrl()
  const client = new Client({ connectionString: url })
  await client.connect()
  return client
}

export async function withClient<T>(
  factory: () => Promise<Client>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await factory()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
