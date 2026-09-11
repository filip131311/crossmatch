package com.natively.dogtinder

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                DogTinderApp()
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun DogTinderApp(vm: AppViewModel = viewModel()) {
    val pushedInCurrentTab = when (vm.currentTab) {
        Tab.Discover -> vm.profileDogId != null
        Tab.Matches -> vm.chatDogId != null
        Tab.Settings -> false
    }
    // System back pops the pushed screen of the current tab.
    BackHandler(enabled = pushedInCurrentTab) {
        when (vm.currentTab) {
            Tab.Discover -> vm.profileDogId = null
            Tab.Matches -> vm.chatDogId = null
            Tab.Settings -> Unit
        }
    }

    Scaffold(
        modifier = Modifier.semantics { testTagsAsResourceId = true },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { tab ->
                    NavigationBarItem(
                        modifier = Modifier.testTag(tab.id),
                        selected = vm.currentTab == tab,
                        onClick = { vm.currentTab = tab },
                        icon = {
                            Icon(
                                imageVector = when (tab) {
                                    Tab.Discover -> Icons.Filled.Search
                                    Tab.Matches -> Icons.Filled.Favorite
                                    Tab.Settings -> Icons.Filled.Settings
                                },
                                contentDescription = null,
                            )
                        },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        val contentModifier = Modifier.padding(innerPadding)
        when (vm.currentTab) {
            Tab.Discover -> {
                val profileId = vm.profileDogId
                if (profileId == null) {
                    DiscoverScreen(vm, contentModifier)
                } else {
                    ProfileScreen(
                        dog = dogById(profileId),
                        onBack = { vm.profileDogId = null },
                        onNope = { vm.nope(); vm.profileDogId = null },
                        onLike = { vm.like(); vm.profileDogId = null },
                        modifier = contentModifier,
                    )
                }
            }
            Tab.Matches -> {
                val chatId = vm.chatDogId
                if (chatId == null) {
                    MatchesScreen(vm, contentModifier)
                } else {
                    ChatScreen(
                        dog = dogById(chatId),
                        messages = vm.chats[chatId] ?: emptyList(),
                        onSend = { vm.sendMessage(chatId, it) },
                        onBack = { vm.chatDogId = null },
                        modifier = contentModifier,
                    )
                }
            }
            Tab.Settings -> SettingsScreen(vm, contentModifier)
        }
    }
}
