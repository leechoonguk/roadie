/**
 * Updates for Windows and Linux, from the same GitHub release the Mac updates
 * from (rule://release). `desktop.yml` attaches the installers and the
 * `latest.yml` / `latest-linux.yml` electron-updater reads; electron-builder
 * writes the feed's address into the packaged app (`publish` in package.json).
 *
 * Installs the NSIS setup on Windows, the AppImage or the .deb on Linux. A
 * development run (`make desktop-start`) is not packaged and never updates.
 */
import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

import type { UpdateInfo } from '../../src/native/appUpdates';

/** A release reaches every copy within hours, without polling GitHub hard. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Leaves launch to the speaker connection first. */
const FIRST_CHECK_DELAY_MS = 10_000;

const state = {
  checking: false,
  /** Versions declined this session: a background check does not ask again. */
  declined: new Set<string>(),
};

export function updatesSupported(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'linux');
}

export function updateInfo(): UpdateInfo {
  return { version: app.getVersion(), canCheck: updatesSupported() };
}

/** Checks shortly after launch and then periodically; each check asks before downloading. */
export function startUpdates(): void {
  if (!updatesSupported()) {
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  setTimeout(() => checkForUpdates(false), FIRST_CHECK_DELAY_MS);
  setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);
}

/**
 * One check. `interactive` is a press of Check for Updates: it also reports
 * "up to date" and failures, which a background check keeps to itself.
 */
export async function checkForUpdates(interactive: boolean): Promise<void> {
  if (!updatesSupported() || state.checking) {
    return;
  }
  state.checking = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo.version;
    if (result === null || !result.isUpdateAvailable || version === undefined) {
      if (interactive) {
        await dialog.showMessageBox({
          type: 'info',
          message: 'Roadie is up to date',
          detail: `You have Roadie ${app.getVersion()}, the newest version.`,
        });
      }
      return;
    }
    if (!interactive && state.declined.has(version)) {
      return;
    }
    const offer = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download and Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Roadie ${version} is available`,
      detail: `You have ${app.getVersion()}. It downloads in the background; Roadie then restarts to finish.`,
    });
    if (offer.response !== 0) {
      state.declined.add(version);
      return;
    }
    await autoUpdater.downloadUpdate();
    const restart = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Roadie ${version} is ready`,
      detail: 'Restart now, or it installs the next time Roadie quits.',
    });
    if (restart.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  } catch (error) {
    if (interactive) {
      dialog.showErrorBox('Could not check for updates', error instanceof Error ? error.message : String(error));
    }
  } finally {
    state.checking = false;
  }
}
