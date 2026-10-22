import React, { useRef, useState } from 'react';
import { type LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, space } from '../theme';

interface LevelSliderProps {
  label: string;
  /** Current step, or undefined until the speaker has reported one. */
  value: number | undefined;
  max: number;
  /** A step drawn with a notch — the EQ's flat point. */
  marker?: number;
  disabled?: boolean;
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
}

const TRACK_HEIGHT = 6;
const THUMB = 20;
const LABEL_WIDTH = 64;
const VALUE_WIDTH = 64;

/**
 * A macOS-style slider that only ever lands on integer steps.
 *
 * The speaker stores integer steps (volume 0–31, EQ 0–10), so a drag snaps to
 * the nearest step as it moves and the thumb never rests between two values
 * the speaker could hold. −/+ move one step; clicking the track jumps. To
 * assistive technology it is one adjustable element with increment/decrement.
 */
export function LevelSlider({
  label,
  value,
  max,
  marker,
  disabled = false,
  formatValue = String,
  onChange,
}: LevelSliderProps): React.JSX.Element {
  const [trackWidth, setTrackWidth] = useState(0);
  // Read inside PanResponder callbacks, which are created once.
  const latest = useRef({ value, max, trackWidth, disabled, onChange });
  latest.current = { value, max, trackWidth, disabled, onChange };
  const inactive = disabled || value === undefined;

  const stepAt = (x: number): number => {
    const { max: steps, trackWidth: width } = latest.current;
    return Math.round(Math.min(Math.max(x / width, 0), 1) * steps);
  };
  const commit = (next: number) => {
    const { value: current, max: steps, onChange: change } = latest.current;
    const clamped = Math.min(steps, Math.max(0, next));
    if (clamped !== current) {
      change(clamped);
    }
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled && latest.current.value !== undefined,
      onMoveShouldSetPanResponder: () => !latest.current.disabled && latest.current.value !== undefined,
      onPanResponderGrant: event => commit(stepAt(event.nativeEvent.locationX)),
      onPanResponderMove: event => commit(stepAt(event.nativeEvent.locationX)),
    }),
  ).current;

  const fraction = value === undefined ? 0 : value / max;
  const thumbLeft = fraction * Math.max(trackWidth - THUMB, 0);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive }}
      accessibilityValue={value === undefined ? { text: 'unknown' } : { min: 0, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        if (!inactive) {
          commit(value + (event.nativeEvent.actionName === 'increment' ? 1 : -1));
        }
      }}
      style={styles.row}
    >
      <Text style={styles.label}>{label}</Text>
      <StepButton testID={`${label}-down`} glyph="−" disabled={inactive || value === 0} onPress={() => commit(value! - 1)} />
      <View
        testID={`${label}-track`}
        style={[styles.trackArea, inactive && styles.dimmed]}
        onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
        </View>
        {marker !== undefined && (
          <View style={[styles.marker, { left: (marker / max) * Math.max(trackWidth - THUMB, 0) + THUMB / 2 - 1 }]} />
        )}
        {value !== undefined && <View style={[styles.thumb, { left: thumbLeft }]} />}
      </View>
      <StepButton testID={`${label}-up`} glyph="+" disabled={inactive || value === max} onPress={() => commit(value! + 1)} />
      <Text testID={`${label}-value`} style={styles.value}>
        {value === undefined ? '—' : formatValue(value)}
      </Text>
    </View>
  );
}

function StepButton({
  testID,
  glyph,
  disabled,
  onPress,
}: {
  testID: string;
  glyph: string;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityElementsHidden
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.stepButton, pressed && styles.pressed, disabled && styles.dimmed]}
    >
      <Text style={styles.stepGlyph}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, height: 32 },
  label: { width: LABEL_WIDTH, color: colors.label, fontSize: 13 },
  trackArea: { flex: 1, height: 32, justifyContent: 'center' },
  track: { height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: TRACK_HEIGHT, backgroundColor: colors.accent },
  marker: { position: 'absolute', top: 6, width: 2, height: 20, borderRadius: 1, backgroundColor: colors.tertiaryLabel },
  thumb: {
    position: 'absolute',
    top: (32 - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  dimmed: { opacity: 0.4 },
  stepButton: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.track },
  stepGlyph: { color: colors.label, fontSize: 15, lineHeight: 18 },
  value: { width: VALUE_WIDTH, textAlign: 'right', color: colors.secondaryLabel, fontSize: 13, fontVariant: ['tabular-nums'] },
});
