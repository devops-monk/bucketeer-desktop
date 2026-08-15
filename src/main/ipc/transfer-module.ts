import { dialog } from 'electron'
import { Channels } from '@shared/ipc'
import type { DownloadRequest, UploadRequest } from '@shared/types'
import type { TransferService } from '../app/transfer-service'
import type { IpcModule, IpcRouter } from './router'

/** Channels for moving files, plus the native pickers those flows need. */
export class TransferModule implements IpcModule {
  constructor(private readonly service: TransferService) {}

  register(router: IpcRouter): void {
    router.handle(Channels.transfersUpload, (request: UploadRequest) => this.service.upload(request))
    router.handle(Channels.transfersDownload, (request: DownloadRequest) =>
      this.service.download(request)
    )
    router.handle(Channels.transfersList, () => this.service.list())
    router.handle(Channels.transfersCancel, (id: string) => this.service.cancel(id))
    router.handle(Channels.transfersClearFinished, () => this.service.clearFinished())

    // The pickers live here because the renderer is sandboxed and cannot open a native
    // dialog itself — and because a path chosen by the user is what makes a transfer legal.
    router.handle(Channels.dialogPickFiles, async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory', 'multiSelections'],
        buttonLabel: 'Upload'
      })
      return result.canceled ? [] : result.filePaths
    })

    router.handle(Channels.dialogPickDirectory, async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Download here'
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })
  }
}
