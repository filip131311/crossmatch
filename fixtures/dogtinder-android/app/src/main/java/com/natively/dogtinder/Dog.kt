package com.natively.dogtinder

import androidx.compose.ui.graphics.Color

data class Dog(
    val id: String,
    val name: String,
    val age: Int,
    val breed: String,
    val distanceKm: Int,
    val bio: String,
    val mutualMatch: Boolean,
    val color: Color,
)

val dogs: List<Dog> = listOf(
    Dog("biscuit", "Biscuit", 3, "Corgi", 2, "Loves belly rubs and long naps in the sun.", true, Color(0xFFF4A261)),
    Dog("rex", "Rex", 5, "German Shepherd", 4, "Serious about fetch. Not serious about anything else.", false, Color(0xFF264653)),
    Dog("mochi", "Mochi", 1, "Shiba Inu", 1, "Small, fluffy, judging you.", false, Color(0xFFE9C46A)),
    Dog("luna", "Luna", 4, "Husky", 7, "Will sing you the song of her people.", true, Color(0xFF2A9D8F)),
    Dog("bruno", "Bruno", 6, "Boxer", 3, "Gentle giant with a drool problem.", false, Color(0xFF8D5B4C)),
    Dog("pepper", "Pepper", 2, "Dalmatian", 5, "Spots on the outside, chaos on the inside.", false, Color(0xFF6D6875)),
)

fun dogById(id: String): Dog = dogs.first { it.id == id }
