# Bucketeer

An open-source desktop client for Amazon S3 and S3-compatible storage.

Bucketeer is a cross-platform (macOS, Windows, Linux) app for browsing, uploading,
downloading, and managing objects in your buckets — with drag-and-drop transfers,
multi-select, progress tracking, and support for every kind of AWS credential.

> Status: early development. Nothing to install yet.

## Planned features

- Browse buckets and prefixes with a fast, virtualized file list
- Drag-and-drop upload, multi-file selection, queued transfers with progress
- Multipart uploads and resumable, streamed downloads
- Full AWS credential support: access keys, named profiles, IAM roles
  (`AssumeRole`, incl. MFA), SSO / IAM Identity Center, and temporary session tokens
- Server-side encryption on upload, including customer-managed KMS keys (`SSE-KMS`)
- Presigned share links
- S3-compatible endpoints: MinIO, Cloudflare R2, Wasabi, Backblaze B2

## Tech stack

- **Electron** + **electron-vite**, packaged with **electron-builder**
- **TypeScript** throughout
- **React** + **Tailwind CSS** + **shadcn/ui** in the renderer
- **AWS SDK for JavaScript v3**, running in the main process only
- Credentials encrypted at rest via Electron `safeStorage` (Keychain / DPAPI / libsecret)

## Security

Bucketeer handles AWS credentials. The renderer process never sees them: all S3 and
STS calls happen in the main process behind a narrow, typed IPC surface, with
`contextIsolation` on and `nodeIntegration` off.

Found a vulnerability? Please report it privately — see `SECURITY.md` (coming soon).

## Contributing

Not yet accepting contributions while the foundations are in flux. Watch the repo.

## License

[Apache License 2.0](LICENSE). Contributions are accepted under the same license,
including its patent grant — see section 5 of the license text.
