import { useState } from 'react'
import type { SyncPlan, SyncRequest } from '@shared/types'
import { api, messageFor } from '../lib/api'
import { formatBytes } from '../lib/format'
import { useSession } from '../store/session'
import { Button, Field, Input } from './primitives'

/**
 * Uploads only what is new or changed.
 *
 * Two steps on purpose: the plan is shown before anything moves. Sync is the operation
 * people most fear getting wrong — it can delete, and it acts on hundreds of files at
 * once — so it states exactly what it would do and waits to be told to do it.
 */
export function SyncDialog({ onClose }: { onClose: () => void }) {
  const connectionId = useSession((state) => state.activeConnectionId)
  const location = useSession((state) => state.location)
  const uploadOverride = useSession((state) => state.uploadOverride)
  const refresh = useSession((state) => state.refresh)

  const [localPath, setLocalPath] = useState<string | null>(null)
  const [deleteRemote, setDeleteRemote] = useState(false)
  const [exclude, setExclude] = useState('.DS_Store, **/node_modules/, *.tmp')
  const [include, setInclude] = useState('')

  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [busy, setBusy] = useState<'analyzing' | 'applying' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function request(): SyncRequest {
    return {
      connectionId: connectionId as string,
      bucket: location!.bucket,
      prefix: location!.prefix,
      localPath: localPath as string,
      deleteRemote,
      include: split(include),
      exclude: split(exclude),
      encryption: uploadOverride ?? undefined
    }
  }

  async function chooseFolder() {
    setError(null)
    try {
      const chosen = await api.dialog.pickDirectory()
      if (!chosen) return
      setLocalPath(chosen)
      // A plan describes one folder; choosing another invalidates it.
      setPlan(null)
      setDone(null)
    } catch (failure) {
      setError(messageFor(failure))
    }
  }

  async function analyze() {
    if (!localPath) return
    setBusy('analyzing')
    setError(null)
    setDone(null)
    try {
      setPlan(await api.sync.analyze(request()))
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(null)
    }
  }

  async function apply() {
    if (!plan) return
    setBusy('applying')
    setError(null)
    try {
      const result = await api.sync.apply(request(), plan)
      setDone(
        `Queued ${result.queued} ${result.queued === 1 ? 'upload' : 'uploads'}` +
          (result.deleted > 0 ? ` and deleted ${result.deleted} remote ${result.deleted === 1 ? 'object' : 'objects'}` : '')
      )
      setPlan(null)
      await refresh()
    } catch (failure) {
      setError(messageFor(failure))
    } finally {
      setBusy(null)
    }
  }

  const nothingToDo = plan !== null && plan.upload.length === 0 && plan.deleteRemote.length === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim pt-16 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Sync folder"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-[600px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
      >
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="eyebrow">Sync folder</span>
          <button onClick={onClose} className="text-faint hover:text-text" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-4">
            <Field
              label="Local folder"
              tooltip="Its contents are compared against this bucket location. The folder itself is not recreated; what is inside it lands directly here."
            >
              <div className="flex gap-1.5">
                <Input
                  value={localPath ?? ''}
                  readOnly
                  placeholder="Choose a folder to sync from"
                  className="tabular flex-1"
                />
                <Button variant="secondary" onClick={() => void chooseFolder()}>
                  Choose
                </Button>
              </div>
            </Field>

            <div>
              <span className="eyebrow">Uploads to</span>
              <p className="tabular mt-1.5 text-[12px] break-all text-muted">
                s3://{location?.bucket}/{location?.prefix}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Exclude"
                tooltip="Comma separated. * matches within a name, ** across folders, and a trailing slash covers a whole directory."
              >
                <Input
                  value={exclude}
                  onChange={(event) => setExclude(event.target.value)}
                  placeholder="*.tmp, **/node_modules/"
                  className="tabular"
                />
              </Field>
              <Field label="Include" tooltip="When set, only files matching these are considered.">
                <Input
                  value={include}
                  onChange={(event) => setInclude(event.target.value)}
                  placeholder="Everything, unless set"
                  className="tabular"
                />
              </Field>
            </div>

            <label className="flex items-start gap-2.5 rounded-md border border-line bg-sunken px-3 py-2.5">
              <input
                type="checkbox"
                checked={deleteRemote}
                onChange={(event) => {
                  setDeleteRemote(event.target.checked)
                  setPlan(null)
                }}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                <span className="block text-[12px] text-text">
                  Delete objects that are not in the local folder
                </span>
                <span className="block text-[11px] leading-relaxed text-muted">
                  Makes the bucket location mirror the folder exactly. Anything here that is not
                  there is deleted — including files someone else uploaded.
                </span>
              </span>
            </label>

            {plan ? <PlanSummary plan={plan} /> : null}

            {error ? (
              <p className="rounded-md border border-danger/35 bg-danger-soft/50 px-3 py-2 text-[11.5px] leading-relaxed text-text">
                {error}
              </p>
            ) : null}

            {done ? (
              <p className="rounded-md border border-success/35 bg-success-soft/50 px-3 py-2 text-[11.5px] leading-relaxed text-text">
                {done}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
          <span className="flex-1 text-[11px] text-faint">
            {plan ? 'Nothing has moved yet.' : 'Analyzing changes nothing.'}
          </span>
          <Button onClick={onClose} disabled={busy !== null}>
            Close
          </Button>
          <Button variant="secondary" onClick={() => void analyze()} disabled={!localPath || busy !== null}>
            {busy === 'analyzing' ? 'Analyzing…' : plan ? 'Re-analyze' : 'Analyze'}
          </Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            disabled={!plan || nothingToDo || busy !== null}
          >
            {busy === 'applying' ? 'Starting…' : 'Sync'}
          </Button>
        </footer>
      </div>
    </div>
  )
}

/** What the sync would do, stated before it does it. */
function PlanSummary({ plan }: { plan: SyncPlan }) {
  const nothing = plan.upload.length === 0 && plan.deleteRemote.length === 0

  return (
    <div className="rounded-md border border-line bg-sunken">
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line-soft px-3 py-2.5 text-[12px]">
        <span className="tabular text-accent-ink">
          {plan.upload.length} to upload · {formatBytes(plan.uploadBytes)}
        </span>
        <span className="tabular text-muted">{plan.unchanged} unchanged</span>
        {plan.filtered > 0 ? (
          <span className="tabular text-faint">{plan.filtered} filtered out</span>
        ) : null}
        {plan.deleteRemote.length > 0 ? (
          <span className="tabular text-danger">{plan.deleteRemote.length} to delete</span>
        ) : null}
      </div>

      {nothing ? (
        <p className="px-3 py-3 text-[12px] text-muted">
          Everything here already matches the folder. Nothing to do.
        </p>
      ) : (
        <ul className="max-h-52 overflow-y-auto">
          {plan.upload.slice(0, 200).map((item) => (
            <li
              key={item.key}
              className="flex items-baseline gap-2 border-b border-line-soft px-3 py-1.5 last:border-b-0"
            >
              <span
                className={`tabular w-14 shrink-0 text-[10px] tracking-wide uppercase ${
                  item.reason === 'new' ? 'text-success' : 'text-accent-ink'
                }`}
              >
                {item.reason}
              </span>
              <span className="tabular flex-1 truncate text-[11.5px] text-text">{item.key}</span>
              <span className="tabular shrink-0 text-[11px] text-faint">
                {formatBytes(item.size)}
              </span>
            </li>
          ))}

          {plan.deleteRemote.slice(0, 200).map((item) => (
            <li
              key={item.key}
              className="flex items-baseline gap-2 border-b border-line-soft px-3 py-1.5 last:border-b-0"
            >
              <span className="tabular w-14 shrink-0 text-[10px] tracking-wide text-danger uppercase">
                delete
              </span>
              <span className="tabular flex-1 truncate text-[11.5px] text-text">{item.key}</span>
              <span className="tabular shrink-0 text-[11px] text-faint">
                {formatBytes(item.size)}
              </span>
            </li>
          ))}

          {plan.upload.length + plan.deleteRemote.length > 400 ? (
            <li className="px-3 py-2 text-[11px] text-faint">
              Showing the first 400 of {plan.upload.length + plan.deleteRemote.length}.
            </li>
          ) : null}
        </ul>
      )}
    </div>
  )
}

/** Comma or newline separated patterns, with the blanks dropped. */
function split(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}
