import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { Channels, type BucketeerApi } from '@shared/ipc'
import type {
  Connection,
  CreateBucketRequest,
  CreateFolderRequest,
  DeleteBucketRequest,
  SetStorageClassRequest,
  TransferObjectsRequest,
  DeleteRequest,
  DownloadRequest,
  ListObjectsRequest,
  PresignRequest,
  RenameRequest,
  SsoPending,
  SyncPlan,
  SyncRequest,
  ThemePreference,
  Transfer,
  UploadRequest
} from '@shared/types'

/**
 * The bridge. Every capability the renderer has is listed here — there is no generic
 * "invoke any channel" escape hatch, so the renderer cannot reach a channel we did not
 * mean to expose.
 */
const api: BucketeerApi = {
  connections: {
    list: () => ipcRenderer.invoke(Channels.connectionsList),
    save: (connection: Omit<Connection, 'id' | 'createdAt'> & { id?: string }) =>
      ipcRenderer.invoke(Channels.connectionsSave, connection),
    remove: (id: string) => ipcRenderer.invoke(Channels.connectionsRemove, id),
    test: (id: string) => ipcRenderer.invoke(Channels.connectionsTest, id),
    secretsAvailable: () => ipcRenderer.invoke(Channels.connectionsSecretsAvailable)
  },
  credentials: {
    sharedProfiles: () => ipcRenderer.invoke(Channels.sharedProfilesList),
    ssoLogin: (profileName: string) => ipcRenderer.invoke(Channels.credentialsSsoLogin, profileName),
    kmsKeys: (connectionId: string) => ipcRenderer.invoke(Channels.credentialsKmsKeys, connectionId),
    onSsoPending: (listener: (pending: SsoPending) => void) => {
      const handler = (_event: unknown, pending: SsoPending) => listener(pending)
      ipcRenderer.on(Channels.ssoPending, handler)
      return () => ipcRenderer.removeListener(Channels.ssoPending, handler)
    }
  },
  buckets: {
    list: (connectionId: string) => ipcRenderer.invoke(Channels.bucketsList, connectionId),
    encryption: (connectionId: string, bucket: string) =>
      ipcRenderer.invoke(Channels.bucketsEncryption, connectionId, bucket),
    create: (request: CreateBucketRequest) => ipcRenderer.invoke(Channels.bucketsCreate, request),
    remove: (request: DeleteBucketRequest) => ipcRenderer.invoke(Channels.bucketsDelete, request)
  },
  objects: {
    list: (request: ListObjectsRequest) => ipcRenderer.invoke(Channels.objectsList, request),
    head: (connectionId: string, bucket: string, key: string) =>
      ipcRenderer.invoke(Channels.objectHead, connectionId, bucket, key),
    remove: (request: DeleteRequest) => ipcRenderer.invoke(Channels.objectsDelete, request),
    rename: (request: RenameRequest) => ipcRenderer.invoke(Channels.objectsRename, request),
    createFolder: (request: CreateFolderRequest) =>
      ipcRenderer.invoke(Channels.objectsCreateFolder, request),
    presign: (request: PresignRequest) => ipcRenderer.invoke(Channels.objectsPresign, request),
    copy: (request: TransferObjectsRequest) => ipcRenderer.invoke(Channels.objectsCopy, request),
    setStorageClass: (request: SetStorageClassRequest) =>
      ipcRenderer.invoke(Channels.objectsStorageClass, request)
  },
  sync: {
    analyze: (request: SyncRequest) => ipcRenderer.invoke(Channels.syncAnalyze, request),
    apply: (request: SyncRequest, plan: SyncPlan) =>
      ipcRenderer.invoke(Channels.syncApply, request, plan)
  },
  transfers: {
    upload: (request: UploadRequest) => ipcRenderer.invoke(Channels.transfersUpload, request),
    download: (request: DownloadRequest) => ipcRenderer.invoke(Channels.transfersDownload, request),
    list: () => ipcRenderer.invoke(Channels.transfersList),
    cancel: (id: string) => ipcRenderer.invoke(Channels.transfersCancel, id),
    clearFinished: () => ipcRenderer.invoke(Channels.transfersClearFinished),
    onChanged: (listener: (transfers: Transfer[]) => void) => {
      // The event object is deliberately not passed through: it exposes the sender,
      // which the renderer has no business holding.
      const handler = (_event: unknown, transfers: Transfer[]) => listener(transfers)
      ipcRenderer.on(Channels.transfersChanged, handler)
      return () => ipcRenderer.removeListener(Channels.transfersChanged, handler)
    }
  },
  app: {
    version: () => ipcRenderer.invoke(Channels.appVersion),
    getTheme: () => ipcRenderer.invoke(Channels.appGetTheme),
    setTheme: (theme: ThemePreference) => ipcRenderer.invoke(Channels.appSetTheme, theme),
    downloadsFolder: () => ipcRenderer.invoke(Channels.appDownloadsFolder),
    revealFile: (path: string) => ipcRenderer.invoke(Channels.appRevealFile, path)
  },
  dialog: {
    pickFiles: () => ipcRenderer.invoke(Channels.dialogPickFiles),
    pickDirectory: () => ipcRenderer.invoke(Channels.dialogPickDirectory)
  }
}

contextBridge.exposeInMainWorld('bucketeer', api)
contextBridge.exposeInMainWorld('platform', process.platform)

/**
 * Drag-and-drop needs the real path of a dropped file, and Electron removed File.path
 * for security. webUtils.getPathForFile is the supported replacement, and it must be
 * called in the preload — the renderer has no access to webUtils.
 */
contextBridge.exposeInMainWorld('pathForFile', (file: File) => webUtils.getPathForFile(file))
