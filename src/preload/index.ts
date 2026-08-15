import { contextBridge, ipcRenderer } from 'electron'
import { Channels, type BucketeerApi } from '@shared/ipc'
import type { Connection, ListObjectsRequest } from '@shared/types'

/**
 * The bridge. Every capability the renderer has is listed here — there is no generic
 * "invoke any channel" escape hatch, so the renderer cannot reach a channel we didn't
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
    sharedProfiles: () => ipcRenderer.invoke(Channels.sharedProfilesList)
  },
  buckets: {
    list: (connectionId: string) => ipcRenderer.invoke(Channels.bucketsList, connectionId)
  },
  objects: {
    list: (request: ListObjectsRequest) => ipcRenderer.invoke(Channels.objectsList, request),
    head: (connectionId: string, bucket: string, key: string) =>
      ipcRenderer.invoke(Channels.objectHead, connectionId, bucket, key)
  }
}

contextBridge.exposeInMainWorld('bucketeer', api)
contextBridge.exposeInMainWorld('platform', process.platform)
