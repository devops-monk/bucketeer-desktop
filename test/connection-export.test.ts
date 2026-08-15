import { beforeEach, describe, expect, it } from 'vitest'
import type { Connection, ConnectionExport } from '@shared/types'
import { ConnectionService } from '../src/main/app/connection-service'

/**
 * An export leaves the machine — it gets mailed, committed, or dropped in a team drive.
 * The tests that matter are therefore about what is *not* in it, and about an import
 * never quietly damaging connections that already work.
 */

class MemoryRepository {
  readonly saved: Connection[] = []

  constructor(initial: Connection[] = []) {
    this.saved.push(...initial)
  }

  async list(): Promise<Connection[]> {
    return [...this.saved]
  }

  async get(id: string): Promise<Connection> {
    const found = this.saved.find((connection) => connection.id === id)
    if (!found) throw new Error(`No connection ${id}`)
    return found
  }

  async save(connection: Connection): Promise<Connection> {
    this.saved.push(connection)
    return connection
  }

  async remove(): Promise<void> {}

  canStoreSecrets(): boolean {
    return true
  }
}

const base = { region: 'eu-west-1', createdAt: '2026-01-01T00:00:00.000Z' }

const connections: Connection[] = [
  {
    ...base,
    id: 'keys',
    name: 'Live account',
    credentials: {
      kind: 'access-key',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'super-secret',
      sessionToken: 'token'
    }
  },
  {
    ...base,
    id: 'profile',
    name: 'Non-prod',
    kmsKeyId: 'arn:aws:kms:eu-west-1:1:key/abc',
    credentials: { kind: 'shared-profile', profileName: 'non-prd-fs' }
  },
  {
    ...base,
    id: 'role',
    name: 'Deploy role',
    credentials: {
      kind: 'assume-role',
      roleArn: 'arn:aws:iam::1:role/deploy',
      mfaSerial: 'arn:aws:iam::1:mfa/me',
      base: { kind: 'shared-profile', profileName: 'non-prd-fs' }
    }
  }
]

let repository: MemoryRepository
let service: ConnectionService
let counter: number

function build(initial: Connection[]): ConnectionService {
  repository = new MemoryRepository(initial)
  counter = 0
  return new ConnectionService(
    repository as never,
    { describe: () => 'label' } as never,
    { forget: () => {} } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { next: () => `new-${++counter}` },
    { nowIso: () => '2026-08-15T00:00:00.000Z' }
  )
}

beforeEach(() => {
  service = build(connections)
})

describe('exporting connections', () => {
  it('never writes a secret', async () => {
    const exported = await service.exportAll()
    const serialised = JSON.stringify(exported)

    expect(serialised).not.toContain('super-secret')
    expect(serialised).not.toContain('AKIAEXAMPLE')
    expect(serialised).not.toContain('token')
  })

  it('keeps the settings that make an import worth doing', async () => {
    const exported = await service.exportAll()
    const profile = exported.connections.find((entry) => entry.name === 'Non-prod')

    expect(profile?.credentials).toEqual({ kind: 'shared-profile', profileName: 'non-prd-fs' })
    expect(profile?.kmsKeyId).toBe('arn:aws:kms:eu-west-1:1:key/abc')
  })

  it('strips the secret from a role that assumes with keys', async () => {
    const withKeyBase = build([
      {
        ...base,
        id: 'role-keys',
        name: 'Role from keys',
        credentials: {
          kind: 'assume-role',
          roleArn: 'arn:aws:iam::1:role/deploy',
          base: { kind: 'access-key', accessKeyId: 'AKIA2', secretAccessKey: 'also-secret' }
        }
      }
    ])

    const serialised = JSON.stringify(await withKeyBase.exportAll())
    expect(serialised).not.toContain('also-secret')
    expect(serialised).toContain('"base":{"kind":"access-key"}')
  })

  it('does not carry ids or creation dates, which belong to one machine', async () => {
    const exported = await service.exportAll()
    for (const entry of exported.connections) {
      expect(entry).not.toHaveProperty('id')
      expect(entry).not.toHaveProperty('createdAt')
    }
  })
})

describe('importing connections', () => {
  async function roundTrip(existing: Connection[] = []): Promise<ConnectionExport> {
    const exported = await service.exportAll()
    service = build(existing)
    return exported
  }

  it('restores everything that did not need a secret', async () => {
    const exported = await roundTrip()
    const result = await service.importAll(exported)

    expect(result.imported).toBe(2)
    expect(result.needCredentials).toEqual(['Live account'])
    expect(repository.saved.map((connection) => connection.name)).toEqual([
      'Non-prod',
      'Deploy role'
    ])
  })

  it('gives imported connections fresh ids so nothing is overwritten', async () => {
    const exported = await roundTrip(connections)
    await service.importAll(exported)

    const ids = repository.saved.map((connection) => connection.id)
    expect(new Set(ids).size).toBe(ids.length)
    // The three originals are still present, untouched.
    expect(ids.slice(0, 3)).toEqual(['keys', 'profile', 'role'])
  })

  it('keeps an imported connection distinguishable from one of the same name', async () => {
    const exported = await roundTrip(connections)
    await service.importAll(exported)

    expect(repository.saved.map((connection) => connection.name)).toContain('Non-prod (2)')
  })

  it('refuses a file that is not an export', async () => {
    await expect(service.importAll({ hello: 'world' })).rejects.toThrow(/not a Bucketeer/)
    await expect(service.importAll(null)).rejects.toThrow(/not a Bucketeer/)
  })
})
