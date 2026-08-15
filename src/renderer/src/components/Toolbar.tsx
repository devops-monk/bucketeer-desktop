import { useEffect, useState } from 'react'
import { api, messageFor } from '../lib/api'
import { describeEncryption, readBucketEncryption, resolveUploadEncryption } from '../lib/uploads'
import { useSession } from '../store/session'
import type { BucketEncryption, UploadEncryption } from '@shared/types'
import { ConfirmDialog, LinkDialog, PromptDialog, StorageClassDialog } from './dialogs'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { DestinationDialog } from './DestinationDialog'
import { SearchPanel } from './SearchPanel'
import { SyncDialog } from './SyncDialog'
import { UploadDialog } from './UploadDialog'
import {
  ArchiveIcon,
  CopyIcon,
  DownloadIcon,
  KeyIcon,
  FindIcon,
  EyeIcon,
  InfoIcon,
  MoveIcon,
  SyncIcon,
  LinkIcon,
  NewFolderIcon,
  RenameIcon,
  TrashIcon,
  UploadIcon
} from './icons'
import { Button, SearchInput, Tooltip } from './primitives'

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
  const contextMenu = useSession((state) => state.contextMenu)
  const setContextMenu = useSession((state) => state.setContextMenu)
  const setDetailsKey = useSession((state) => state.setDetailsKey)
  const filter = useSession((state) => state.filter)
  const setFilter = useSession((state) => state.setFilter)
  const refresh = useSession((state) => state.refresh)

  const [dialog, setDialog] = useState<
    'folder' | 'rename' | 'delete' | 'copy' | 'move' | 'class' | 'sync' | null
  >(null)
  const [links, setLinks] = useState<Array<{ key: string; url: string }> | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
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

      // Never stop to ask: the key is worked out in the main process, and most buckets
      // need none at all.
      await startUpload(await resolveUploadEncryption(uploadOverride), paths)
    } catch (failure) {
      setError(messageFor(failure))
    }
  }

  async function startUpload(encryption: UploadEncryption, paths: string[]) {
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

  /**
   * Downloads go to the OS Downloads folder without asking. Dragging objects out of the
   * window is impossible in Electron, so downloading has to be as close to one gesture
   * as it can be; holding Alt still offers the folder picker for anyone who wants it.
   */
  async function download(chooseFolder: boolean) {
    setError(null)
    try {
      const destination = chooseFolder
        ? await api.dialog.pickDirectory()
        : await api.app.downloadsFolder()
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

  /** Server-side copy or move, so the bytes never travel through this machine. */
  async function copyTo(destination: { bucket: string; prefix: string }, move: boolean) {
    setBusy(true)
    setError(null)
    try {
      const result = await api.objects.copy({
        connectionId: connectionId as string,
        sourceBucket: location!.bucket,
        keys: selectedKeys,
        prefixes: selectedPrefixes,
        targetBucket: destination.bucket,
        targetPrefix: destination.prefix,
        move
      })
      setDialog(null)
      if (move) await refresh()
      if (result.failed.length > 0) {
        setError(
          `${move ? 'Moved' : 'Copied'} ${result.copied}. ${result.failed.length} failed: ${result.failed[0].reason}`
        )
      }
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  async function changeStorageClass(storageClass: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await api.objects.setStorageClass({
        connectionId: connectionId as string,
        bucket: location!.bucket,
        keys: selectedKeys,
        storageClass
      })
      setDialog(null)
      await refresh()
      if (result.failed.length > 0) {
        setError(`Changed ${result.copied}. ${result.failed.length} failed: ${result.failed[0].reason}`)
      }
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  /** Signs a link for every selected object, since sharing a set is as common as one. */
  async function share() {
    setError(null)
    setBusy(true)
    try {
      const signed: Array<{ key: string; url: string }> = []
      for (const key of selectedKeys) {
        signed.push({
          key,
          url: await api.objects.presign({
            connectionId: connectionId as string,
            bucket: location!.bucket,
            key,
            expiresInSeconds: LINK_TTL_SECONDS
          })
        })
      }
      setLinks(signed)
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(false)
    }
  }

  const currentName = singleObject ? (selectedKeys[0].split('/').pop() ?? '') : ''

  const menuItems: MenuItem[] = [
    {
      label: 'Details',
      icon: <InfoIcon />,
      onSelect: () => setDetailsKey(selectedKeys[0]),
      disabledReason: singleObject ? undefined : 'Select exactly one object'
    },
    {
      label: 'Preview',
      icon: <EyeIcon />,
      onSelect: () => setDetailsKey(selectedKeys[0], 'preview'),
      disabledReason: singleObject ? undefined : 'Select exactly one object'
    },
    {
      label: 'Download',
      icon: <DownloadIcon />,
      onSelect: () => void download(false),
      disabledReason: selectedCount === 0 ? 'Nothing selected' : undefined
    },
    {
      label: 'Share link',
      icon: <LinkIcon />,
      onSelect: () => void share(),
      disabledReason: selectedKeys.length === 0 ? 'Select objects' : undefined
    },
    {
      label: 'Rename',
      icon: <RenameIcon />,
      separated: true,
      onSelect: () => setDialog('rename'),
      disabledReason: singleObject ? undefined : 'Select exactly one object'
    },
    {
      label: 'Copy to',
      icon: <CopyIcon />,
      onSelect: () => setDialog('copy'),
      disabledReason: selectedCount === 0 ? 'Nothing selected' : undefined
    },
    {
      label: 'Move to',
      icon: <MoveIcon />,
      onSelect: () => setDialog('move'),
      disabledReason: selectedCount === 0 ? 'Nothing selected' : undefined
    },
    {
      label: 'Change storage class',
      icon: <ArchiveIcon />,
      onSelect: () => setDialog('class'),
      disabledReason: selectedKeys.length === 0 ? 'Select objects' : undefined
    },
    {
      label: 'Delete',
      icon: <TrashIcon />,
      separated: true,
      danger: true,
      onSelect: () => setDialog('delete'),
      disabledReason: selectedCount === 0 ? 'Nothing selected' : undefined
    }
  ]

  return (
    <>
      {/* Scrolls rather than spilling: with the details panel open the pane is narrow,
          and an overflowing row painted straight over the panel beside it. */}
      <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-3 [&>*]:shrink-0">
        <Tooltip label={`Send files into ${location.prefix || location.bucket}`} side="bottom">
          <Button variant="primary" onClick={() => void chooseFiles()}>
            <UploadIcon />
            Upload
          </Button>
        </Tooltip>
        <Tooltip
          label={
            selectedCount === 0
              ? 'Select objects or folders first'
              : 'Save to your Downloads folder. Hold Alt to choose where.'
          }
          side="bottom"
        >
          <Button
            variant="secondary"
            onClick={(event) => void download(event.altKey)}
            disabled={selectedCount === 0}
          >
            <DownloadIcon />
            Download
          </Button>
        </Tooltip>
        <Tooltip
          label="Upload only what is new or changed from a local folder"
          side="bottom"
        >
          <Button variant="secondary" onClick={() => setDialog('sync')}>
            <SyncIcon />
            Sync
          </Button>
        </Tooltip>
        <span className="mx-1.5 h-4 w-px bg-line" aria-hidden />
        <Tooltip label="Create an empty folder here" side="bottom">
          <Button onClick={() => setDialog('folder')}>
            <NewFolderIcon />
            New folder
          </Button>
        </Tooltip>
        <Tooltip
          label={singleObject ? 'Give this object a new key' : 'Select exactly one object first'}
          side="bottom"
        >
          <Button onClick={() => setDialog('rename')} disabled={!singleObject}>
            <RenameIcon />
            Rename
          </Button>
        </Tooltip>
        <Tooltip
          label={
            selectedKeys.length === 0
              ? 'Select objects first'
              : `Create ${selectedKeys.length === 1 ? 'a link' : 'links'} that work for 24 hours without credentials`
          }
          side="bottom"
        >
          <Button onClick={() => void share()} disabled={selectedKeys.length === 0}>
            <LinkIcon />
            {selectedKeys.length > 1 ? `Share ${selectedKeys.length} links` : 'Share link'}
          </Button>
        </Tooltip>
        <Tooltip
          label={
            selectedCount === 0
              ? 'Select something first'
              : 'Copy the selection into another bucket or folder, server-side'
          }
          side="bottom"
        >
          <Button onClick={() => setDialog('copy')} disabled={selectedCount === 0}>
            <CopyIcon />
            Copy to
          </Button>
        </Tooltip>
        <Tooltip
          label={
            selectedCount === 0
              ? 'Select something first'
              : 'Move the selection, deleting the originals once copied'
          }
          side="bottom"
        >
          <Button onClick={() => setDialog('move')} disabled={selectedCount === 0}>
            <MoveIcon />
            Move to
          </Button>
        </Tooltip>
        <Tooltip
          label={
            selectedKeys.length === 0
              ? 'Select objects first'
              : 'Change the storage class of the selected objects'
          }
          side="bottom"
        >
          <Button onClick={() => setDialog('class')} disabled={selectedKeys.length === 0}>
            <ArchiveIcon />
            Storage class
          </Button>
        </Tooltip>
        <Tooltip
          label={selectedCount === 0 ? 'Select something first' : 'Delete the selection'}
          side="bottom"
        >
          <Button variant="danger" onClick={() => setDialog('delete')} disabled={selectedCount === 0}>
            <TrashIcon />
            Delete
          </Button>
        </Tooltip>

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

        <Tooltip label="Find objects by name anywhere below this folder" side="bottom">
          <Button variant="secondary" onClick={() => setSearchOpen(true)}>
            <FindIcon />
            Search
          </Button>
        </Tooltip>

        <SearchInput
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter this folder"
          className="w-56"
          aria-label="Filter the current listing"
        />
      </div>

      {error ? (
        <div className="flex items-start gap-2 border-b border-danger/30 bg-danger-soft/50 px-3 py-2">
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

      {links ? (
        <LinkDialog links={links} expiresLabel="in 24 hours" onClose={() => setLinks(null)} />
      ) : null}

      {dialog === 'copy' || dialog === 'move' ? (
        <DestinationDialog
          title={dialog === 'copy' ? 'Copy to' : 'Move to'}
          confirmLabel={dialog === 'copy' ? 'Copy here' : 'Move here'}
          busy={busy}
          error={error}
          onConfirm={(destination) => void copyTo(destination, dialog === 'move')}
          onCancel={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'class' ? (
        <StorageClassDialog
          count={selectedKeys.length}
          busy={busy}
          error={error}
          onConfirm={(value) => void changeStorageClass(value)}
          onCancel={() => setDialog(null)}
        />
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {dialog === 'sync' ? <SyncDialog onClose={() => setDialog(null)} /> : null}

      {searchOpen ? <SearchPanel onClose={() => setSearchOpen(false)} /> : null}

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
    void readBucketEncryption(connectionId, bucket).then((value) => {
      if (!cancelled) onResolved(value)
    })
    return () => {
      cancelled = true
    }
  }, [connectionId, bucket, onResolved])

  const described = describeEncryption(override, connectionKey, resolved)
  const tones = { good: 'text-success', plain: 'text-faint', warn: 'text-danger' }

  return (
    <Tooltip label={`${described.detail} Click to change it for this bucket.`} side="bottom">
      <button
        onClick={onOpen}
        className="tabular flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-sunken px-2 text-[11px] transition-colors hover:border-line-strong"
      >
        <KeyIcon className={`h-3.5 w-3.5 ${tones[described.tone]}`} />
        <span className="text-muted">{described.label}</span>
      </button>
    </Tooltip>
  )
}

function describe(objects: number, folders: number): string {
  const parts: string[] = []
  if (objects > 0) parts.push(`${objects} ${objects === 1 ? 'object' : 'objects'}`)
  if (folders > 0) parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`)
  return parts.join(' and ')
}
