import SwiftUI
import WidgetKit

/// Timeline entry: the snapshot to draw, and whether it is the built-in sample.
struct MarshallEntry: TimelineEntry {
  let date: Date
  let snapshot: DeviceSnapshot
  let isSample: Bool
}

/// Reads the snapshot the app published; falls back to the sample until there is one.
///
/// The app calls `WidgetCenter.reloadAllTimelines()` after every publish, so the
/// timeline holds one entry and never schedules its own refresh.
struct MarshallProvider: TimelineProvider {
  func placeholder(in context: Context) -> MarshallEntry {
    MarshallEntry(date: Date(), snapshot: .sample, isSample: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (MarshallEntry) -> Void) {
    completion(currentEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<MarshallEntry>) -> Void) {
    completion(Timeline(entries: [currentEntry()], policy: .never))
  }

  private func currentEntry() -> MarshallEntry {
    if let store = SharedStore(), let snapshot = SnapshotStore.load(from: store) {
      return MarshallEntry(date: Date(), snapshot: snapshot, isSample: false)
    }
    return MarshallEntry(date: Date(), snapshot: .sample, isSample: true)
  }
}

/// Glanceable, adjustable speaker state.
///
/// Small: the volume with −/+. Medium: volume beside the two tone bands.
/// Large: every control with its own buttons and a Flat reset. Buttons run
/// `StepControlIntent`, which hands the change to the menu bar app on macOS,
/// and on iOS connects to the speaker for that one press (`WidgetPress`).
///
/// One control language throughout: a round 28pt button either side of the
/// thing it moves, the value between them, a bar underneath. Colour never
/// carries meaning on its own — on the macOS desktop a widget is drawn
/// `vibrant` or `accented` whenever its space is not focused — so values use
/// hierarchical styles and `widgetAccentable` instead of fixed tints.
struct MarshallWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: MarshallEntry

  private var snapshot: DeviceSnapshot { entry.snapshot }
  /// The sample is read-only. On macOS a press goes through the menu bar app's
  /// connection, so it needs one; on iOS a press connects for itself.
  private var adjustable: Bool {
    #if os(iOS)
      !entry.isSample
    #else
      snapshot.isConnected && !entry.isSample
    #endif
  }

  /// Whether `action` would change anything — the same rule the press itself applies.
  private func enabled(_ action: ControlAction) -> Bool {
    adjustable && action.change(from: snapshot.controls) != nil
  }

  var body: some View {
    Group {
      switch family {
      case .systemLarge:
        VStack(alignment: .leading, spacing: 16) {
          header
          volumeControl
          Divider()
          toneHeader
          toneRow("Bass", .bass, snapshot.bass)
          toneRow("Treble", .treble, snapshot.treble)
          Spacer(minLength: 0)
          footer
        }
      case .systemMedium:
        HStack(alignment: .top, spacing: 16) {
          VStack(alignment: .leading, spacing: 10) {
            header
            Spacer(minLength: 0)
            volumeControl
          }
          .frame(maxWidth: .infinity)
          Divider()
          VStack(alignment: .leading, spacing: 12) {
            toneRow("Bass", .bass, snapshot.bass, compact: true)
            toneRow("Treble", .treble, snapshot.treble, compact: true)
            Spacer(minLength: 0)
            footer
          }
          .frame(maxWidth: .infinity)
        }
      default:
        VStack(alignment: .leading, spacing: 8) {
          header
          Spacer(minLength: 0)
          volumeControl
          footer
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .opacity(adjustable || entry.isSample ? 1 : 0.6)
    .containerBackground(.fill.tertiary, for: .widget)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(summary)
  }

  // MARK: Pieces

  private var header: some View {
    HStack(alignment: .firstTextBaseline) {
      Label(snapshot.name, systemImage: "hifispeaker.fill")
        .font(.headline)
        .lineLimit(1)
        .widgetAccentable()
      Spacer()
      HStack(spacing: 4) {
        Circle()
          .fill(snapshot.isConnected ? Color.green : Color.secondary.opacity(0.4))
          .frame(width: 6, height: 6)
          .widgetAccentable()
        Text(snapshot.isConnected ? "Connected" : "Off")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
  }

  /// `[−]  14  [+]` with the bar underneath. The number sits exactly between the
  /// buttons so the eye reads value and controls as one object.
  private var volumeControl: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("VOLUME")
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
      HStack(spacing: 12) {
        stepButton(.volume, -1, "minus")
        if let level = snapshot.volume, let maximum = snapshot.maxVolume {
          HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text("\(level)")
              .font(.system(size: 34, weight: .light, design: .rounded))
              .monospacedDigit()
              .contentTransition(.numericText())
            Text("/ \(maximum)")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity)
        } else {
          Text("—")
            .font(.system(size: 34, weight: .light, design: .rounded))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
        }
        stepButton(.volume, 1, "plus")
      }
      levelBar(
        value: snapshot.volume.map(Double.init) ?? 0,
        top: Double(snapshot.maxVolume ?? 31),
        marker: nil,
        known: snapshot.volume != nil)
    }
  }

  private var toneHeader: some View {
    HStack {
      Text("TONE")
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
      Spacer()
      Button(intent: ResetToneIntent()) {
        Text("Flat")
          .font(.caption2.weight(.medium))
          .padding(.horizontal, 8)
          .frame(height: 20)
          .background(Capsule().fill(.fill.secondary))
      }
      .buttonStyle(.plain)
      .disabled(!enabled(.flat))
      .accessibilityLabel("Reset tone to flat")
    }
  }

  /// `Bass  −1` over `[−] ▬▬▬|▬▬ [+]`: buttons either side of a bar with a notch
  /// at flat. Compact tightens the spacing for the medium family.
  private func toneRow(
    _ title: String, _ control: WidgetControl, _ step: Int?, compact: Bool = false
  ) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(title)
          .font(.caption.weight(.medium))
        Text(step.map(Self.offsetFromFlat) ?? "—")
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
        Spacer()
      }
      HStack(spacing: compact ? 8 : 12) {
        stepButton(control, -1, "minus")
        levelBar(
          value: Double(step ?? EQScale.flat),
          top: Double(EQScale.steps.upperBound),
          marker: Double(EQScale.flat),
          known: step != nil)
        stepButton(control, 1, "plus")
      }
    }
  }

  /// A round button that steps one control. Plain style over a secondary fill
  /// stays legible in every rendering mode; the glyph takes the accent.
  private func stepButton(_ control: WidgetControl, _ step: Int, _ symbol: String) -> some View {
    Button(intent: StepControlIntent(control: control, step: step)) {
      Image(systemName: symbol)
        .font(.system(size: 12, weight: .bold))
        .frame(width: 28, height: 28)
        .background(Circle().fill(.fill.secondary))
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .widgetAccentable()
    .disabled(!enabled(control.action(step: step)))
    .accessibilityLabel("\(control.rawValue) \(step > 0 ? "up" : "down")")
  }

  /// A thin bar with an optional notch (the EQ's flat point).
  private func levelBar(value: Double, top: Double, marker: Double?, known: Bool) -> some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      ZStack(alignment: .leading) {
        Capsule().fill(.fill.secondary)
        Capsule()
          .fill(.tint)
          .frame(width: max(6, width * value / top))
          .widgetAccentable()
        if let marker {
          Rectangle()
            .fill(.primary.opacity(0.5))
            .frame(width: 2, height: 10)
            .offset(x: width * marker / top - 1, y: -2)
        }
      }
    }
    .frame(height: 6)
    .opacity(known ? 1 : 0.3)
  }

  /// Sample: an instruction. Real data: how old it is, which updates on its own.
  @ViewBuilder private var footer: some View {
    Group {
      if entry.isSample {
        Text("Open Roadie to choose a speaker")
      } else {
        Text("Updated \(Text(snapshot.updatedAt, style: .relative)) ago")
      }
    }
    .font(.caption2)
    .foregroundStyle(.tertiary)
    .lineLimit(1)
  }

  private var summary: String {
    var parts = [snapshot.name, snapshot.isConnected ? "connected" : "not connected"]
    if let level = snapshot.volume, let maximum = snapshot.maxVolume {
      parts.append("volume \(level) of \(maximum)")
    }
    if family != .systemSmall, let bass = snapshot.bass, let treble = snapshot.treble {
      parts.append("bass \(Self.offsetFromFlat(bass)), treble \(Self.offsetFromFlat(treble))")
    }
    return parts.joined(separator: ", ")
  }

  private static func offsetFromFlat(_ step: Int) -> String {
    let offset = step - EQScale.flat
    return offset > 0 ? "+\(offset)" : "\(offset)"
  }
}

struct MarshallStatusWidget: Widget {
  let kind = "MarshallStatusWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: MarshallProvider()) { entry in
      MarshallWidgetView(entry: entry)
    }
    .configurationDisplayName("Roadie")
    .description("Volume and EQ of your Marshall speaker, adjustable from the widget.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct MarshallWidgetBundle: WidgetBundle {
  var body: some Widget {
    MarshallStatusWidget()
  }
}
