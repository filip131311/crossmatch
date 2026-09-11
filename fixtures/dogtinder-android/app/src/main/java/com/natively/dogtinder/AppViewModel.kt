package com.natively.dogtinder

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel

enum class Tab(val id: String, val label: String) {
    Discover("tab-discover", "Discover"),
    Matches("tab-matches", "Matches"),
    Settings("tab-settings", "Settings"),
}

enum class ShowMe(val id: String, val label: String) {
    Puppies("show-me-puppies", "Puppies"),
    Adults("show-me-adults", "Adults"),
    All("show-me-all", "All"),
}

/** Single app-wide state holder so deck index, matches and chats persist across tabs. */
class AppViewModel : ViewModel() {
    var currentTab by mutableStateOf(Tab.Discover)

    // Per-tab pushed screens (like a navigation stack inside each tab).
    var profileDogId by mutableStateOf<String?>(null)
    var chatDogId by mutableStateOf<String?>(null)

    var deckIndex by mutableStateOf(0)
        private set

    val matches = mutableStateListOf<String>()
    val chats = mutableStateMapOf<String, List<String>>()

    var maxDistance by mutableStateOf(10)
        private set
    var showMe by mutableStateOf(ShowMe.All)

    val currentDog: Dog? get() = dogs.getOrNull(deckIndex)

    fun nope() {
        advance()
    }

    fun like() {
        currentDog?.let { dog ->
            if (dog.mutualMatch && dog.id !in matches) matches.add(dog.id)
        }
        advance()
    }

    private fun advance() {
        if (deckIndex < dogs.size) deckIndex += 1
    }

    fun startOver() {
        deckIndex = 0
    }

    fun resetSwipes() {
        deckIndex = 0
        matches.clear()
        chats.clear()
    }

    fun sendMessage(dogId: String, text: String) {
        chats[dogId] = (chats[dogId] ?: emptyList()) + text
    }

    fun decrementDistance() {
        if (maxDistance > 1) maxDistance -= 1
    }

    fun incrementDistance() {
        if (maxDistance < 50) maxDistance += 1
    }
}
