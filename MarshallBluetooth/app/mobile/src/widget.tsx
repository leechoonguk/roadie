/**
 * The Android home screen widget, drawn and driven from JavaScript by
 * react-native-android-widget (`RoadieWidget.kt` is its empty provider).
 *
 * A phone stops the app in the background, so there is no resident app to
 * hand a press to, as on macOS. A press instead runs as a background task: it
 * shows the step at once, connects to the speaker for that one change through
 * the shared client (`applyStep`, which steps from what the speaker reports
 * now), and draws what the speaker stored. The app publishes the selected
 * speaker here (`widgetBridge.ts`), so the widget always names one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import {
  FlexWidget,
  registerWidgetTaskHandler,
  requestWidgetUpdate,
  TextWidget,
  type WidgetTaskHandlerProps,
} from 'react-native-android-widget';

import {
  applyChange,
  type ControlAction,
  type ControlValues,
  describeVolume,
  offsetFromFlat,
  stepControl,
} from '../../src/controls';
import type { WidgetPayload } from '../../src/native/widgetBridge';
import { type Palette, PALETTES } from '../../src/theme';
import { marshallBle } from './marshallBle';

/** The provider class's name, which is how the library addresses the widget. */
export const WIDGET_NAME = 'RoadieWidget';
const SNAPSHOT_KEY = 'roadie.widget.snapshot';
/** The click action for every step button; the step itself rides in its data. */
const STEP = 'STEP';

/** What a press is doing, shown under the controls. */
type Activity = 'idle' | 'busy' | 'unreachable';

interface Row {
  label: string;
  value: string;
  down: ControlAction;
  up: ControlAction;
}

/** The task the library runs for every widget update and press. */
export function registerBackgroundTasks(): void {
  registerWidgetTaskHandler(handleWidgetTask);
}

/** Stores the selected speaker and redraws every placed widget with it. */
export async function showOnWidget(payload: WidgetPayload): Promise<void> {
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
  await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => render(payload, 'idle') });
}

export async function handleWidgetTask({
  widgetAction,
  clickAction,
  clickActionData,
  renderWidget,
}: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_DELETED') {
    return;
  }
  const payload = await loadSnapshot();
  const action = clickAction === STEP ? parseAction(clickActionData) : null;
  const change = payload === null || action === null ? null : stepControl(payload, action);
  if (payload === null || action === null || change === null) {
    renderWidget(render(payload, 'idle'));
    return;
  }
  renderWidget(render(applyChange(payload, change), 'busy'));
  try {
    const stored = merge(payload, await marshallBle.applyStep(payload.identifier, action));
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(stored));
    renderWidget(render(stored, 'idle'));
  } catch {
    renderWidget(render(payload, 'unreachable'));
  }
}

async function loadSnapshot(): Promise<WidgetPayload | null> {
  const stored = await AsyncStorage.getItem(SNAPSHOT_KEY).catch(() => null);
  return stored === null ? null : (JSON.parse(stored) as WidgetPayload);
}

/** A value the speaker did not report this time keeps the last one known. */
function merge(payload: WidgetPayload, values: ControlValues): WidgetPayload {
  return {
    ...payload,
    volume: values.volume ?? payload.volume,
    maxVolume: values.maxVolume ?? payload.maxVolume,
    bass: values.bass ?? payload.bass,
    treble: values.treble ?? payload.treble,
  };
}

/** Click data crosses the native boundary untyped; only a well-formed step is applied. */
function parseAction(data: Record<string, unknown> | undefined): ControlAction | null {
  const kind = data?.kind;
  const step = data?.step;
  if (kind === 'flat') {
    return { kind };
  }
  if ((kind === 'volume' || kind === 'bass' || kind === 'treble') && typeof step === 'number') {
    return { kind, step };
  }
  return null;
}

function render(payload: WidgetPayload | null, activity: Activity) {
  return { light: view(payload, activity, PALETTES.light), dark: view(payload, activity, PALETTES.dark) };
}

function view(payload: WidgetPayload | null, activity: Activity, colors: Palette): React.JSX.Element {
  if (payload === null) {
    return (
      <FlexWidget
        clickAction="OPEN_APP"
        style={{ ...panel(colors), justifyContent: 'center', alignItems: 'center' }}
      >
        <TextWidget text="Roadie" style={{ fontSize: 16, fontWeight: '600', color: colors.label }} />
        <TextWidget
          text="Open Roadie to choose your speaker"
          style={{ fontSize: 12, color: colors.secondaryLabel }}
        />
      </FlexWidget>
    );
  }
  const rows: Row[] = [
    { label: 'Volume', value: describeVolume(payload), down: { kind: 'volume', step: -1 }, up: { kind: 'volume', step: 1 } },
    { label: 'Bass', value: offsetFromFlat(payload.bass), down: { kind: 'bass', step: -1 }, up: { kind: 'bass', step: 1 } },
    { label: 'Treble', value: offsetFromFlat(payload.treble), down: { kind: 'treble', step: -1 }, up: { kind: 'treble', step: 1 } },
  ];
  const note =
    activity === 'busy' ? 'Updating…' : activity === 'unreachable' ? "Couldn't reach the speaker" : 'Flat';
  return (
    <FlexWidget style={{ ...panel(colors), flexDirection: 'column', justifyContent: 'space-between' }}>
      <FlexWidget clickAction="OPEN_APP" style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between' }}>
        <TextWidget text={payload.name} maxLines={1} truncate="END" style={{ fontSize: 15, fontWeight: '600', color: colors.label }} />
        <TextWidget
          text={payload.isConnected ? 'Connected' : 'Tap a button to connect'}
          style={{ fontSize: 11, color: payload.isConnected ? colors.connected : colors.secondaryLabel }}
        />
      </FlexWidget>
      {rows.map(row => (
        <FlexWidget key={row.label} style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center' }}>
          <TextWidget text={row.label} style={{ fontSize: 12, color: colors.secondaryLabel, width: 64 }} />
          {button('−', row.down, payload, colors)}
          <TextWidget text={row.value} style={{ fontSize: 13, color: colors.label, width: 76, textAlign: 'center' }} />
          {button('+', row.up, payload, colors)}
        </FlexWidget>
      ))}
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'flex-end' }}>
        {activity === 'idle'
          ? button(note, { kind: 'flat' }, payload, colors)
          : <TextWidget text={note} style={{ fontSize: 11, color: activity === 'busy' ? colors.secondaryLabel : colors.error }} />}
      </FlexWidget>
    </FlexWidget>
  );
}

/** A step button, dimmed and inert when the step cannot apply (unread value, end of the scale). */
function button(text: string, action: ControlAction, payload: WidgetPayload, colors: Palette): React.JSX.Element {
  const enabled = stepControl(payload, action) !== null;
  return (
    <FlexWidget
      clickAction={enabled ? STEP : undefined}
      clickActionData={enabled ? { ...action } : undefined}
      accessibilityLabel={`${text} ${action.kind}`}
      style={{
        height: 28,
        width: text.length > 1 ? 'wrap_content' : 28,
        paddingHorizontal: text.length > 1 ? 10 : 0,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: enabled ? colors.track : colors.card,
      }}
    >
      <TextWidget text={text} style={{ fontSize: 14, fontWeight: '600', color: enabled ? colors.label : colors.tertiaryLabel }} />
    </FlexWidget>
  );
}

function panel(colors: Palette) {
  return {
    height: 'match_parent' as const,
    width: 'match_parent' as const,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.window,
  };
}
