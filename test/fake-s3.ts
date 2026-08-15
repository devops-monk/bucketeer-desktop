import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A minimal S3-compatible server, implementing just enough of the wire protocol to
 * exercise the real storage adapter: list buckets, list objects with a delimiter and
 * pagination, put, get, head, copy, batch delete, and bucket encryption.
 *
 * Tests run against this rather than against mocks of our own code, so a wrong parameter
 * name or a mishandled response shape fails here instead of in production. Signatures are
 * not verified — the SDK's signing is not what these tests are about.
 */

export interface FakeS3Options {
  buckets?: string[]
  /** Objects to seed, as key → contents. Keys are "bucket/key". */
  objects?: Record<string, string>
  /** Encryption reported per bucket. A bucket named here answers GetBucketEncryption. */
  encryption?: Record<string, { algorithm: string; kmsKeyId?: string }>
  /** Buckets whose GetBucketEncryption is denied, as a real policy often does. */
  encryptionDenied?: string[]
  /** Bucket policies, as JSON strings. */
  policies?: Record<string, string>
  /** Buckets whose GetBucketPolicy is denied, which is the common case for a user. */
  policyDenied?: string[]
  /** Versioning status per bucket. */
  versioning?: Record<string, 'Enabled' | 'Suspended'>
}

export interface FakeS3 {
  url: string
  /** Multipart uploads still in progress, for asserting that a pause kept its parts. */
  uploads: Map<string, { key: string; parts: Map<number, Buffer> }>
  /** Tags per "bucket/key", so tagging can be asserted on. */
  tags: Map<string, Record<string, string>>
  /** Keys a restore has been requested for. */
  restores: string[]
  /** Everything the server currently holds, for assertions. */
  objects: Map<string, { body: Buffer; modified: Date }>
  /** Requests seen, for asserting on headers such as server-side encryption. */
  requests: Array<{ method: string; path: string; headers: Record<string, string | undefined> }>
  close(): Promise<void>
}

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`
/** Real S3 returns the MD5 of the contents for a single-part object, and sync relies on it. */
const etagOf = (body: Buffer) => createHash('md5').update(body).digest('hex')
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Decodes the aws-chunked framing the SDK uses when it streams a body with a trailing
 * checksum. Real S3 unwraps this; a stub that does not silently stores the framing as
 * though it were content, and every size and checksum assertion is then wrong by a few
 * dozen bytes.
 *
 * Each chunk is "<hex length>[;chunk-signature=…]\r\n<data>\r\n", ending with a zero
 * length followed by trailer headers.
 */
function decodeAwsChunked(body: Buffer): Buffer {
  const chunks: Buffer[] = []
  let offset = 0

  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset)
    if (lineEnd === -1) break

    const header = body.subarray(offset, lineEnd).toString()
    const length = parseInt(header.split(';')[0], 16)
    if (Number.isNaN(length)) break

    offset = lineEnd + 2
    if (length === 0) break

    chunks.push(body.subarray(offset, offset + length))
    // Past the data and its trailing CRLF.
    offset += length + 2
  }

  return Buffer.concat(chunks)
}

/** True when the body arrived wrapped in that framing rather than as plain bytes. */
function isChunked(headers: Record<string, string | undefined>): boolean {
  return (
    (headers['content-encoding'] ?? '').includes('aws-chunked') ||
    (headers['x-amz-content-sha256'] ?? '').startsWith('STREAMING')
  )
}

export async function startFakeS3(options: FakeS3Options = {}): Promise<FakeS3> {
  const buckets = options.buckets ?? ['test-bucket']
  const objects = new Map<string, { body: Buffer; modified: Date }>()
  const requests: FakeS3['requests'] = []
  const tags = new Map<string, Record<string, string>>()
  /** In-progress multipart uploads: uploadId → parts by number. */
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>()
  const restores: string[] = []

  for (const [key, body] of Object.entries(options.objects ?? {})) {
    objects.set(key, { body: Buffer.from(body), modified: new Date('2026-01-02T03:04:05Z') })
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const segments = url.pathname.split('/').filter(Boolean)
    const bucket = segments[0] ?? ''
    // Preserve a trailing slash: "data/empty/" is a folder marker, "data/empty" is not.
    const key = bucket ? decodeURIComponent(url.pathname.slice(bucket.length + 2)) : ''

    requests.push({
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      headers: request.headers as Record<string, string | undefined>
    })

    const send = (code: number, body = '', headers: Record<string, string> = {}) => {
      response.writeHead(code, { 'Content-Type': 'application/xml', ...headers })
      response.end(body)
    }

    const readBody = (): Promise<Buffer> =>
      new Promise((resolve) => {
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.on('end', () => {
          const body = Buffer.concat(chunks)
          resolve(
            isChunked(request.headers as Record<string, string | undefined>)
              ? decodeAwsChunked(body)
              : body
          )
        })
      })

    void (async () => {
      // ListBuckets
      if (request.method === 'GET' && !bucket) {
        return send(
          200,
          xml(
            `<ListAllMyBucketsResult><Buckets>${buckets
              .map(
                (name) =>
                  `<Bucket><Name>${name}</Name><CreationDate>2026-01-01T00:00:00.000Z</CreationDate></Bucket>`
              )
              .join('')}</Buckets></ListAllMyBucketsResult>`
          )
        )
      }

      // GetBucketLocation
      if (request.method === 'GET' && url.searchParams.has('location')) {
        return send(200, xml('<LocationConstraint>eu-west-1</LocationConstraint>'))
      }

      // CreateMultipartUpload
      if (request.method === 'POST' && url.searchParams.has('uploads')) {
        const uploadId = `upload-${uploads.size + 1}-${Date.now()}`
        uploads.set(uploadId, { key, parts: new Map() })
        return send(
          200,
          xml(
            `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket>` +
              `<Key>${escape(key)}</Key><UploadId>${uploadId}</UploadId>` +
              `</InitiateMultipartUploadResult>`
          )
        )
      }

      // UploadPart
      if (request.method === 'PUT' && url.searchParams.has('uploadId')) {
        const uploadId = url.searchParams.get('uploadId') as string
        const number = Number(url.searchParams.get('partNumber'))
        const upload = uploads.get(uploadId)
        if (!upload) return send(404, xml('<Error><Code>NoSuchUpload</Code></Error>'))

        const body = await readBody()
        upload.parts.set(number, body)
        return send(200, '', { ETag: `"${etagOf(body)}"` })
      }

      // ListParts — how a resumed upload discovers what S3 already holds.
      if (request.method === 'GET' && url.searchParams.has('uploadId')) {
        const upload = uploads.get(url.searchParams.get('uploadId') as string)
        if (!upload) return send(404, xml('<Error><Code>NoSuchUpload</Code></Error>'))

        return send(
          200,
          xml(
            `<ListPartsResult>${[...upload.parts.entries()]
              .map(
                ([number, body]) =>
                  `<Part><PartNumber>${number}</PartNumber><Size>${body.length}</Size>` +
                  `<ETag>&quot;${etagOf(body)}&quot;</ETag></Part>`
              )
              .join('')}</ListPartsResult>`
          )
        )
      }

      // CompleteMultipartUpload
      if (request.method === 'POST' && url.searchParams.has('uploadId')) {
        const uploadId = url.searchParams.get('uploadId') as string
        const upload = uploads.get(uploadId)
        await readBody()
        if (!upload) return send(404, xml('<Error><Code>NoSuchUpload</Code></Error>'))

        const assembled = Buffer.concat(
          [...upload.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, body]) => body)
        )
        objects.set(`${bucket}/${key}`, { body: assembled, modified: new Date() })
        uploads.delete(uploadId)

        return send(
          200,
          xml(
            `<CompleteMultipartUploadResult><Bucket>${bucket}</Bucket>` +
              `<Key>${escape(key)}</Key><ETag>&quot;${etagOf(assembled)}&quot;</ETag>` +
              `</CompleteMultipartUploadResult>`
          )
        )
      }

      // AbortMultipartUpload
      if (request.method === 'DELETE' && url.searchParams.has('uploadId')) {
        uploads.delete(url.searchParams.get('uploadId') as string)
        return send(204)
      }

      // CORS, lifecycle, logging, website and payment reads and writes
      if (url.searchParams.has('cors')) {
        if (request.method === 'PUT') {
          await readBody()
          return send(200)
        }
        return send(404, xml('<Error><Code>NoSuchCORSConfiguration</Code></Error>'))
      }
      if (url.searchParams.has('lifecycle')) {
        return send(404, xml('<Error><Code>NoSuchLifecycleConfiguration</Code></Error>'))
      }
      if (url.searchParams.has('logging')) {
        return send(200, xml('<BucketLoggingStatus></BucketLoggingStatus>'))
      }
      if (url.searchParams.has('website')) {
        return send(404, xml('<Error><Code>NoSuchWebsiteConfiguration</Code></Error>'))
      }
      if (url.searchParams.has('requestPayment')) {
        return send(200, xml('<RequestPaymentConfiguration><Payer>BucketOwner</Payer></RequestPaymentConfiguration>'))
      }

      // GetBucketPolicy
      if (request.method === 'GET' && url.searchParams.has('policy')) {
        if (options.policyDenied?.includes(bucket)) {
          return send(403, xml('<Error><Code>AccessDenied</Code></Error>'))
        }
        const policy = options.policies?.[bucket]
        if (!policy) return send(404, xml('<Error><Code>NoSuchBucketPolicy</Code></Error>'))
        return send(200, policy, { 'Content-Type': 'application/json' })
      }

      // GetBucketVersioning
      if (request.method === 'GET' && url.searchParams.has('versioning')) {
        const status = options.versioning?.[bucket]
        return send(
          200,
          xml(
            `<VersioningConfiguration>${status ? `<Status>${status}</Status>` : ''}</VersioningConfiguration>`
          )
        )
      }

      // GetPublicAccessBlock
      if (request.method === 'GET' && url.searchParams.has('publicAccessBlock')) {
        return send(
          200,
          xml(
            '<PublicAccessBlockConfiguration><BlockPublicAcls>true</BlockPublicAcls>' +
              '<IgnorePublicAcls>true</IgnorePublicAcls><BlockPublicPolicy>false</BlockPublicPolicy>' +
              '<RestrictPublicBuckets>false</RestrictPublicBuckets></PublicAccessBlockConfiguration>'
          )
        )
      }

      // GetBucketEncryption
      if (request.method === 'GET' && url.searchParams.has('encryption')) {
        if (options.encryptionDenied?.includes(bucket)) {
          return send(403, xml('<Error><Code>AccessDenied</Code></Error>'))
        }
        const configured = options.encryption?.[bucket]
        if (!configured) {
          return send(
            404,
            xml('<Error><Code>ServerSideEncryptionConfigurationNotFoundError</Code></Error>')
          )
        }
        return send(
          200,
          xml(
            `<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault>` +
              `<SSEAlgorithm>${configured.algorithm}</SSEAlgorithm>` +
              (configured.kmsKeyId ? `<KMSMasterKeyID>${configured.kmsKeyId}</KMSMasterKeyID>` : '') +
              `</ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>`
          )
        )
      }

      // Object tagging
      if (url.searchParams.has('tagging') && bucket && key) {
        const id = `${bucket}/${key}`
        if (request.method === 'GET') {
          const set = tags.get(id) ?? {}
          return send(
            200,
            xml(
              `<Tagging><TagSet>${Object.entries(set)
                .map(([name, value]) => `<Tag><Key>${escape(name)}</Key><Value>${escape(value)}</Value></Tag>`)
                .join('')}</TagSet></Tagging>`
            )
          )
        }
        if (request.method === 'PUT') {
          const body = (await readBody()).toString()
          const parsed: Record<string, string> = {}
          for (const match of body.matchAll(/<Tag><Key>([^<]*)<\/Key><Value>([^<]*)<\/Value><\/Tag>/g)) {
            parsed[match[1]] = match[2]
          }
          tags.set(id, parsed)
          return send(200)
        }
      }

      // RestoreObject
      if (request.method === 'POST' && url.searchParams.has('restore')) {
        restores.push(`${bucket}/${key}`)
        return send(202)
      }

      // DeleteObjects
      if (request.method === 'POST' && url.searchParams.has('delete')) {
        const body = (await readBody()).toString()
        const keys = [...body.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => match[1])
        for (const target of keys) objects.delete(`${bucket}/${target}`)
        return send(200, xml('<DeleteResult></DeleteResult>'))
      }

      // ListObjectsV2
      if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? ''
        const delimiter = url.searchParams.get('delimiter') ?? ''
        const maxKeys = Number(url.searchParams.get('max-keys') ?? '1000')
        const after = url.searchParams.get('continuation-token') ?? ''

        const all = [...objects.keys()]
          .filter((composite) => composite.startsWith(`${bucket}/`))
          .map((composite) => composite.slice(bucket.length + 1))
          .filter((name) => name.startsWith(prefix))
          .sort()

        const contents: string[] = []
        const prefixes = new Set<string>()
        for (const name of all) {
          if (delimiter) {
            const rest = name.slice(prefix.length)
            const cut = rest.indexOf(delimiter)
            if (cut >= 0) {
              prefixes.add(prefix + rest.slice(0, cut + 1))
              continue
            }
          }
          if (name > after) contents.push(name)
        }

        const page = contents.slice(0, maxKeys)
        const truncated = contents.length > maxKeys

        return send(
          200,
          xml(
            `<ListBucketResult><Name>${bucket}</Name><Prefix>${escape(prefix)}</Prefix>` +
              `<IsTruncated>${truncated}</IsTruncated>` +
              (truncated
                ? `<NextContinuationToken>${escape(page[page.length - 1])}</NextContinuationToken>`
                : '') +
              page
                .map((name) => {
                  const entry = objects.get(`${bucket}/${name}`)!
                  return (
                    `<Contents><Key>${escape(name)}</Key><Size>${entry.body.length}</Size>` +
                    `<LastModified>${entry.modified.toISOString()}</LastModified>` +
                    `<ETag>&quot;${etagOf(entry.body)}&quot;</ETag>` +
                    `<StorageClass>STANDARD</StorageClass></Contents>`
                  )
                })
                .join('') +
              [...prefixes]
                .map((value) => `<CommonPrefixes><Prefix>${escape(value)}</Prefix></CommonPrefixes>`)
                .join('') +
              `</ListBucketResult>`
          )
        )
      }

      // CopyObject
      if (request.method === 'PUT' && request.headers['x-amz-copy-source']) {
        const source = decodeURIComponent(String(request.headers['x-amz-copy-source']))
        const [sourceBucket, ...rest] = source.split('/')
        const entry = objects.get(`${sourceBucket}/${rest.join('/')}`)
        if (!entry) return send(404, xml('<Error><Code>NoSuchKey</Code></Error>'))
        objects.set(`${bucket}/${key}`, { body: entry.body, modified: new Date() })
        return send(
          200,
          xml(`<CopyObjectResult><ETag>&quot;${etagOf(entry.body)}&quot;</ETag></CopyObjectResult>`)
        )
      }

      // PutObject
      if (request.method === 'PUT' && bucket && key) {
        const body = await readBody()
        objects.set(`${bucket}/${key}`, { body, modified: new Date() })
        return send(200, '', { ETag: `"${etagOf(body)}"` })
      }

      // HeadObject
      if (request.method === 'HEAD' && bucket && key) {
        const entry = objects.get(`${bucket}/${key}`)
        if (!entry) return send(404)
        const configured = options.encryption?.[bucket]
        return send(200, '', {
          'Content-Length': String(entry.body.length),
          'Last-Modified': entry.modified.toUTCString(),
          ETag: `"${etagOf(entry.body)}"`,
          ...(configured
            ? {
                'x-amz-server-side-encryption': configured.algorithm,
                ...(configured.kmsKeyId
                  ? { 'x-amz-server-side-encryption-aws-kms-key-id': configured.kmsKeyId }
                  : {})
              }
            : {})
        })
      }

      // GetObject
      if (request.method === 'GET' && bucket && key) {
        const entry = objects.get(`${bucket}/${key}`)
        if (!entry) return send(404, xml('<Error><Code>NoSuchKey</Code></Error>'))
        response.writeHead(200, {
          'Content-Length': String(entry.body.length),
          'Content-Type': 'application/octet-stream'
        })
        return response.end(entry.body)
      }

      send(501, xml(`<Error><Code>NotImplemented</Code></Error>`))
    })()
  })

  // Port 0: every test file gets its own server, so they can run in parallel.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    objects,
    uploads,
    tags,
    restores,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
