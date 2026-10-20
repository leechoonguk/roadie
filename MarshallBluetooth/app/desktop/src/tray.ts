/**
 * What a tray item does, mirroring the macOS widget's intents
 * (`ControlIntents.swift`): step from the speaker's last reported value, and do
 * nothing until that value has been read — stepping from a guess writes the
 * guess, and volume 0 on a speaker not yet read is silence.
 */
import type { WidgetPayload } from '../../src/native/widgetBridge';
import type { ControlRequest } from './bridge';
import { clamp, EQ_STEPS, FALLBACK_MAX_VOLUME } from './protocol';

export type TrayAction =
  | { kind: 'volume'; step: number }
  | { kind: 'bass'; step: number }
  | { kind: 'treble'; step: number }
  | { kind: 'flat' };

/** The request for `action`, and the payload as it should read until the speaker answers. */
export interface TrayStep {
  request: ControlRequest;
  payload: WidgetPayload;
}

export function trayStep(payload: WidgetPayload | null, action: TrayAction): TrayStep | null {
  if (payload === null || !payload.isConnected) {
    return null;
  }
  const { identifier, volume, maxVolume, bass, treble } = payload;
  if (action.kind === 'volume') {
    if (volume === null) {
      return null;
    }
    const level = clamp(volume + action.step, 0, maxVolume ?? FALLBACK_MAX_VOLUME);
    return { request: { kind: 'volume', identifier, level }, payload: { ...payload, volume: level } };
  }
  // An EQ write carries both bands, so both must be known.
  if (bass === null || treble === null) {
    return null;
  }
  const next =
    action.kind === 'flat'
      ? { bass: EQ_STEPS.flat, treble: EQ_STEPS.flat }
      : action.kind === 'bass'
        ? { bass: clamp(bass + action.step, EQ_STEPS.min, EQ_STEPS.max), treble }
        : { bass, treble: clamp(treble + action.step, EQ_STEPS.min, EQ_STEPS.max) };
  return { request: { kind: 'eq', identifier, ...next }, payload: { ...payload, ...next } };
}

/** `−2`, `0`, `+3`: EQ steps read as an offset from flat, as the window shows them. */
export function offsetFromFlat(step: number): string {
  const offset = step - EQ_STEPS.flat;
  return offset > 0 ? `+${offset}` : String(offset);
}
