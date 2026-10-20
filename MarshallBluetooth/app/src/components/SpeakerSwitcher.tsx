import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { type DeviceRow, displayName } from '../devices';
import { colors, space } from '../theme';

interface SpeakerSwitcherProps {
  /** Marshall speakers only, one row each (`speakerRows`). */
  rows: DeviceRow[];
  selectedId: string | null;
  onSelect: (identifier: string) => void;
}

/**
 * One chip per speaker in range, shown only when there is more than one —
 * with a single speaker there is nothing to switch, and the hero names it.
 */
export function SpeakerSwitcher({ rows, selectedId, onSelect }: SpeakerSwitcherProps): React.JSX.Element | null {
  if (rows.length < 2) {
    return null;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {rows.map(row => {
        const selected = row.identifier === selectedId;
        return (
          <Pressable
            key={row.identifier}
            testID={`speaker-${row.identifier}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(row.identifier)}
            style={[styles.chip, selected && styles.selectedChip]}
          >
            <View style={[styles.dot, row.isConnected && styles.dotConnected]} />
            <Text style={[styles.chipText, selected && styles.selectedText]}>{displayName(row)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: space.s, paddingHorizontal: space.xl, paddingVertical: space.m },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: space.m,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  selectedChip: { backgroundColor: colors.selection, borderColor: colors.selection },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.track },
  dotConnected: { backgroundColor: colors.connected },
  chipText: { color: colors.label, fontSize: 13 },
  selectedText: { color: colors.selectedText, fontWeight: '600' },
});
