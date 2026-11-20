import { APP_VERSION } from '~/lib/app-version'

export type HealthStatus = 'ok' | 'degraded' | 'down'
export type DbHealthState = 'up' | 'down'
export type MigrationHealthState = 'current' | 'behind' | 'unknown'

export interface HealthReport {
  status: HealthStatus
  version: string
  db: DbHealthState
  migrations: MigrationHealthState
}

export interface ComputeHealthInput {
  dbOk: boolean
  appliedMigrations: number | null
  expectedMigrations: number
  version?: string
}

export function computeHealth(input: ComputeHealthInput): {
  httpStatus: 200 | 503
  body: HealthReport
} {
  const version = input.version ?? APP_VERSION

  if (!input.dbOk) {
    return {
      httpStatus: 503,
      body: {
        status: 'down',
        version,
        db: 'down',
        migrations: 'unknown',
      },
    }
  }

  if (input.appliedMigrations === null) {
    return {
      httpStatus: 503,
      body: {
        status: 'degraded',
        version,
        db: 'up',
        migrations: 'unknown',
      },
    }
  }

  if (input.appliedMigrations < input.expectedMigrations) {
    return {
      httpStatus: 503,
      body: {
        status: 'degraded',
        version,
        db: 'up',
        migrations: 'behind',
      },
    }
  }

  return {
    httpStatus: 200,
    body: {
      status: 'ok',
      version,
      db: 'up',
      migrations: 'current',
    },
  }
}
