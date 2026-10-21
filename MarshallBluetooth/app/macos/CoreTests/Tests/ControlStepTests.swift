import Foundation
import Testing

@testable import MarshallCore

// The same cases as `app/__tests__/controls.test.ts`: one press model, two languages.

private let values = ControlState(volume: 30, maxVolume: 31, bass: 5, treble: 9)

@Test func aStepMovesFromTheReadingAndAStepPastAnEndChangesNothing() {
  #expect(ControlAction.volume(step: 1).change(from: values) == .volume(31))
  #expect(ControlAction.volume(step: 1).change(from: ControlState(volume: 31, maxVolume: 31)) == nil)
  #expect(ControlAction.treble(step: 1).change(from: values) == .eq(bass: 5, treble: 10))
  #expect(ControlAction.bass(step: -1).change(from: values) == .eq(bass: 4, treble: 9))
}

@Test func theVolumeScaleEndsAtTheSpeakerMaximumOrTheMeasuredOne() {
  #expect(ControlAction.volume(step: 1).change(from: ControlState(volume: 40, maxVolume: 50)) == .volume(41))
  #expect(ControlAction.volume(step: 1).change(from: ControlState(volume: 31)) == nil)
}

@Test func flatResetsBothBandsAndDoesNothingWhenAlreadyFlat() {
  #expect(ControlAction.flat.change(from: values) == .eq(bass: 5, treble: 5))
  #expect(ControlAction.flat.change(from: ControlState(bass: 5, treble: 5)) == nil)
}

@Test func nothingStepsFromAValueTheSpeakerHasNotReported() {
  #expect(ControlAction.volume(step: -1).change(from: ControlState(bass: 5, treble: 5)) == nil)
  #expect(ControlAction.treble(step: 1).change(from: ControlState(volume: 3, treble: 5)) == nil)
}

@Test func aBurstOfChangesCostsOneWritePerControl() {
  let burst: [ControlChange] = [.volume(12), .eq(bass: 6, treble: 5), .volume(13), .eq(bass: 7, treble: 5)]
  #expect(ControlChange.coalesced(burst) == [.volume(13), .eq(bass: 7, treble: 5)])
  #expect(ControlChange.coalesced([]) == [])
}

@Test func aSnapshotTakesTheValuesAPressStored() {
  let stored = DeviceSnapshot.sample.with(
    DeviceSnapshot.sample.controls.merging(ControlState(volume: 20)))
  #expect(stored.volume == 20)
  #expect(stored.bass == DeviceSnapshot.sample.bass)
  #expect(stored.name == DeviceSnapshot.sample.name)
}

@Test func aPressWaitsForItsValueStepsFromTheSpeakerAndFinishesOnTheReadBack() {
  var plan = OneShotPlan(action: .volume(step: 1))
  // The maximum arrives first: not the value the press moves.
  #expect(plan.receive(ControlState(maxVolume: 31)) == .wait)
  // The snapshot said 12; the speaker says 25 — the knob moved.
  #expect(plan.receive(ControlState(volume: 25)) == .write(.volume(26)))
  #expect(plan.receive(ControlState(bass: 5, treble: 5)) == .wait)
  #expect(plan.receive(ControlState(volume: 26)) == .finish)
  #expect(plan.values == ControlState(volume: 26, maxVolume: 31, bass: 5, treble: 5))
}

@Test func aPressThatWouldChangeNothingFinishesWithoutWriting() {
  var plan = OneShotPlan(action: .flat)
  #expect(plan.receive(ControlState(bass: 5, treble: 5)) == .finish)
}
