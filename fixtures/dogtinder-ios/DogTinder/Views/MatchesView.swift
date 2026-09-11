import SwiftUI

struct MatchesView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            Group {
                if appState.matches.isEmpty {
                    Text("No matches yet. Keep swiping!")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(appState.matches) { dog in
                        NavigationLink(value: dog) {
                            HStack(spacing: 12) {
                                DogArtView(dog: dog, small: true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(dog.name)
                                        .font(.headline)
                                    Text(dog.breed)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .accessibilityIdentifier("match-row-\(dog.id)")
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Matches")
            .navigationDestination(for: Dog.self) { dog in
                ChatView(dog: dog)
            }
        }
    }
}
