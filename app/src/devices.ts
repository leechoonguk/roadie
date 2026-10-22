import type {
  ControlState,
  DeviceInfo,
  DeviceUpdate,
  DiscoveredDevice,
} from './native/marshallBle';
import type { WidgetPayload } from './native/widgetBridge';
import { EQ_STEPS } from './protocol';

export { FALLBACK_MAX_VOLUME } from './protocol';

/** The speaker's EQ scale (knob steps), defined once in `protocol.ts`. */
export const EQ_MAX = EQ_STEPS.max;
export const EQ_FLAT = EQ_STEPS.flat;
/** The Marshall control service, as CoreBluetooth spells it in an advertisement. */
export const CONTROL_SERVICE = 'FCCD';

/** One row of the device list: what the scan saw, plus everything a connection reported. */
export interface DeviceRow extends DiscoveredDevice {
  batteryPercent: number | null;
  isConnected: boolean;
  deviceInfo: DeviceInfo;
  controlState: ControlState;
}

/**
 * Merges a scan result into the list. A device that advertises again keeps the
 * battery and connection a connection reported; only the advertisement fields move.
 */
export function applyDiscovered(
  rows: readonly DeviceRow[],
  device: DiscoveredDevice,
): DeviceRow[] {
  const existing = rows.find(row => row.identifier === device.identifier);
  if (existing === undefined) {
    return [
      ...rows,
      {
        ...device,
        batteryPercent: null,
        isConnected: false,
        deviceInfo: {},
        controlState: {},
      },
    ];
  }
  return rows.map(row =>
    row.identifier === device.identifier ? { ...row, ...device } : row,
  );
}

/**
 * Applies a connection report field by field: each report carries only what it
 * read, so a key it lacks keeps the last known value. A report for a device the
 * list never saw is dropped.
 */
export function applyUpdate(
  rows: readonly DeviceRow[],
  update: DeviceUpdate,
): DeviceRow[] {
  return rows.map(row => {
    if (row.identifier !== update.identifier) {
      return row;
    }
    return {
      ...row,
      batteryPercent: update.batteryPercent ?? row.batteryPercent,
      isConnected: update.isConnected,
      deviceInfo: { ...row.deviceInfo, ...update.deviceInfo },
      controlState: { ...row.controlState, ...update.controlState },
    };
  });
}

/**
 * The speakers to list: Marshall devices only, one row per speaker.
 *
 * One ACTON III advertises under two BLE identities with the same name, only
 * one of which carries the control service (measured with `make ble-probe`).
 * Rows sharing a name collapse to the one most useful to control: connected
 * first, then the one advertising the control service, then the strongest.
 */
export function speakerRows(rows: readonly DeviceRow[]): DeviceRow[] {
  const rank = (row: DeviceRow) =>
    (row.isConnected ? 2 : 0) + (row.advertisedServices.includes(CONTROL_SERVICE) ? 1 : 0);
  const byName = new Map<string, DeviceRow>();
  for (const row of rows) {
    if (!row.isMarshallCandidate) {
      continue;
    }
    const kept = byName.get(displayName(row));
    if (
      kept === undefined ||
      rank(row) > rank(kept) ||
      (rank(row) === rank(kept) && row.rssi > kept.rssi)
    ) {
      byName.set(displayName(row), row);
    }
  }
  return [...byName.values()].sort((a, b) => b.rssi - a.rssi);
}

/** The advertised name without the " [LE]" the speaker appends to its BLE identity. */
export function displayName(row: DeviceRow): string {
  return (row.name ?? 'Unnamed device').replace(/\s*\[LE\]$/, '');
}

export function toWidgetPayload(row: DeviceRow): WidgetPayload {
  const { volume, maxVolume, bass, treble } = row.controlState;
  return {
    name: displayName(row),
    identifier: row.identifier,
    isConnected: row.isConnected,
    model: row.deviceInfo.model ?? null,
    batteryPercent: row.batteryPercent,
    volume: volume ?? null,
    maxVolume: maxVolume ?? null,
    bass: bass ?? null,
    treble: treble ?? null,
  };
}
