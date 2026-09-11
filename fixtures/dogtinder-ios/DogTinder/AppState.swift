import SwiftUI

enum ShowMe: String, CaseIterable {
    case puppies = "Puppies"
    case adults = "Adults"
    case all = "All"
}

enum AppTab: Hashable {
    case discover
    case matches
    case settings
}

final class AppState: ObservableObject {
    // Deck
    @Published var deckIndex: Int = 0
    // Matches, in the order they were matched
    @Published var matches: [Dog] = []
    // Chat messages per dog id
    @Published var chats: [String: [String]] = [:]
    // Settings
    @Published var maxDistance: Int = 10
    @Published var notificationsEnabled: Bool = false
    @Published var showMe: ShowMe = .all
    // Tab selection (so "Say hi" can switch tabs)
    @Published var selectedTab: AppTab = .discover
    // Pending "It's a match!" alert
    @Published var pendingMatch: Dog? = nil

    static let minDistance = 1
    static let maxDistanceLimit = 50

    var currentDog: Dog? {
        deckIndex < Dog.all.count ? Dog.all[deckIndex] : nil
    }

    func nope() {
        advance()
    }

    /// Advances the deck. Returns true if the dog was a mutual match (added to Matches).
    @discardableResult
    func like(_ dog: Dog) -> Bool {
        advance()
        guard dog.mutualMatch else { return false }
        if !matches.contains(where: { $0.id == dog.id }) {
            matches.append(dog)
        }
        return true
    }

    func startOver() {
        deckIndex = 0
    }

    func resetSwipes() {
        deckIndex = 0
        matches = []
        chats = [:]
    }

    func messages(for dog: Dog) -> [String] {
        chats[dog.id] ?? []
    }

    func send(_ text: String, to dog: Dog) {
        chats[dog.id, default: []].append(text)
    }

    func decrementDistance() {
        if maxDistance > AppState.minDistance { maxDistance -= 1 }
    }

    func incrementDistance() {
        if maxDistance < AppState.maxDistanceLimit { maxDistance += 1 }
    }

    private func advance() {
        if deckIndex < Dog.all.count { deckIndex += 1 }
    }
}
