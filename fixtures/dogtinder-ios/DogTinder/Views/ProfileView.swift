import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    let dog: Dog

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    DogArtView(dog: dog)
                    Text(dog.nameAndAge)
                        .font(.title.bold())
                    Text(dog.breed)
                        .font(.body)
                    Text(dog.distanceText)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(dog.bio)
                        .font(.body)
                        .padding(.top, 8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }

            HStack(spacing: 24) {
                Button("Nope") {
                    appState.nope()
                    dismiss()
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("nope-button")

                Button("Like") {
                    let matched = appState.like(dog)
                    dismiss()
                    if matched {
                        // Present the alert once the pop back to Discover has started.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                            appState.pendingMatch = dog
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("like-button")
            }
            .padding()
        }
        .navigationTitle(dog.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
