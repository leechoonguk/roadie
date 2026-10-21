import type React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { handleWidgetTask, showOnWidget } from '../mobile/src/widget';
import type { WidgetPayload } from '../src/native/widgetBridge';

const mockApplyStep = jest.fn();
const mockStorage = new Map<string, string>();

jest.mock('../mobile/src/marshallBle', () => ({
  marshallBle: { applyStep: (...args: unknown[]) => mockApplyStep(...args) },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockStorage.set(key, value);
  },
}));
jest.mock('react-native-android-widget', () => ({
  FlexWidget: 'FlexWidget',
  TextWidget: 'TextWidget',
  registerWidgetTaskHandler: jest.fn(),
  requestWidgetUpdate: jest.fn(async () => undefined),
}));

const acton: WidgetPayload = {
  name: 'ACTON III',
  identifier: 'phone-id',
  isConnected: false,
  model: 'ACTON III',
  batteryPercent: null,
  volume: 12,
  maxVolume: 31,
  bass: 5,
  treble: 5,
};

/** Every text a drawn widget shows, in order. */
function texts(element: React.ReactElement): string[] {
  const props = element.props as { text?: string; children?: unknown };
  const children = [props.children].flat(Infinity).filter(Boolean) as React.ReactElement[];
  return [...(props.text === undefined ? [] : [props.text]), ...children.flatMap(texts)];
}

/** Runs one task the way the library would, returning what it drew (light variant). */
async function run(props: Partial<WidgetTaskHandlerProps>): Promise<string[][]> {
  const drawn: string[][] = [];
  await handleWidgetTask({
    widgetAction: 'WIDGET_CLICK',
    widgetInfo: {} as WidgetTaskHandlerProps['widgetInfo'],
    renderWidget: widget => drawn.push(texts((widget as { light: React.ReactElement }).light)),
    ...props,
  });
  return drawn;
}

beforeEach(() => {
  mockStorage.clear();
  mockApplyStep.mockReset();
});

test('before the app has chosen a speaker, the widget asks to open it', async () => {
  const drawn = await run({ widgetAction: 'WIDGET_ADDED' });

  expect(drawn).toEqual([['Roadie', 'Open Roadie to choose your speaker']]);
});

test('a press shows the step at once, then what the speaker stored', async () => {
  await showOnWidget(acton);
  // The knob had moved the speaker to 20; the press steps from there, not from 12.
  mockApplyStep.mockResolvedValue({ volume: 21, maxVolume: 31, bass: 5, treble: 5 });

  const drawn = await run({ clickAction: 'STEP', clickActionData: { kind: 'volume', step: 1 } });

  expect(mockApplyStep).toHaveBeenCalledWith('phone-id', { kind: 'volume', step: 1 });
  expect(drawn.map(lines => lines[4])).toEqual(['13 of 31', '21 of 31']);
  expect(drawn[0]).toContain('Updating…');
  expect(JSON.parse(mockStorage.get('roadie.widget.snapshot')!).volume).toBe(21);
});

test('a speaker out of reach leaves the last known values and says so', async () => {
  await showOnWidget(acton);
  mockApplyStep.mockRejectedValue(new Error('timeout'));

  const drawn = await run({ clickAction: 'STEP', clickActionData: { kind: 'bass', step: 1 } });

  expect(drawn[1]).toContain("Couldn't reach the speaker");
  expect(drawn[1]).toContain('0');
  expect(JSON.parse(mockStorage.get('roadie.widget.snapshot')!).bass).toBe(5);
});

test('a press that cannot apply is not sent', async () => {
  await showOnWidget({ ...acton, bass: null });

  await run({ clickAction: 'STEP', clickActionData: { kind: 'flat' } });
  await run({ clickAction: 'STEP', clickActionData: { kind: 'volume', step: 'up' } });

  expect(mockApplyStep).not.toHaveBeenCalled();
});
