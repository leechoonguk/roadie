import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { type DeviceRow, displayName, EQ_FLAT, EQ_MAX, FALLBACK_MAX_VOLUME } from '../devices';
import { colors, space } from '../theme';
import { LevelSlider } from './LevelSlider';

interface SpeakerPanelProps {
  row: DeviceRow;
  /** What the desktop widget last did with this speaker, or null before the first publish. */
  widgetNote: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onVolume: (level: number) => void;
  onEQ: (bass: number, treble: number) => void;
}

/**
 * The speaker: who it is, whether it is connected, and its two controls.
 *
 * One column, top to bottom in the order someone reaches for them: volume
 * first, then tone. Every row shares the slider's fixed label and value
 * columns so the tracks line up whatever the numbers say.
 */
export function SpeakerPanel({
  row,
  widgetNote,
  onConnect,
  onDisconnect,
  onVolume,
  onEQ,
}: SpeakerPanelProps): React.JSX.Element {
  const { volume, maxVolume, bass, treble } = row.controlState;
  const top = maxVolume ?? FALLBACK_MAX_VOLUME;
  const details = [
    row.deviceInfo.firmwareVersion && `Firmware ${row.deviceInfo.firmwareVersion}`,
    row.deviceInfo.serialNumber && `Serial ${row.deviceInfo.serialNumber}`,
  ].filter(Boolean);
  // An EQ write carries both bands, so neither can move until both are known.
  const eqKnown = bass !== undefined && treble !== undefined;
  const flat = bass === EQ_FLAT && treble === EQ_FLAT;
  const offset = (step: number) => {
    const delta = step - EQ_FLAT;
    return delta > 0 ? `+${delta}` : String(delta);
  };

  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.heroText}>
          <Text style={styles.title}>{displayName(row)}</Text>
          <Text style={styles.subtitle}>
            {row.isConnected
              ? details.length > 0 ? details.join(' · ') : 'Connected'
              : 'Not connected'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={row.isConnected ? onDisconnect : onConnect}
          style={({ pressed }) => [styles.button, !row.isConnected && styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={[styles.buttonText, !row.isConnected && styles.primaryText]}>
            {row.isConnected ? 'Disconnect' : 'Connect'}
          </Text>
        </Pressable>
      </View>

      {!row.isConnected && (
        <Text testID="controls-offline" style={styles.notice}>
          Connect to adjust volume and tone. The speaker’s own knobs keep working either way.
        </Text>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Volume</Text>
          <Text style={styles.sectionValue}>{volume === undefined ? '' : `${volume} of ${top}`}</Text>
        </View>
        <LevelSlider
          label="Volume"
          value={volume}
          max={top}
          disabled={!row.isConnected}
          formatValue={String}
          onChange={onVolume}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Tone</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!row.isConnected || !eqKnown || flat}
            onPress={() => onEQ(EQ_FLAT, EQ_FLAT)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={[styles.link, (!row.isConnected || !eqKnown || flat) && styles.dimmed]}>
              Reset to flat
            </Text>
          </Pressable>
        </View>
        <LevelSlider
          label="Bass"
          value={bass}
          max={EQ_MAX}
          marker={EQ_FLAT}
          disabled={!row.isConnected || !eqKnown}
          formatValue={offset}
          onChange={step => treble !== undefined && onEQ(step, treble)}
        />
        <LevelSlider
          label="Treble"
          value={treble}
          max={EQ_MAX}
          marker={EQ_FLAT}
          disabled={!row.isConnected || !eqKnown}
          formatValue={offset}
          onChange={step => bass !== undefined && onEQ(bass, step)}
        />
      </View>

      {widgetNote !== null && (
        <Text testID="widget-note" style={styles.footnote}>
          {widgetNote}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingVertical: space.l, gap: space.xl },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.l, minHeight: 48 },
  heroText: { flex: 1, gap: 2 },
  title: { color: colors.label, fontSize: 26, fontWeight: '600', letterSpacing: -0.3 },
  subtitle: { color: colors.secondaryLabel, fontSize: 12 },
  button: {
    height: 28,
    paddingHorizontal: space.l,
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.card,
  },
  primaryButton: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.7 },
  buttonText: { color: colors.label, fontSize: 13 },
  primaryText: { color: colors.selectedText, fontWeight: '600' },
  notice: { color: colors.secondaryLabel, fontSize: 12 },
  section: { gap: space.s },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', height: 22 },
  sectionTitle: { color: colors.label, fontSize: 15, fontWeight: '600' },
  sectionValue: { color: colors.secondaryLabel, fontSize: 12, fontVariant: ['tabular-nums'] },
  link: { color: colors.accent, fontSize: 12 },
  dimmed: { opacity: 0.4 },
  footnote: { color: colors.tertiaryLabel, fontSize: 11 },
});
