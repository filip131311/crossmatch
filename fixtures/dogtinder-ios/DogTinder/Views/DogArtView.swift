import SwiftUI

/// Solid rounded rectangle in the dog's colour with a large dog emoji and the name.
struct DogArtView: View {
    let dog: Dog
    var small: Bool = false

    var body: some View {
        RoundedRectangle(cornerRadius: small ? 8 : 16)
            .fill(dog.color)
            .overlay {
                VStack(spacing: small ? 0 : 8) {
                    Text("🐶")
                        .font(.system(size: small ? 24 : 96))
                    if !small {
                        Text(dog.name)
                            .font(.title2.bold())
                            .foregroundStyle(.white)
                    }
                }
            }
            .frame(width: small ? 48 : nil, height: small ? 48 : 280)
            .frame(maxWidth: small ? 48 : .infinity)
    }
}
