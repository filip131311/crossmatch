import SwiftUI

struct Dog: Identifiable, Hashable {
    let id: String
    let name: String
    let age: Int
    let breed: String
    let distanceKm: Int
    let bio: String
    let mutualMatch: Bool
    let colorHex: UInt32

    var color: Color {
        Color(
            red: Double((colorHex >> 16) & 0xFF) / 255.0,
            green: Double((colorHex >> 8) & 0xFF) / 255.0,
            blue: Double(colorHex & 0xFF) / 255.0
        )
    }

    var nameAndAge: String { "\(name), \(age)" }
    var distanceText: String { "\(distanceKm) km away" }

    static let all: [Dog] = [
        Dog(id: "biscuit", name: "Biscuit", age: 3, breed: "Corgi", distanceKm: 2,
            bio: "Loves belly rubs and long naps in the sun.", mutualMatch: true, colorHex: 0xF4A261),
        Dog(id: "rex", name: "Rex", age: 5, breed: "German Shepherd", distanceKm: 4,
            bio: "Serious about fetch. Not serious about anything else.", mutualMatch: false, colorHex: 0x264653),
        Dog(id: "mochi", name: "Mochi", age: 1, breed: "Shiba Inu", distanceKm: 1,
            bio: "Small, fluffy, judging you.", mutualMatch: false, colorHex: 0xE9C46A),
        Dog(id: "luna", name: "Luna", age: 4, breed: "Husky", distanceKm: 7,
            bio: "Will sing you the song of her people.", mutualMatch: true, colorHex: 0x2A9D8F),
        Dog(id: "bruno", name: "Bruno", age: 6, breed: "Boxer", distanceKm: 3,
            bio: "Gentle giant with a drool problem.", mutualMatch: false, colorHex: 0x8D5B4C),
        Dog(id: "pepper", name: "Pepper", age: 2, breed: "Dalmatian", distanceKm: 5,
            bio: "Spots on the outside, chaos on the inside.", mutualMatch: false, colorHex: 0x6D6875),
    ]
}
