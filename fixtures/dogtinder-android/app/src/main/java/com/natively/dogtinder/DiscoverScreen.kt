package com.natively.dogtinder

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiscoverScreen(vm: AppViewModel, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxSize()) {
        TopAppBar(title = { Text("Discover") })
        val dog = vm.currentDog
        if (dog == null) {
            Column(
                modifier = Modifier.fillMaxSize().padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("No more dogs nearby", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = { vm.startOver() },
                    modifier = Modifier.testTag("start-over-button"),
                ) { Text("Start over") }
            }
        } else {
            Column(
                modifier = Modifier.fillMaxSize().padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                DogCard(
                    dog = dog,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .testTag("dog-card")
                        .clickable { vm.profileDogId = dog.id },
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(
                        onClick = { vm.nope() },
                        modifier = Modifier.testTag("nope-button"),
                    ) { Text("Nope") }
                    // D1: Android-only Super Like button, behaves like Like.
                    OutlinedButton(
                        onClick = { vm.like() },
                        modifier = Modifier.testTag("super-like-button"),
                    ) { Text("Super Like") }
                    Button(
                        onClick = { vm.like() },
                        modifier = Modifier.testTag("like-button"),
                    ) { Text("Like") }
                }
            }
        }
    }
}

@Composable
fun DogCard(dog: Dog, modifier: Modifier = Modifier) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
            DogArt(dog, modifier = Modifier.fillMaxSize())
        }
        Spacer(Modifier.height(12.dp))
        Text("${dog.name}, ${dog.age}", style = MaterialTheme.typography.headlineSmall)
        Text(dog.breed, style = MaterialTheme.typography.bodyLarge)
        Text("${dog.distanceKm} km away", style = MaterialTheme.typography.bodyMedium)
    }
}
