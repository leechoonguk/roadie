import { applyChange, describeVolume, offsetFromFlat, stepControl } from '../src/controls';

const values = { volume: 30, maxVolume: 31, bass: 5, treble: 9 };

test('a step moves from the reading, and a step past an end changes nothing', () => {
  expect(stepControl(values, { kind: 'volume', step: 1 })).toEqual({ kind: 'volume', level: 31 });
  expect(stepControl({ ...values, volume: 31 }, { kind: 'volume', step: 1 })).toBeNull();
  expect(stepControl(values, { kind: 'treble', step: 1 })).toEqual({ kind: 'eq', bass: 5, treble: 10 });
  expect(stepControl({ ...values, treble: 10 }, { kind: 'treble', step: 1 })).toBeNull();
  expect(stepControl(values, { kind: 'bass', step: -1 })).toEqual({ kind: 'eq', bass: 4, treble: 9 });
});

test('the volume scale ends at the speaker maximum, or the measured one before it is read', () => {
  expect(stepControl({ ...values, volume: 40, maxVolume: 50 }, { kind: 'volume', step: 1 })).toEqual({
    kind: 'volume',
    level: 41,
  });
  expect(stepControl({ ...values, maxVolume: null, volume: 31 }, { kind: 'volume', step: 1 })).toBeNull();
});

test('flat resets both bands, and does nothing when already flat', () => {
  expect(stepControl(values, { kind: 'flat' })).toEqual({ kind: 'eq', bass: 5, treble: 5 });
  expect(stepControl({ ...values, treble: 5 }, { kind: 'flat' })).toBeNull();
});

test('nothing steps from a value the speaker has not reported', () => {
  expect(stepControl({ ...values, volume: null }, { kind: 'volume', step: -1 })).toBeNull();
  // An EQ write carries both bands, so both must be known.
  expect(stepControl({ ...values, bass: null }, { kind: 'treble', step: 1 })).toBeNull();
  expect(stepControl({ ...values, treble: null }, { kind: 'flat' })).toBeNull();
});

test('a change applies to the values a surface shows, keeping every other field', () => {
  const payload = { name: 'ACTON III', ...values };
  expect(applyChange(payload, { kind: 'volume', level: 12 })).toEqual({ ...payload, volume: 12 });
  expect(applyChange(payload, { kind: 'eq', bass: 5, treble: 5 })).toEqual({ ...payload, treble: 5 });
});

test('values read the way every surface labels them', () => {
  expect(describeVolume(values)).toBe('30 of 31');
  expect(describeVolume({ ...values, volume: null })).toBe('—');
  expect([0, 5, 8, null].map(offsetFromFlat)).toEqual(['-5', '0', '+3', '—']);
});
