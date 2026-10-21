import Foundation

/// The speaker's volume scale, defined once for the Bluetooth codec and the widgets.
enum VolumeScale {
  /// An ACTON III's measured maximum, used until the speaker reports its own.
  static let fallbackMaximum = 31
}

/// Volume and tone. In one report a nil field was not part of it; as a
/// speaker's known values, a nil field has not been read yet.
struct ControlState: Equatable {
  var volume: Int?
  var maxVolume: Int?
  var bass: Int?
  var treble: Int?

  /// The fields `report` carries replace these; the rest stay.
  func merging(_ report: ControlState) -> ControlState {
    ControlState(
      volume: report.volume ?? volume,
      maxVolume: report.maxVolume ?? maxVolume,
      bass: report.bass ?? bass,
      treble: report.treble ?? treble)
  }

  /// The values once `change` is stored — what a widget shows until the speaker answers.
  func applying(_ change: ControlChange) -> ControlState {
    var next = self
    switch change {
    case .volume(let level):
      next.volume = level
    case .eq(let bass, let treble):
      next.bass = bass
      next.treble = treble
    }
    return next
  }
}

/// A widget button press: one step of one setting, or both tone bands back to
/// flat. The JavaScript surfaces (tray, Android widget) use the same model,
/// `ControlAction` in `app/src/controls.ts`, and the same rules below.
enum ControlAction: Equatable {
  case volume(step: Int)
  case bass(step: Int)
  case treble(step: Int)
  case flat

  /// The change this press makes to `values`, or nil when it cannot or would
  /// change nothing. A step moves from the speaker's last reported value and
  /// does nothing until that value has been read: stepping from a guess writes
  /// the guess, and volume 0 on a speaker not yet read is silence.
  func change(from values: ControlState) -> ControlChange? {
    if case .volume(let step) = self {
      guard let volume = values.volume else { return nil }
      let level = Self.clamp(volume + step, 0...(values.maxVolume ?? VolumeScale.fallbackMaximum))
      return level == volume ? nil : .volume(level)
    }
    // An EQ write carries both bands, so both must be known.
    guard let bass = values.bass, let treble = values.treble else { return nil }
    let next: (bass: Int, treble: Int)
    switch self {
    case .bass(let step): next = (Self.clamp(bass + step, EQScale.steps), treble)
    case .treble(let step): next = (bass, Self.clamp(treble + step, EQScale.steps))
    default: next = (EQScale.flat, EQScale.flat)
    }
    return next.bass == bass && next.treble == treble ? nil : .eq(bass: next.bass, treble: next.treble)
  }

  /// Whether `report` carries the setting this press moves — how a press knows
  /// the value it steps from has arrived, and later that its write was read back.
  func isAnswered(by report: ControlState) -> Bool {
    if case .volume = self { return report.volume != nil }
    return report.bass != nil && report.treble != nil
  }

  private static func clamp(_ value: Int, _ range: ClosedRange<Int>) -> Int {
    min(max(value, range.lowerBound), range.upperBound)
  }
}

/// What a press writes. An EQ write always carries both bands.
enum ControlChange: Codable, Equatable {
  case volume(Int)
  case eq(bass: Int, treble: Int)

  /// Rapid presses queue several changes; only the last of each kind reaches
  /// the speaker, so a burst costs one write per control.
  static func coalesced(_ changes: [ControlChange]) -> [ControlChange] {
    let volume = changes.last { change in
      if case .volume = change { return true }
      return false
    }
    let eq = changes.last { change in
      if case .eq = change { return true }
      return false
    }
    return [volume, eq].compactMap { $0 }
  }
}

extension DeviceSnapshot {
  var controls: ControlState {
    ControlState(volume: volume, maxVolume: maxVolume, bass: bass, treble: treble)
  }

  /// This snapshot with `controls` replacing its control fields.
  func with(_ controls: ControlState) -> DeviceSnapshot {
    var next = self
    next.volume = controls.volume
    next.maxVolume = controls.maxVolume
    next.bass = controls.bass
    next.treble = controls.treble
    return next
  }
}
