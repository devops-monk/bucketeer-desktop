# Bucketeer

An open-source desktop client for Amazon S3 and S3-compatible storage, for macOS,
Windows and Linux.

Browse buckets, move files in and out, and change the things about an object that
normally send you to the console or the CLI — encryption, tags, headers, versions,
storage class. It speaks every kind of AWS credential, including IAM Identity Center,
and it signs in the way you already do.

**Current release: [v0.1.0](https://github.com/devops-monk/bucketeer-desktop/releases/latest).**

## Installing

Download the file for your platform from the
[latest release](https://github.com/devops-monk/bucketeer-desktop/releases/latest):

| Platform | File |
| --- | --- |
| macOS, Apple Silicon | `Bucketeer-0.1.0-arm64.dmg` |
| macOS, Intel | `Bucketeer-0.1.0.dmg` |
| Windows | `Bucketeer Setup 0.1.0.exe` |
| Linux | `Bucketeer-0.1.0.AppImage`, or the `.deb` |

These builds are signed only ad-hoc and are **not notarized**, because the project has
no Apple Developer certificate yet. Every operating system will therefore warn you the
first time:

- **macOS** — right-click the app and choose Open (macOS 14 and earlier), or open it
  once and allow it under System Settings → Privacy & Security (macOS 15+). To remove
  the prompt entirely: `xattr -dr com.apple.quarantine /Applications/Bucketeer.app`
- **Windows** — SmartScreen says "unrecognised app": choose More info, then Run anyway
- **Linux** — `chmod +x` the AppImage before running it

[docs/mac-code-signing.md](docs/mac-code-signing.md) covers what a signed and notarized
macOS build needs; the release workflow is already wired for it and starts signing as
soon as the certificate exists.

## What it does

**Connections**

- Access keys, temporary session keys, environment variables, the default provider
  chain, shared profiles, and roles assumed from any of those — with MFA
- IAM Identity Center: signing in runs your own `aws sso login`, so the browser asks
  you to authorise the AWS CLI rather than this app, and your terminal ends up signed
  in too. A session you started in a terminal already counts.
- Credentials are held in the OS keychain (Keychain, DPAPI, libsecret) and sent nowhere
  but AWS
- Export and import connections — the file carries endpoints, regions, profiles and
  roles, and never a key or a token
- S3-compatible endpoints: MinIO, Cloudflare R2, Wasabi, Backblaze B2

**Files**

- Drag-and-drop upload, multi-select, a transfer queue with real progress
- Multipart uploads that pause and resume, continuing from the parts S3 already holds
- Folder sync, uploading only what changed, compared by size, MD5 and modified time,
  with glob include/exclude
- Search across a bucket: a streaming walk you can stop, with results as they arrive
- Previews of text, JSON and images, read with a ranged request rather than downloaded
- Presigned share links, for one object or a whole selection
- Server-side encryption on upload, including customer-managed KMS keys (SSE-KMS) —
  and where the bucket's policy mandates a key, Bucketeer works out which one

**Objects and buckets**

- Versions: list, restore, undelete, permanently delete
- Metadata, HTTP headers and tags, editable in place
- Glacier restore, and storage class changes in bulk
- Bucket policy, lifecycle, encryption, versioning, public access, CORS, logging,
  requester pays and website configuration

**The app**

- A menu bar / tray item, with transfer progress on the Dock and taskbar
- Light and dark themes
- A shared bandwidth ceiling, proxy support, and tunable concurrency and part size

Not yet: auto-update on Windows and Linux, copying between accounts, Object Lock,
CloudFront, and a command line interface. [PLAN.md](PLAN.md) tracks what is coming and
what has been deliberately left out.

## Security

Bucketeer handles AWS credentials, so the boundaries are strict. The renderer never
sees them: every S3, STS and KMS call happens in the main process behind a narrow,
typed IPC surface, with `contextIsolation` on, `nodeIntegration` off and the renderer
sandboxed. Secrets are encrypted at rest with Electron's `safeStorage`, which is the
system keychain. Nothing is sent anywhere except to AWS or to the endpoint you
configured.

Found a vulnerability? Please report it privately through GitHub's
[security advisories](https://github.com/devops-monk/bucketeer-desktop/security/advisories/new)
rather than opening an issue.

## Development

```sh
npm install
npm run dev        # the app, with hot reload
npm test           # 103 tests against a built-in S3 stub
npm run build      # typecheck and bundle
npm run pack:mac   # or pack:win / pack:linux
```

The tests run against a hand-written S3 protocol server, so they need no network and no
Docker. To check the same adapter against a real implementation:

```sh
npm run test:minio
S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_TEST_KEY=bucketeer S3_TEST_SECRET=bucketeer123 npm test
npm run test:stop
```

MinIO is the default because it is free; LocalStack now requires a licence token.

### How it is put together

- **Electron 43** + **electron-vite**, packaged with **electron-builder**
- **React 19** + **Tailwind CSS v4** in the renderer; **TypeScript** throughout
- **AWS SDK for JavaScript v3**, in the main process only

The main process follows ports and adapters. `src/main/core/ports.ts` defines the
interfaces; `src/main/app` holds use cases that depend on nothing but those interfaces;
`src/main/infra` holds the implementations, and is the only place that knows about AWS,
the filesystem or Electron. `src/main/container.ts` wires them together. That is why the
services can be tested against fakes, and why `s3-object-storage.ts` is the single file
that issues S3 commands.

## Contributing

Issues and pull requests are welcome. Please run `npm test` and `npm run build` before
opening one, and match the surrounding code — including its comments, which explain why
something is done rather than what it does.

## License

[Apache License 2.0](LICENSE). Contributions are accepted under the same license,
including its patent grant — see section 5 of the license text.
