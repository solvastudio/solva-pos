import { sql } from 'drizzle-orm'
import { getDb } from '~/server/db'

const paymentMethod = {} as never

export async function badInsertWithoutWriter(name: string) {
  const db = getDb() as unknown as {
    insert: (t: unknown) => { values: (v: Record<string, unknown>) => Promise<void> }
  }
  await db.insert(paymentMethod).values({ name })
  return sql`SELECT * FROM payment_method`
}
