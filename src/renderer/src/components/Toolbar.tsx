import { useEffect, useState } from 'react'
import { api, messageFor } from '../lib/api'
import { resolveUploadEncryption, shortKeyLabel } from '../lib/uploads'
import { useSession } from '../store/session'
import type { BucketEncryption, UploadEncryption } from '@shared/types'
import { ConfirmDialog, LinkDialog, PromptDialog } from './dialogs'
import { UploadDialog } from './UploadDialog'
import {
  DownloadIcon,
  LinkIcon,
  NewFolderIcon,
  RenameIcon,
  TrashIcon,
  UploadIcon
} from './icons'
import { Button, Input } from './primitives'

/** How long share links last. Seven days is SigV4's hard ceiling. */
const LINK_TTL_SECONDS = 24 * 60 * 60

/**
 * Actions for the current listing.
 *
 * Buttons appear always but disable when they cannot apply, rather than appearing and
 * disappearing as the selection changes — a toolbar that reflows while you aim at it is
 * worse than one with dimmed controls.
 */
export function Toolbar() {
  const connectionId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)
  const selection = useSession((state) => state.selection)
  const prefixSelection = useSession((state) => state.prefixSelection)
  const connections = useSession((state) => state.connections)
  const uploadOverride = useSession((state) => state.uploadOverride)
  const setUploadOverride = useSession((state) => state.setUploadOverride)
  const filter = useSession((state) => state.filter)
  const setFilter = useSession((state) => state.setFilter)
  const refresh = useSession((state) => state.refresh)

  const [dialog, setDialog] = useState<'folder' | 'rename' | 'delete' | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [pendingPaths, setPendingPaths] = useState<string[] | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [bucketEncryption, setBucketEncryption] = useState<BucketEncryption | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!location || !connectionId) return null

  const selectedKeys = [...selection]
  const selectedPrefixes = [...prefixSelection]
  const selectedCount = selectedKeys.length + selectedPrefixes.length
  const singleObject = selectedKeys.length === 1 && selectedPrefixes.length === 0

  async function chooseFiles() {
    setError(null)
    try {
      const paths = await api.dialog.pickFiles()
      if (paths.length === 0) return

      // Only ask when the key genuinely cannot be worked out. Making someone paste a
      // key ARN to upload a spreadsheet is a failure of the tool, not of the user.
      const resolved = await resolveUploadEncryption(
        connectionId as string,
        location!.bucket,
        uploadOverride,
        connections.find((c) => c.id === connectionId)?.kmsKeyId
      )
      if (resolved.needsChoice) setPendingPaths(paths)
      else await startUpload(resolved.encryption, paths)
    } catch (failure) {
      setError(messageFor(failure))
    }
  }

  async function startUpload(encryption: UploadEncryption, explicitPaths?: string[]) {
    const paths = explicitPaths ?? pendingPaths ?? []
    setPendingPaths(null)
    try {
      await api.transfers.upload({
        connectionId: connectionId as string,
        bucket: location!.bucket,
        prefix: location!.prefix,
        paths,
        encryption
      })
    } catch (failure) {
      setError(messageFor(failure))
    }
  }

  async function download() {
    setError(null)
    try {
      const destination = await api.dialog.pickDirectory()
      if (!destination) return
      await api.transfers.download({
        connectionId: connectionId as string,
        bucket: location!.bucket,
        keys: selectedKeys,
        prefixes: selectedPrefixes,
        destination
      })
    } catch (failure) {
      setError(messageFor(failure))
    }
  }

  async function createFolder(name: string) {
    setBusy(true)
    setError(null)
    try {
      await api.objects.createFolder({
        connectionId: connectionId as string,
        bucket: location!.bucket,
        prefix: location!.prefix,
        name
      })
      setDialog(null)
      await refresh()
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  async function rename(name: string) {
    setBusy(true)
    setError(null)
    try {
      await api.objects.rename({
        connectionId: connectionId as string,
        bucket: location!.bucket,
        sourceKey: selectedKeys[0],
        targetKey: `${location!.prefix}${name}`
      })
      setDialog(null)
      await refresh()
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.objects.remove({
        connectionId: connectionId as string,
        bucket: location!.bucket,
        keys: selectedKeys,
        prefixes: selectedPrefixes
      })
      setDialog(null)
      await refresh()
      if (result.failed.length > 0) {
        setError(
          `Deleted ${result.deleted}. ${result.failed.length} could not be deleted: ${result.failed[0].reason}`
        )
      }
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    setError(null)
    try {
      setLink(
        await api.objects.presign({
          connectionId: connectionId as string,
          bucket: location!.bucket,
          key: selectedKeys[0],
          expiresInSeconds: LINK_TTL_SECONDS
        })
      )
    } catch (failure) {
      setError(messageFor(failure))
    }
  }

  const currentName = singleObject ? (selectedKeys[0].split('/').pop() ?? '') : ''

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-3">
        <Button variant="primary" onClick={() => void chooseFiles()}>
          <UploadIcon />
          Upload
        </Button>
        <Button onClick={() => void download()} disabled={selectedCount === 0}>
          <DownloadIcon />
          Download
        </Button>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <Button onClick={() => setDialog('folder')}>
          <NewFolderIcon />
          New folder
        </Button>
        <Button onClick={() => setDialog('rename')} disabled={!singleObject}>
          <RenameIcon />
          Rename
        </Button>
        <Button onClick={() => void share()} disabled={!singleObject}>
          <LinkIcon />
          Share link
        </Button>
        <Button variant="danger" onClick={() => setDialog('delete')} disabled={selectedCount === 0}>
          <TrashIcon />
          Delete
        </Button>

        <div className="flex-1" />

        <EncryptionBadge
          connectionId={connectionId}
          bucket={location.bucket}
          override={uploadOverride}
          connectionKey={connections.find((c) => c.id === connectionId)?.kmsKeyId}
          resolved={bucketEncryption}
          onResolved={setBucketEncryption}
          onOpen={() => setChooserOpen(true)}
        />

        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter this folder"
          className="h-7 w-52"
          aria-label="Filter the current listing"
        />
      </div>

      {error ? (
        <div className="flex items-start gap-2 border-b border-danger/40 bg-danger/5 px-3 py-2">
          <p className="flex-1 text-[12px] leading-relaxed text-text">{error}</p>
          <button onClick={() => setError(null)} className="text-faint hover:text-text">
            ✕
          </button>
        </div>
      ) : null}

      {dialog === 'folder' ? (
        <PromptDialog
          title="New folder"
          label="Name"
          confirmLabel="Create"
          busy={busy}
          error={error}
          onConfirm={(value) => void createFolder(value)}
          onCancel={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'rename' ? (
        <PromptDialog
          title="Rename object"
          label="New name"
          initialValue={currentName}
          confirmLabel="Rename"
          busy={busy}
          error={error}
          onConfirm={(value) => void rename(value)}
          onCancel={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'delete' ? (
        <ConfirmDialog
          title={`Delete ${describe(selectedKeys.length, selectedPrefixes.length)}?`}
          detail={
            selectedPrefixes.length > 0
              ? 'Deleting a folder deletes everything inside it. This cannot be undone unless the bucket has versioning enabled.'
              : 'This cannot be undone unless the bucket has versioning enabled.'
          }
          confirmLabel="Delete"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setDialog(null)}
        />
      ) : null}

      {link ? (
        <LinkDialog url={link} expiresLabel="in 24 hours" onClose={() => setLink(null)} />
      ) : null}

      {pendingPaths ? (
        <UploadDialog
          paths={pendingPaths}
          onConfirm={(encryption) => void startUpload(encryption)}
          onCancel={() => setPendingPaths(null)}
        />
      ) : null}

      {chooserOpen ? (
        <UploadDialog
          paths={null}
          onConfirm={(encryption) => {
            setUploadOverride(encryption)
            setChooserOpen(false)
          }}
          onCancel={() => setChooserOpen(false)}
        />
      ) : null}
    </>
  )
}

/**
 * Shows which key the next upload will use, and lets it be changed.
 *
 * Present because encryption is invisible otherwise: this bucket's policy makes the
 * difference between an upload working and being denied, so the setting belongs on
 * screen rather than inside a dialog nobody opens.
 */
function EncryptionBadge({
  connectionId,
  bucket,
  override,
  connectionKey,
  resolved,
  onResolved,
  onOpen
}: {
  connectionId: string
  bucket: string
  override: UploadEncryption | null
  connectionKey?: string
  resolved: BucketEncryption | null
  onResolved: (value: BucketEncryption | null) => void
  onOpen: () => void
}) {
  useEffect(() => {
    let cancelled = false
    api.buckets
      .encryption(connectionId, bucket)
      .then((value) => {
        if (!cancelled) onResolved(value)
      })
      .catch(() => {
        if (!cancelled) onResolved(null)
      })
    return () => {
      cancelled = true
    }
  }, [connectionId, bucket, onResolved])

  const key =
    override?.mode === 'kms' ? override.kmsKeyId : (connectionKey ?? resolved?.kmsKeyId ?? null)
  const none = override?.mode === 'none'

  return (
    <button
      onClick={onOpen}
      className="tabular flex h-7 shrink-0 items-center gap-1.5 rounded-[3px] border border-line px-2 text-[11px] hover:border-faint"
      title={key ? `Uploads are encrypted with ${key}` : 'No KMS key resolved for uploads'}
    >
      <span className={none ? 'text-faint' : key ? 'text-success' : 'text-danger'} aria-hidden>
        ⚿
      </span>
      <span className="text-muted">
        {none ? 'no encryption' : key ? shortKeyLabel(key) : 'no key'}
      </span>
    </button>
  )
}

function describe(objects: number, folders: number): string {
  const parts: string[] = []
  if (objects > 0) parts.push(`${objects} ${objects === 1 ? 'object' : 'objects'}`)
  if (folders > 0) parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`)
  return parts.join(' and ')
}
