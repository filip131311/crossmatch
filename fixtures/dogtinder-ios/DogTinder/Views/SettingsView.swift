import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            List {
                HStack {
                    Text("Max distance")
                    Spacer()
                    Text("\(appState.maxDistance) km")
                        .accessibilityIdentifier("distance-value")
                    Button {
                        appState.decrementDistance()
                    } label: {
                        Image(systemName: "minus")
                            .frame(width: 24, height: 24)
                    }
                    .buttonStyle(.bordered)
                    .disabled(appState.maxDistance <= AppState.minDistance)
                    .accessibilityLabel("Decrease")
                    .accessibilityIdentifier("distance-minus")
                    Button {
                        appState.incrementDistance()
                    } label: {
                        Image(systemName: "plus")
                            .frame(width: 24, height: 24)
                    }
                    .buttonStyle(.bordered)
                    .disabled(appState.maxDistance >= AppState.maxDistanceLimit)
                    .accessibilityLabel("Increase")
                    .accessibilityIdentifier("distance-plus")
                }

                Toggle("Notifications", isOn: $appState.notificationsEnabled)
                    .accessibilityIdentifier("notifications-toggle")

                HStack {
                    Text("Show me")
                    Spacer()
                    HStack(spacing: 0) {
                        segment(.puppies, id: "show-me-puppies")
                        segment(.adults, id: "show-me-adults")
                        segment(.all, id: "show-me-all")
                    }
                    .background(Color(.secondarySystemFill))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                Button("Reset swipes") {
                    appState.resetSwipes()
                }
                .accessibilityIdentifier("reset-swipes-button")
            }
            .navigationTitle("Settings")
        }
    }

    private func segment(_ option: ShowMe, id: String) -> some View {
        let selected = appState.showMe == option
        return Button {
            appState.showMe = option
        } label: {
            Text(option.rawValue)
                .font(.subheadline)
                .fontWeight(selected ? .semibold : .regular)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(selected ? Color(.systemBackground) : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .padding(2)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(id)
    }
}
