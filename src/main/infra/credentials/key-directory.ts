import { KMSClient, ListAliasesCommand } from '@aws-sdk/client-kms'
import type { Connection, KmsKey } from '@shared/types'
import type { CredentialResolver, KeyDirectory } from '../../core/ports'

/** ListAliases pages at 100; a few pages is plenty for a picker. */
const MAX_PAGES = 5

/**
 * Lists the KMS keys a connection can see, so a default key can be chosen from a list
 * rather than typed as an ARN.
 *
 * Built from aliases rather than ListKeys: aliases are what humans recognise, and the
 * key ARN can be derived from the alias ARN without a DescribeKey call per key — which
 * would be both slow and likely to be denied.
 */
export class KmsKeyDirectory implements KeyDirectory {
  constructor(private readonly credentials: CredentialResolver) {}

  async listKeys(connection: Connection): Promise<KmsKey[]> {
    // Third-party S3 endpoints have no KMS behind them.
    if (connection.endpoint) return []

    const client = new KMSClient({
      region: connection.region,
      credentials: this.credentials.resolve(connection.credentials)
    })

    const keys: KmsKey[] = []
    try {
      let marker: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await client.send(new ListAliasesCommand({ Limit: 100, Marker: marker }))

        for (const alias of result.Aliases ?? []) {
          if (!alias.TargetKeyId || !alias.AliasArn || !alias.AliasName) continue

          // An alias ARN is arn:aws:kms:<region>:<account>:alias/<name>, so the key ARN
          // is the same prefix with key/<id>. Policies are written against that form.
          const keyArn = alias.AliasArn.replace(/:alias\/.*$/, `:key/${alias.TargetKeyId}`)
          keys.push({
            keyArn,
            alias: alias.AliasName,
            // AWS-managed keys cannot be used for most cross-account sharing and are
            // rarely what someone means, so they sort last.
            managedByAws: alias.AliasName.startsWith('alias/aws/')
          })
        }

        marker = result.NextMarker
        if (!result.Truncated || !marker) break
      }
    } finally {
      client.destroy()
    }

    return keys.sort((a, b) => {
      if (a.managedByAws !== b.managedByAws) return a.managedByAws ? 1 : -1
      return a.alias.localeCompare(b.alias)
    })
  }
}
