import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Platform } from 'react-native';

import { SpeakerPanel } from '../components/SpeakerPanel';
import { SpeakerSwitcher } from '../components/SpeakerSwitcher';
import {
  applyDiscovered,
  applyUpdate,
  CONTROL_SERVICE,
  type DeviceRow,
  speakerRows,
  toWidgetPayload,
} from '../devices';
import { type BluetoothState, type ControlState, marshallBle } from '../native/marshallBle';
import { publishToWidget, type WidgetPayload } from '../native/widgetBridge';
import { colors, space } from '../theme';

/**
 * A knob turn arrives as a burst of notifications. The widget is republished
 * once the burst settles, so WidgetKit's reload budget goes to final values —
 * but briefly, so a widget press sees the speaker's own value within a beat.
 */
export const WIDGET_PUBLISH_DELAY_MS = 250;

/**
 * A search ends on its own: scanning keeps the radio busy, and a speaker that
 * is on advertises within seconds. Search Again starts a new one.
 */
export const SEARCH_TIMEOUT_MS = 20000;

// The same screen runs on Windows and Linux through react-native-web, where
// the macOS places these hints name do not exist.
const BLUETOOTH_HINTS: Partial<Record<BluetoothState, string>> = Platform.select({
  macos: {
    poweredOff: 'Bluetooth is off. Turn it on in Control Center to find your speaker.',
    unauthorized:
      'Marshall Bluetooth may not use Bluetooth. Allow it in System Settings › Privacy & Security › Bluetooth.',
    unsupported: 'This Mac does not support Bluetooth Low Energy.',
  },
  default: {
    poweredOff: 'Bluetooth is off or no adapter was found. Turn it on in your system settings to find your speaker.',
    unauthorized: 'Roadie may not use Bluetooth. Allow it in your system settings.',
    unsupported: 'This computer does not support Bluetooth Low Energy.',
  },
});

/** Where the selected speaker also shows: the desktop widget on macOS, the tray elsewhere. */
const MIRROR = Platform.select({ macos: 'the desktop widget', default: 'the tray menu' });

/**
 * The window: the Marshall speakers in range and the selected one's controls.
 *
 * Opening the app is the request to control the speaker, so it searches at
 * launch, selects and connects the first speaker that offers the control
 * service, and stops searching once connected. The selected speaker is also
 * what the desktop widget shows — selecting is choosing.
 */
export function DeviceScreen(): React.JSX.Element {
  const [bluetooth, setBluetooth] = useState<BluetoothState>('unknown');
  const [scanning, setScanning] = useState(false);
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [widgetNote, setWidgetNote] = useState<string | null>(null);
  // Speakers connected automatically once; after a manual Disconnect the app
  // must not reconnect behind the user's back.
  const autoConnected = useRef(new Set<string>());

  const speakers = speakerRows(rows);
  const selected = rows.find(row => row.identifier === selectedId) ?? null;
  const anyConnected = rows.some(row => row.isConnected);
  // Keyed by content, not identity: the row object changes with every RSSI
  // reading during a scan, and a publish timer reset by each would never fire.
  const widgetKey = selected === null ? null : JSON.stringify(toWidgetPayload(selected));

  useEffect(() => {
    const subscriptions = [
      marshallBle.onStateChanged(setBluetooth),
      marshallBle.onDeviceDiscovered(device =>
        setRows(current => applyDiscovered(current, device)),
      ),
      marshallBle.onDeviceUpdated(update =>
        setRows(current => applyUpdate(current, update)),
      ),
      marshallBle.onDeviceFailed(failure => setStatus(failure.message)),
    ];
    // The core waits for Bluetooth to power on before it actually scans.
    marshallBle.startScan();
    setScanning(true);
    return () => subscriptions.forEach(subscription => subscription.remove());
  }, []);

  useEffect(() => {
    if (!scanning) {
      return;
    }
    if (anyConnected) {
      marshallBle.stopScan();
      setScanning(false);
      return;
    }
    const timer = setTimeout(() => {
      marshallBle.stopScan();
      setScanning(false);
    }, SEARCH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [scanning, anyConnected]);

  // Only an identity advertising the control service is picked automatically:
  // the speaker's other BLE identity connects but carries no controls.
  const controllable = speakers.find(row => row.advertisedServices.includes(CONTROL_SERVICE));
  // Keyed on the row, not the id: a search can drop the selected row, and
  // the next controllable speaker must then be picked up again.
  useEffect(() => {
    if (selected !== null || controllable === undefined) {
      return;
    }
    setSelectedId(controllable.identifier);
    if (!controllable.isConnected && !autoConnected.current.has(controllable.identifier)) {
      autoConnected.current.add(controllable.identifier);
      marshallBle.connect(controllable.identifier);
    }
  }, [controllable, selected]);

  useEffect(() => {
    if (widgetKey === null) {
      return;
    }
    const timer = setTimeout(() => {
      publishToWidget(JSON.parse(widgetKey) as WidgetPayload)
        .then(() =>
          setWidgetNote(`Shown on ${MIRROR} · updated ${new Date().toLocaleTimeString()}`),
        )
        .catch((error: unknown) =>
          setStatus(error instanceof Error ? error.message : String(error)),
        );
    }, WIDGET_PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [widgetKey]);

  // The core forgets every speaker that is not connected when a search starts,
  // so a row kept here would offer a Connect that fails as "Unknown device".
  const searchAgain = () => {
    setRows(current => current.filter(row => row.isConnected));
    marshallBle.startScan();
    setScanning(true);
  };

  // Applied locally first: the speaker's read-back follows within a round
  // trip, and a second press before it must step from the value just set.
  const changeControl = (identifier: string, patch: ControlState, send: () => void) => {
    setRows(current => applyUpdate(current, { identifier, isConnected: true, controlState: patch }));
    send();
  };

  const hint = BLUETOOTH_HINTS[bluetooth];

  return (
    <View style={styles.window}>
      <View style={styles.toolbar}>
        <View style={styles.status}>
          <View style={[styles.statusDot, bluetooth === 'poweredOn' && styles.statusDotOn]} />
          <Text testID="bluetooth-state" style={styles.statusText}>
            {bluetooth === 'poweredOn'
              ? scanning ? 'Searching for speakers…' : 'Bluetooth on'
              : `Bluetooth ${bluetooth}`}
          </Text>
          {scanning && <ActivityIndicator size="small" />}
        </View>
        {!scanning && (
          <Pressable
            accessibilityRole="button"
            onPress={searchAgain}
            style={({ pressed }) => [styles.toolbarButton, pressed && styles.pressed]}
          >
            <Text style={styles.toolbarButtonText}>Search Again</Text>
          </Pressable>
        )}
      </View>
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
      {status !== null && (
        <View style={styles.errorBanner}>
          <Text testID="status" style={styles.errorText}>
            {status}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setStatus(null)}>
            <Text style={styles.dismiss}>Dismiss</Text>
          </Pressable>
        </View>
      )}
      <SpeakerSwitcher rows={speakers} selectedId={selectedId} onSelect={setSelectedId} />
      {selected === null ? (
        <View style={styles.empty}>
          <Text style={styles.emptyGlyph}>{scanning ? '◌' : '○'}</Text>
          <Text testID="empty-list" style={styles.emptyTitle}>
            {scanning ? 'Looking for your Marshall speaker' : 'No speaker found'}
          </Text>
          <Text style={styles.emptyText}>
            {scanning
              ? 'Make sure it is switched on and nearby.'
              : 'Turn the speaker on, or hold its Bluetooth button, then search again.'}
          </Text>
        </View>
      ) : (
        <SpeakerPanel
          key={selected.identifier}
          row={selected}
          widgetNote={widgetNote}
          onConnect={() => marshallBle.connect(selected.identifier)}
          onDisconnect={() => marshallBle.disconnect(selected.identifier)}
          onVolume={level =>
            changeControl(selected.identifier, { volume: level }, () =>
              marshallBle.setVolume(selected.identifier, level),
            )
          }
          onEQ={(bass, treble) =>
            changeControl(selected.identifier, { bass, treble }, () =>
              marshallBle.setEQ(selected.identifier, bass, treble),
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: colors.window },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: space.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  statusDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.track },
  statusDotOn: { backgroundColor: colors.connected },
  statusText: { color: colors.secondaryLabel, fontSize: 12 },
  toolbarButton: {
    height: 26,
    paddingHorizontal: space.m,
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.card,
  },
  toolbarButtonText: { color: colors.label, fontSize: 12 },
  pressed: { opacity: 0.7 },
  hint: {
    paddingHorizontal: space.xl,
    paddingVertical: space.s,
    color: colors.secondaryLabel,
    fontSize: 12,
    backgroundColor: colors.card,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingHorizontal: space.xl,
    paddingVertical: space.s,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 12 },
  dismiss: { color: colors.accent, fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s, padding: space.xl },
  emptyGlyph: { color: colors.tertiaryLabel, fontSize: 40 },
  emptyTitle: { color: colors.label, fontSize: 15, fontWeight: '600' },
  emptyText: { color: colors.secondaryLabel, fontSize: 12, textAlign: 'center', maxWidth: 320 },
});
