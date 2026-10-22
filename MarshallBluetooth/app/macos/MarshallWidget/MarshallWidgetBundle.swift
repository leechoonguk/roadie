import SwiftUI
import WidgetKit

/// The extension's entry point, in a file of its own so the widget's views
/// compile into `make widget-snapshots` too, which has an entry point of its own.
@main
struct MarshallWidgetBundle: WidgetBundle {
  var body: some Widget {
    MarshallStatusWidget()
  }
}
