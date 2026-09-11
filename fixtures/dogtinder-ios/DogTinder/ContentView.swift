import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        TabView(selection: $appState.selectedTab) {
            DiscoverView()
                .tabItem {
                    Label("Discover", systemImage: "flame")
                        .accessibilityIdentifier("tab-discover")
                }
                .tag(AppTab.discover)

            MatchesView()
                .tabItem {
                    Label("Matches", systemImage: "heart")
                        .accessibilityIdentifier("tab-matches")
                }
                .tag(AppTab.matches)

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                        .accessibilityIdentifier("tab-settings")
                }
                .tag(AppTab.settings)
        }
        .alert(
            "It's a match!",
            isPresented: Binding(
                get: { appState.pendingMatch != nil },
                set: { if !$0 { appState.pendingMatch = nil } }
            ),
            presenting: appState.pendingMatch
        ) { _ in
            Button("Keep swiping") {}
            Button("Say hi") {
                appState.selectedTab = .matches
            }
        } message: { dog in
            Text("You and \(dog.name) liked each other.")
        }
    }
}
