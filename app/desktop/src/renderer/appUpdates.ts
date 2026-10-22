/**
 * `app/src/native/appUpdates.ts` for Windows and Linux: the main process owns
 * electron-updater (`src/updates.ts`); the window asks it through the preload bridge.
 */
import type { UpdateInfo } from '../../../src/native/appUpdates';

export type { UpdateInfo } from '../../../src/native/appUpdates';

export function updateInfo(): Promise<UpdateInfo> {
  return window.roadie.updateInfo();
}

export function checkForUpdates(): void {
  window.roadie.checkForUpdates();
}
