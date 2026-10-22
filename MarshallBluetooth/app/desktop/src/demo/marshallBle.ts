/**
 * `app/src/native/marshallBle.ts` for the README's recording: the shared
 * client (`app/src/ble/client.ts`) over a speaker that exists only in memory.
 * `ROADIE_DEMO=1 node build.ts` swaps it in for Web Bluetooth (`build.ts`), and
 * `make demo` records the window it drives. No installer ever carries it.
 *
 * The speaker answers with the bytes an ACTON III (firmware 8.2.2) was measured
 * to send — the same values `__tests__/protocol.test.ts` pins — so what the
 * recording shows is what the real speaker shows.
 */
import { type BleTransport, createMarshallBle, type GattLink } from '../../../src/ble/client';
import { UUIDS } from '../../../src/protocol';

const SPEAKER = { identifier: 'demo-acton-iii', name: 'ACTON III' };
/** How long the speaker takes to show up and to answer, so the recording reads as a real search. */
const DISCOVERY_DELAY_MS = 900;
const GATT_DELAY_MS = 40;

const ascii = (text: string) => [...text].map(character => character.charCodeAt(0));

/** The values the speaker holds, keyed by characteristic. It has no battery: an ACTON is mains powered. */
const stored = new Map<string, number[]>([
  [UUIDS.modelNumber, ascii('ACTON III')],
  [UUIDS.firmwareVersion, ascii('8.2.2')],
  [UUIDS.serialNumber, ascii('DEMO-0001')],
  [UUIDS.maxVolume, [31]],
  [UUIDS.volume, [12]],
  [UUIDS.equalizer, [5, 0xff, 0xff, 0xff, 5]],
]);
const watchers = new Map<string, (value: Uint8Array) => void>();

const demoSpeaker: BleTransport = {
  watchState(listener) {
    listener('poweredOn');
  },
  startScan(onDevice) {
    setTimeout(
      () => onDevice({ ...SPEAKER, rssi: -48, advertisedServices: ['FCCD'], isMarshallCandidate: true }),
      DISCOVERY_DELAY_MS,
    );
  },
  stopScan() {},
  async connect(identifier) {
    if (identifier !== SPEAKER.identifier) {
      throw new Error('Unknown device');
    }
    await settle();
    return link;
  },
};

const link: GattLink = {
  async read(_service, characteristic) {
    await settle();
    const value = stored.get(characteristic);
    return value === undefined ? null : Uint8Array.from(value);
  },
  async write(_service, characteristic, value) {
    await settle();
    stored.set(characteristic, [...value]);
  },
  async watch(_service, characteristic, listener) {
    watchers.set(characteristic, listener);
  },
  async disconnect() {},
};

export const marshallBle = createMarshallBle(demoSpeaker);

/** A knob turned on the speaker itself: it arrives as a notification, as on the real one. */
export function turnKnob(name: 'volume' | 'equalizer', value: number[]): void {
  const characteristic = UUIDS[name];
  stored.set(characteristic, value);
  watchers.get(characteristic)?.(Uint8Array.from(value));
}

// `demo.ts` turns the knob through the page. `globalThis` is the window in the
// bundle, and lets a test import this file without one.
Object.assign(globalThis, { __roadieDemoTurn: turnKnob });

function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, GATT_DELAY_MS));
}
