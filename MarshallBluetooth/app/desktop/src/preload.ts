/**
 * The window's only door to the main process: a handful of named channels,
 * with no `ipcRenderer` handed to page code.
 */
import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS, type ChooserDevice, type ControlRequest, type RoadieBridge } from './bridge';

const bridge: RoadieBridge = {
  scan: () => ipcRenderer.send(CHANNELS.scan),
  select: deviceId => ipcRenderer.send(CHANNELS.select, deviceId),
  cancel: () => ipcRenderer.send(CHANNELS.cancel),
  publish: payload => ipcRenderer.send(CHANNELS.publish, payload),
  updateInfo: () => ipcRenderer.invoke(CHANNELS.updateInfo),
  checkForUpdates: () => ipcRenderer.send(CHANNELS.checkForUpdates),
  onDevices: listener => {
    ipcRenderer.on(CHANNELS.devices, (_event, devices: ChooserDevice[]) => listener(devices));
  },
  onControl: listener => {
    ipcRenderer.on(CHANNELS.control, (_event, request: ControlRequest) => listener(request));
  },
};

contextBridge.exposeInMainWorld('roadie', bridge);
