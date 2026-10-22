/**
 * What a volume or tone button does, for every JavaScript surface that has
 * one: the Windows/Linux tray, the Android widget, and the Bluetooth client
 * applying a press. The Apple widgets do the same in Swift (`ControlStep.swift`).
 *
 * A step moves from the speaker's last reported value and does nothing until
 * that value has been read: stepping from a guess writes the guess, and
 * volume 0 on a speaker not yet read is silence.
 */
import { clamp, EQ_STEPS, FALLBACK_MAX_VOLUME } from './protocol';

/** A button press: one step of one setting, or both tone bands back to flat. */
export type ControlAction =
  | { kind: 'volume'; step: number }
  | { kind: 'bass'; step: number }
  | { kind: 'treble'; step: number }
  | { kind: 'flat' };

/** What a press writes. An EQ write always carries both bands. */
export type ControlChange =
  | { kind: 'volume'; level: number }
  | { kind: 'eq'; bass: number; treble: number };

/** The settings a press reads; null is "not read from the speaker yet". */
export interface ControlValues {
  volume: number | null;
  maxVolume: number | null;
  bass: number | null;
  treble: number | null;
}

/** The change `action` makes to `values`, or null when it cannot or would change nothing. */
export function stepControl(values: ControlValues, action: ControlAction): ControlChange | null {
  const { volume, maxVolume, bass, treble } = values;
  if (action.kind === 'volume') {
    if (volume === null) {
      return null;
    }
    const level = clamp(volume + action.step, 0, maxVolume ?? FALLBACK_MAX_VOLUME);
    return level === volume ? null : { kind: 'volume', level };
  }
  if (bass === null || treble === null) {
    return null;
  }
  const next =
    action.kind === 'flat'
      ? { bass: EQ_STEPS.flat, treble: EQ_STEPS.flat }
      : action.kind === 'bass'
        ? { bass: clamp(bass + action.step, EQ_STEPS.min, EQ_STEPS.max), treble }
        : { bass, treble: clamp(treble + action.step, EQ_STEPS.min, EQ_STEPS.max) };
  return next.bass === bass && next.treble === treble ? null : { kind: 'eq', ...next };
}

/** `values` as they read once `change` is stored — what a surface shows until the speaker answers. */
export function applyChange<Values extends ControlValues>(values: Values, change: ControlChange): Values {
  return change.kind === 'volume'
    ? { ...values, volume: change.level }
    : { ...values, bass: change.bass, treble: change.treble };
}

/** `12 of 31`, or `—` before the speaker has reported its volume. */
export function describeVolume({ volume, maxVolume }: ControlValues): string {
  return volume === null ? '—' : `${volume} of ${maxVolume ?? FALLBACK_MAX_VOLUME}`;
}

/** `−2`, `0`, `+3`: an EQ step read as an offset from flat, as the window shows it. */
export function offsetFromFlat(step: number | null): string {
  if (step === null) {
    return '—';
  }
  const offset = step - EQ_STEPS.flat;
  return offset > 0 ? `+${offset}` : String(offset);
}
