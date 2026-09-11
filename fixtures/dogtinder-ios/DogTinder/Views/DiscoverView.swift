import SwiftUI

struct DiscoverView: View {
    @EnvironmentObject private var appState: AppState
    @State private var path: [Dog] = []

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 24) {
                if let dog = appState.currentDog {
                    Button {
                        path.append(dog)
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            DogArtView(dog: dog)
                            Text(dog.nameAndAge)
                                .font(.title.bold())
                            Text(dog.breed)
                                .font(.body)
                            Text(dog.distanceText)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("dog-card")

                    HStack(spacing: 24) {
                        Button("Nope") {
                            appState.nope()
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("nope-button")

                        Button("Like") {
                            if appState.like(dog) {
                                appState.pendingMatch = dog
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("like-button")
                    }
                } else {
                    Spacer()
                    Text("No more dogs nearby")
                        .font(.title2)
                    Button("Start over") {
                        appState.startOver()
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("start-over-button")
                    Spacer()
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .navigationTitle("Discover")
            .navigationDestination(for: Dog.self) { dog in
                ProfileView(dog: dog)
            }
        }
    }
}
