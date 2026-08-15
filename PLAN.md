# Bucketeer — plan

A desktop client for Amazon S3 and S3-compatible storage. Cross-platform, open source,
built with Electron, React and the AWS SDK v3.

The goal is a tool a business user can be handed without training: connect with whatever
credentials the organisation already uses, and move files without needing to know what a
key ARN is.

## Shipped

As of **v0.3.0**. Everything here is verified against a real or faithfully simulated S3
endpoint rather than only typechecked.

- **Credentials** — SSO, shared profiles, `credential_process`, assume-role with MFA and
  external ID, access keys, temporary session keys, environment, instance roles
- **In-app SSO sign-in** — runs the user's own `aws sso login` where the CLI exists, so the
  browser asks them to authorise a client they already trust; falls back to a built-in
  device authorization flow otherwise. Either way the token goes to the AWS CLI's own
  shared cache, so signing in here signs the CLI in too, and signing in there signs the app
  in. A failed sign-in says which of "no session", "expired session" and "role not
  assigned" actually happened, since the fix differs for each
- **S3-compatible endpoints** — MinIO, Cloudflare R2, Wasabi, Backblaze
- **Browsing** — buckets and prefixes, filtering with match highlighting, column sorting
- **Upload** — multi-select, whole folders, drag and drop, multipart above 8 MB
- **Download** — objects and folders, streamed to disk, one click to the Downloads folder
- **Encryption** — the KMS key is resolved from the connection, the bucket's default, or an
  existing object, so nobody has to find an ARN by hand
- **Delete, rename, new folder, presigned share links**
- **Transfer queue** — concurrent, cancellable, per-file and batch progress
- **Object details** — size, class, server-side encryption and the actual KMS key
- **Light and dark themes**, following the OS or pinned
- **Releases** for macOS (Intel and Apple Silicon), Windows and Linux, built on tag

Security posture: the renderer never receives a credential. All S3 and STS calls happen in
the main process behind a typed, allowlisted preload bridge, with context isolation on,
node integration off, and the renderer sandboxed. Connections are encrypted whole with
Electron `safeStorage`; where no keychain exists, secrets are refused rather than written
in the clear.

## Roadmap

Measured against CS Browser (formerly S3 Browser) 13.5.5. Effort assumes one developer:
**S** days, **M** a week or two, **L** a month or more.

### v0.4 — Make it trustworthy

Foundations first, because every feature after them is harder to add and riskier to ship
without them.

| Feature | Effort | Notes |
| --- | --- | --- |
| Test suite in CI | S | Vitest against a local S3 stub, or MinIO — **done** |
| Virtualized object list | S | **done** |
| Pause and resume uploads | L | Hand-rolled multipart, resuming from parts S3 holds — **done** |
| Integrity checking | S | SDK flexible checksums, CRC32C — **done** |
| Auto-update, Windows and Linux | M | macOS is blocked, see below |

### v0.5 — The everyday jobs

| Feature | Effort | Notes |
| --- | --- | --- |
| Folder sync | L | Upload only new and changed, by size, hash and mtime — **done** |
| Copy and move between buckets | M | Server-side, within and across buckets — **done** |
| Include and exclude filters | S | Glob patterns in the sync dialog — **done** |
| Storage classes | S | Changed in bulk on existing objects — **done** |
| Create and delete buckets | S | **done** |
| Copy between *accounts* | M | Streams through the app; needs two connections |

### v0.6 — Working on objects

| Feature | Effort | Notes |
| --- | --- | --- |
| Versions | M | List, restore, undelete, permanently delete — **done** |
| Metadata and HTTP headers | M | Editable in the details panel — **done** |
| Object tags | S | Editable in the details panel — **done** |
| Glacier restore | M | Started from the details panel, status shown — **done** |
| Object Lock | M | Read retention and legal holds; writing later |

### v0.7 — Administering buckets

| Feature | Effort | Notes |
| --- | --- | --- |
| Bucket policy viewer and editor | M | Read, and edit behind a deliberate step — **done** |
| Lifecycle rules | M | Read-only view — **done**; editing deliberately deferred |
| Encryption, versioning, public access | S | Shown in bucket settings — **done** |
| CORS, logging, requester pays | S | Shown in bucket settings — **done** |
| Static website hosting | S | Configuration shown — **done** |

### v0.8 — Scale and the network

| Feature | Effort | Notes |
| --- | --- | --- |
| Search across a bucket | L | Streaming walk, stoppable, results as they arrive — **done** |
| Bandwidth limits | M | One shared ceiling, in preferences — **done** |
| Proxy support | S | In preferences, applied to every AWS request — **done** |
| Transfer acceleration | S | Per connection — **done** |
| Tunable concurrency and part size | S | In preferences — **done** |

### Desktop integration — **done**

| Feature | Effort | Notes |
| --- | --- | --- |
| Menu bar and tray item | S | Template image on macOS, coloured on Windows and Linux |
| Taskbar and Dock progress | S | Progress bar everywhere, plus a count badge on macOS |

### v0.9 — Around the edges

Previews and bulk share links are **done**: a Preview panel in the details drawer reads
the first slice of an object with a ranged request rather than downloading it, and the
share action now signs a link for every selected object at once. Connections export and
import from Preferences: the file carries names, regions, endpoints, profiles and roles
and never a key or a token, and an import is additive with fresh ids.

| Feature | Effort | Notes |
| --- | --- | --- |
| CloudFront distributions | M | Listing and invalidation only |
| Command line interface | L | Shares the main-process services |

### v1.0

Documentation, a signed and notarized release on all three platforms, a contribution guide
and a security disclosure process.

## Deliberately not building

Each of these appears in CS Browser's feature list. Leaving them out is a decision.

- **Client-side AES-256 encryption** — makes objects readable only by this tool. The CLI,
  Lambda and the console would all see ciphertext, and a lost key loses the data. SSE-KMS
  gives the same protection with an audit trail and works for every other consumer.
- **Client-side compression** — the object in the bucket would stop being the file that was
  uploaded, breaking anything that reads it.
- **URL shortener integration** — a presigned URL is a credential. Sending it to a
  third-party shortener hands that credential to another company and their logs.
- **ACLs as a first-class workflow** — AWS disables ACLs by default through Object Ownership
  and steers everything to bucket policies. Bucketeer shows ACLs where they exist; building
  a bulk editor would invest in a retiring mechanism.
- **Signature Version 2** — the AWS SDK v3 does not implement it and AWS retired it years
  ago. Supporting it would mean a second signing implementation.

## Blocked

**macOS notarization, and therefore macOS auto-update.** Notarizing requires membership
of the Apple Developer Program, which costs $99 a year and is not available here. Two
consequences, both permanent until that changes:

- Every macOS user sees "Apple cannot check it for malicious software" on first open, and
  has to right-click → Open once. The release notes explain this.
- Auto-update cannot work on macOS: Squirrel.Mac verifies the signature of an update and
  refuses an unsigned one. Windows and Linux auto-update are unaffected and are still
  worth building.

Homebrew does **not** avoid this, contrary to a common belief: its cask installer
quarantines downloads by default, and `--no-quarantine` is an explicit opt-out that warns
it weakens Gatekeeper. A cask is still worth publishing for one-line installs and
upgrades — see `docs/homebrew-cask.md` — but it is a distribution convenience, not a way
around notarization.

If the membership does become available, `docs/mac-code-signing.md` is the full path from
nothing to a build that opens on a double-click. The release workflow already passes the
five secrets it needs, so nothing in CI has to change.

## Known gaps
- Uploads can be paused and resumed within a session; resuming after the app is closed
  needs the multipart state persisting to disk, which is not built yet.
- Downloads restart rather than resuming; ranged requests would fix it.
- Sync is one-way, local to remote. Remote to local is not built.
- Everything is verified against a local S3 stub; nothing has been run against real AWS.
