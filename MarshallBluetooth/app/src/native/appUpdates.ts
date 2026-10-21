import { NativeModules } from 'react-native';

export interface UpdateInfo {
  /** The release tag this build was stamped with; `0.0.0` in development. */
  version: string;
  /** False in a Debug build, whose updater never starts. */
  canCheck: boolean;
}

interface AppUpdatesNative {
  info(): Promise<UpdateInfo>;
  check(): void;
}

function native(): AppUpdatesNative | undefined {
  return NativeModules.AppUpdates as AppUpdatesNative | undefined;
}

/** The running version and whether this build can check for updates. */
export function updateInfo(): Promise<UpdateInfo> {
  const module = native();
  if (module === undefined) {
    return Promise.reject(new Error('AppUpdates native module is not linked'));
  }
  return module.info();
}

/** Opens Sparkle's user-initiated check: up to date, or the new release's notes and Install. */
export function checkForUpdates(): void {
  native()?.check();
}
