import SwiftUI

struct ChatView: View {
    @EnvironmentObject private var appState: AppState
    @State private var draft: String = ""

    let dog: Dog

    private var isDraftEmpty: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .trailing, spacing: 8) {
                    ForEach(Array(appState.messages(for: dog).enumerated()), id: \.offset) { _, message in
                        Text(message)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color.accentColor)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .accessibilityIdentifier("message-bubble")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding()
            }

            Divider()

            HStack(spacing: 12) {
                TextField("Message", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("chat-input")

                Button("Send") {
                    appState.send(draft, to: dog)
                    draft = ""
                }
                .buttonStyle(.borderedProminent)
                .disabled(isDraftEmpty)
                .accessibilityIdentifier("send-button")
            }
            .padding()
        }
        .navigationTitle(dog.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
