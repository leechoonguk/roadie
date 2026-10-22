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

import {
  applyChange,
  type ControlAction,
  describeVolume,
  offsetFromFlat,
  stepControl,
} from '../../src/controls';
import type { WidgetPayload } from '../../src/native/widgetBridge';
import { CHANNELS, type ChooserDevice, type ControlRequest } from './bridge';
import { checkForUpdates, startUpdates, updateInfo, updatesSupported } from './updates';

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
    startUpdates();
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
ipcMain.handle(CHANNELS.updateInfo, () => updateInfo());
ipcMain.on(CHANNELS.checkForUpdates, () => {
  checkForUpdates(true).catch(() => undefined);
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

/** Shows the step at once, then has the window apply it; the window's republish corrects it. */
function apply(action: ControlAction): void {
  const payload = state.payload;
  const change = payload === null ? null : stepControl(payload, action);
  if (payload === null || change === null) {
    return;
  }
  state.payload = applyChange(payload, change);
  const request: ControlRequest = { identifier: payload.identifier, action };
  state.window?.webContents.send(CHANNELS.control, request);
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
  // A press connects for itself when the window has no connection, so only an
  // unread value or the end of a scale disables an item.
  const item = (label: string, action: ControlAction): MenuItemConstructorOptions => ({
    label,
    enabled: stepControl(payload, action) !== null,
    click: () => apply(action),
  });
  return [
    { label: `${payload.name} — ${payload.isConnected ? 'Connected' : 'Not connected'}`, enabled: false },
    { type: 'separator' },
    { label: `Volume ${describeVolume(payload)}`, enabled: false },
    item('Volume Up', { kind: 'volume', step: 1 }),
    item('Volume Down', { kind: 'volume', step: -1 }),
    { type: 'separator' },
    { label: `Bass ${offsetFromFlat(payload.bass)} · Treble ${offsetFromFlat(payload.treble)}`, enabled: false },
    item('Bass Up', { kind: 'bass', step: 1 }),
    item('Bass Down', { kind: 'bass', step: -1 }),
    item('Treble Up', { kind: 'treble', step: 1 }),
    item('Treble Down', { kind: 'treble', step: -1 }),
    item('Reset Tone to Flat', { kind: 'flat' }),
    { type: 'separator' },
  ];
}

function appItems(): MenuItemConstructorOptions[] {
  return [
    { label: 'Show Roadie', click: showWindow },
    ...(updatesSupported()
      ? [{ label: 'Check for Updates…', click: () => checkForUpdates(true).catch(() => undefined) }]
      : []),
    { label: 'Quit Roadie', click: () => app.quit() },
  ];
}
