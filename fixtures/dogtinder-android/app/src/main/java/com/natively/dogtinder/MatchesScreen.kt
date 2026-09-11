package com.natively.dogtinder

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MatchesScreen(vm: AppViewModel, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxSize()) {
        TopAppBar(title = { Text("Matches") })
        if (vm.matches.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
                Text("No matches yet. Keep swiping!", style = MaterialTheme.typography.bodyLarge)
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(vm.matches, key = { it }) { id ->
                    val dog = dogById(id)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("match-row-${dog.id}")
                            .clickable { vm.chatDogId = dog.id }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        DogArt(
                            dog,
                            modifier = Modifier.size(56.dp),
                            cornerRadius = 12.dp,
                            emojiSize = 28,
                            showName = false,
                        )
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text(dog.name, style = MaterialTheme.typography.titleMedium)
                            Text(dog.breed, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
    }
}
