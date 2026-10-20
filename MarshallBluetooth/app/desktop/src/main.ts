/**
 * The Electron main process for Windows and Linux: one window running the
 * React Native screen, and a tray icon that plays the part of the macOS menu
 * bar item and desktop widget. Closing the window keeps the app in the tray,
 * so the speaker stays connected and the tray keeps working.
 */
import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  Tray,
} from 'electron';

import type { WidgetPayload } from '../../src/native/widgetBridge';
import { CHANNELS, type ChooserDevice } from './bridge';
import { EQ_STEPS } from './protocol';
import { offsetFromFlat, type TrayAction, trayStep } from './tray';

const state = {
  window: null as BrowserWindow | null,
  tray: null as Tray | null,
  /** Electron's answer for the pending Web Bluetooth request, called once. */
  choose: null as ((deviceId: string) => void) | null,
  payload: null as WidgetPayload | null,
  quitting: false,
};

// Chromium ships Web Bluetooth on Linux behind this switch.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    state.quitting = true;
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.uk.marshallbluetooth');
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
  });
}

ipcMain.on(CHANNELS.scan, () => {
  // A device request needs a user gesture; main grants one to the window's own call.
  state.window?.webContents.executeJavaScript('window.__roadieScan?.()', true).catch(() => undefined);
});
ipcMain.on(CHANNELS.select, (_event, deviceId: string) => answer(deviceId));
ipcMain.on(CHANNELS.cancel, () => answer(''));
ipcMain.on(CHANNELS.publish, (_event, payload: WidgetPayload) => {
  state.payload = payload;
  updateTray();
});

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'Roadie',
    width: 680,
    height: 520,
    minWidth: 560,
    minHeight: 440,
    icon: join(__dirname, 'icon.png'),
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  // Electron's chooser hook: called again each time the list grows, and the
  // request waits until `callback` is called once.
  window.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    state.choose = callback;
    const list: ChooserDevice[] = devices.map(({ deviceId, deviceName }) => ({ deviceId, deviceName }));
    window.webContents.send(CHANNELS.devices, list);
  });
  window.webContents.session.setBluetoothPairingHandler((details, respond) => {
    // Marshall speakers pair with "Just Works": confirm, never invent a PIN.
    respond({ confirmed: details.pairingKind === 'confirm' });
  });
  window.on('close', event => {
    if (!state.quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.once('ready-to-show', () => window.show());
  window.loadFile(join(__dirname, 'index.html'));
  state.window = window;
}

function createTray(): void {
  const tray = new Tray(nativeImage.createFromPath(join(__dirname, 'tray.png')));
  tray.setToolTip('Roadie');
  tray.on('click', showWindow);
  state.tray = tray;
  updateTray();
}

function showWindow(): void {
  state.window?.show();
  state.window?.focus();
}

function answer(deviceId: string): void {
  const choose = state.choose;
  state.choose = null;
  choose?.(deviceId);
}

function apply(action: TrayAction): void {
  const step = trayStep(state.payload, action);
  if (step === null) {
    return;
  }
  state.payload = step.payload;
  state.window?.webContents.send(CHANNELS.control, step.request);
  updateTray();
}

function updateTray(): void {
  const tray = state.tray;
  if (tray === null) {
    return;
  }
  const payload = state.payload;
  tray.setToolTip(payload === null ? 'Roadie' : `Roadie — ${payload.name}`);
  tray.setContextMenu(Menu.buildFromTemplate([...speakerItems(payload), ...appItems()]));
}

function speakerItems(payload: WidgetPayload | null): MenuItemConstructorOptions[] {
  if (payload === null) {
    return [{ label: 'No speaker selected', enabled: false }, { type: 'separator' }];
  }
  const can = (action: TrayAction) => trayStep(payload, action) !== null;
  const volume =
    payload.volume === null ? '—' : `${payload.volume} of ${payload.maxVolume ?? '—'}`;
  const tone = (value: number | null) => (value === null ? '—' : offsetFromFlat(value));
  return [
    { label: `${payload.name} — ${payload.isConnected ? 'Connected' : 'Not connected'}`, enabled: false },
    { type: 'separator' },
    { label: `Volume ${volume}`, enabled: false },
    { label: 'Volume Up', enabled: can({ kind: 'volume', step: 1 }), click: () => apply({ kind: 'volume', step: 1 }) },
    { label: 'Volume Down', enabled: can({ kind: 'volume', step: -1 }), click: () => apply({ kind: 'volume', step: -1 }) },
    { type: 'separator' },
    { label: `Bass ${tone(payload.bass)} · Treble ${tone(payload.treble)}`, enabled: false },
    { label: 'Bass Up', enabled: can({ kind: 'bass', step: 1 }), click: () => apply({ kind: 'bass', step: 1 }) },
    { label: 'Bass Down', enabled: can({ kind: 'bass', step: -1 }), click: () => apply({ kind: 'bass', step: -1 }) },
    { label: 'Treble Up', enabled: can({ kind: 'treble', step: 1 }), click: () => apply({ kind: 'treble', step: 1 }) },
    { label: 'Treble Down', enabled: can({ kind: 'treble', step: -1 }), click: () => apply({ kind: 'treble', step: -1 }) },
    {
      label: 'Reset Tone to Flat',
      enabled: can({ kind: 'flat' }) && !(payload.bass === EQ_STEPS.flat && payload.treble === EQ_STEPS.flat),
      click: () => apply({ kind: 'flat' }),
    },
    { type: 'separator' },
  ];
}

function appItems(): MenuItemConstructorOptions[] {
  return [
    { label: 'Show Roadie', click: showWindow },
    { label: 'Quit Roadie', click: () => app.quit() },
  ];
}
