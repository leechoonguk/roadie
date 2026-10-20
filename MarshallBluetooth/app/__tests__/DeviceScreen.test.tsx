import React from 'react';
import { DeviceEventEmitter, NativeModules, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import { DeviceScreen, SEARCH_TIMEOUT_MS, WIDGET_PUBLISH_DELAY_MS } from '../src/screens/DeviceScreen';

const marshallBle = {
  startScan: jest.fn(),
  stopScan: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  setEQ: jest.fn(),
  setVolume: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
const widgetBridge = { publish: jest.fn() };
// Unmounted after each test: FlatList schedules work on a timer, and a renderer
// left mounted updates state after its test has ended.
let mounted: ReactTestRenderer.ReactTestRenderer | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  widgetBridge.publish.mockResolvedValue(undefined);
  NativeModules.MarshallBle = marshallBle;
  NativeModules.WidgetBridge = widgetBridge;
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted?.unmount();
  });
  mounted = undefined;
  jest.useRealTimers();
});

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  await ReactTestRenderer.act(() => {
    mounted = ReactTestRenderer.create(<DeviceScreen />);
  });
  return mounted!;
}

async function emit(event: string, body: object): Promise<void> {
  await ReactTestRenderer.act(() => {
    DeviceEventEmitter.emit(event, body);
  });
}

/** Presses the button whose text is `label`, or the pressable with testID `label`. */
async function press(renderer: ReactTestRenderer.ReactTestRenderer, label: string): Promise<void> {
  const target = renderer.root
    .findAll(node => typeof node.props.onPress === 'function')
    .find(
      node =>
        node.props.testID === label ||
        node.findAllByType(Text).some(text => [text.props.children].flat().join('') === label),
    );
  if (target === undefined) {
    throw new Error(`nothing to press labelled ${label}`);
  }
  if (target.props.disabled) {
    throw new Error(`${label} is disabled`);
  }
  await ReactTestRenderer.act(async () => {
    await target.props.onPress();
  });
}

function textOf(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  return [renderer.root.findByProps({ testID }).props.children].flat().join('');
}

const acton = {
  identifier: 'A',
  name: 'ACTON III',
  rssi: -50,
  advertisedServices: ['FCCD'],
  isMarshallCandidate: true,
};

async function renderConnected(controlState?: object): Promise<ReactTestRenderer.ReactTestRenderer> {
  const renderer = await render();
  await emit('deviceDiscovered', acton);
  await emit('deviceUpdated', { identifier: 'A', isConnected: true, controlState });
  return renderer;
}

test('opening the app searches, and the search stops once a speaker connects', async () => {
  await render();
  expect(marshallBle.startScan).toHaveBeenCalledTimes(1);

  await emit('deviceDiscovered', acton);
  await emit('deviceUpdated', { identifier: 'A', isConnected: true });

  expect(marshallBle.stopScan).toHaveBeenCalledTimes(1);
});

test('a search that finds nothing ends on its own and can be started again', async () => {
  jest.useFakeTimers();
  const renderer = await render();

  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(SEARCH_TIMEOUT_MS);
  });
  expect(marshallBle.stopScan).toHaveBeenCalledTimes(1);
  expect(textOf(renderer, 'empty-list')).toContain('No speaker found');

  await press(renderer, 'Search Again');
  expect(marshallBle.startScan).toHaveBeenCalledTimes(2);
});

test('the first controllable speaker is selected and connected without a click', async () => {
  const renderer = await render();

  await emit('deviceDiscovered', acton);

  const texts = renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
  expect(texts).toContain('ACTON III');
  expect(marshallBle.connect).toHaveBeenCalledWith('A');
});

test('a manual disconnect is not undone by the automatic connect', async () => {
  const renderer = await renderConnected();
  marshallBle.connect.mockClear();

  await press(renderer, 'Disconnect');
  await emit('deviceUpdated', { identifier: 'A', isConnected: false });
  await emit('deviceDiscovered', acton);

  expect(marshallBle.disconnect).toHaveBeenCalledWith('A');
  expect(marshallBle.connect).not.toHaveBeenCalled();
});

test('other Bluetooth devices never become a speaker', async () => {
  const renderer = await render();
  await emit('deviceDiscovered', {
    identifier: 'X',
    name: 'iPhone',
    rssi: -40,
    advertisedServices: [],
    isMarshallCandidate: false,
  });

  expect(renderer.root.findAllByProps({ testID: 'speaker-X' })).toHaveLength(0);
  expect(marshallBle.connect).not.toHaveBeenCalled();
});

test('the switcher appears only with two speakers, and switching changes the hero', async () => {
  const renderer = await renderConnected();
  expect(renderer.root.findAllByProps({ testID: 'speaker-A' })).toHaveLength(0);

  await emit('deviceDiscovered', { ...acton, identifier: 'B', name: 'STANMORE III' });
  await press(renderer, 'speaker-B');

  const texts = renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
  expect(texts).toContain('STANMORE III');
});

test('a disconnected speaker offers no control that would be dropped natively', async () => {
  const renderer = await renderConnected();
  await emit('deviceUpdated', { identifier: 'A', isConnected: false });

  await expect(press(renderer, 'Volume-up')).rejects.toThrow('disabled');
  expect(marshallBle.setVolume).not.toHaveBeenCalled();
});

test('device info and volume reach the panel', async () => {
  const renderer = await renderConnected({ volume: 14, maxVolume: 31 });
  await emit('deviceUpdated', {
    identifier: 'A',
    isConnected: true,
    deviceInfo: { model: 'ACTON III', firmwareVersion: '8.2.2' },
  });

  const texts = renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
  expect(texts).toContain('Firmware 8.2.2');
  expect(textOf(renderer, 'Volume-value')).toBe('14');
});

test('volume steps from the reported level, and a quick second step from the first', async () => {
  const renderer = await renderConnected({ volume: 14, maxVolume: 31 });

  await press(renderer, 'Volume-up');
  await press(renderer, 'Volume-up');

  expect(marshallBle.setVolume.mock.calls).toEqual([
    ['A', 15],
    ['A', 16],
  ]);
});

test('dragging the volume track snaps to the nearest step', async () => {
  const renderer = await renderConnected({ volume: 14, maxVolume: 31 });
  const track = renderer.root.findByProps({ testID: 'Volume-track' });
  await ReactTestRenderer.act(() => {
    track.props.onLayout({ nativeEvent: { layout: { width: 310 } } });
  });

  await ReactTestRenderer.act(() => {
    track.props.onResponderGrant({ nativeEvent: { locationX: 248, touches: [] }, touchHistory: { touchBank: [] } });
  });

  expect(marshallBle.setVolume).toHaveBeenCalledWith('A', 25);
});

test('a bass step keeps the reported treble, and Flat resets both bands', async () => {
  const renderer = await renderConnected({ bass: 5, treble: 4 });

  await press(renderer, 'Bass-up');
  expect(textOf(renderer, 'Bass-value')).toBe('+1');
  await press(renderer, 'Reset to flat');

  expect(marshallBle.setEQ.mock.calls).toEqual([
    ['A', 6, 4],
    ['A', 5, 5],
  ]);
});

test('EQ stays locked until both bands are known, since a write carries both', async () => {
  const renderer = await renderConnected({ volume: 14 });

  await expect(press(renderer, 'Bass-up')).rejects.toThrow('disabled');
  expect(marshallBle.setEQ).not.toHaveBeenCalled();
});

test('the widget mirrors the selected speaker once its readings settle', async () => {
  jest.useFakeTimers();
  await renderConnected({ volume: 14, maxVolume: 31, bass: 5, treble: 4 });

  expect(widgetBridge.publish).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(WIDGET_PUBLISH_DELAY_MS);
  });

  expect(widgetBridge.publish).toHaveBeenCalledTimes(1);
  expect(widgetBridge.publish).toHaveBeenCalledWith({
    name: 'ACTON III',
    identifier: 'A',
    isConnected: true,
    model: null,
    batteryPercent: null,
    volume: 14,
    maxVolume: 31,
    bass: 5,
    treble: 4,
  });
});

test('a native publish rejection is shown, not swallowed', async () => {
  jest.useFakeTimers();
  widgetBridge.publish.mockRejectedValue(new Error('App Group container is not available'));
  const renderer = await renderConnected({ volume: 14 });

  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(WIDGET_PUBLISH_DELAY_MS);
  });

  expect(textOf(renderer, 'status')).toBe('App Group container is not available');
});
