package com.natively.dogtinder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: AppViewModel, modifier: Modifier = Modifier) {
    // D5: local to this composable, so it resets to off every time the Settings tab is shown.
    var notifications by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxSize()) {
        TopAppBar(title = { Text("Settings") })
        Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
            // Max distance
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Max distance", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                // D3: Android shows miles.
                Text("${vm.maxDistance} mi", modifier = Modifier.testTag("distance-value"))
                Spacer(Modifier.width(12.dp))
                OutlinedButton(
                    onClick = { vm.decrementDistance() },
                    modifier = Modifier
                        .testTag("distance-minus")
                        .semantics { contentDescription = "Decrease max distance" },
                ) { Text("-") }
                Spacer(Modifier.width(8.dp))
                OutlinedButton(
                    onClick = { vm.incrementDistance() },
                    modifier = Modifier
                        .testTag("distance-plus")
                        .semantics { contentDescription = "Increase max distance" },
                ) { Text("+") }
            }
            Spacer(Modifier.height(16.dp))

            // Notifications
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Notifications", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Switch(
                    checked = notifications,
                    onCheckedChange = { notifications = it },
                    modifier = Modifier.testTag("notifications-toggle"),
                )
            }
            Spacer(Modifier.height(16.dp))

            // Show me
            Text("Show me", style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(8.dp))
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                ShowMe.entries.forEachIndexed { index, option ->
                    SegmentedButton(
                        selected = vm.showMe == option,
                        onClick = { vm.showMe = option },
                        shape = SegmentedButtonDefaults.itemShape(index = index, count = ShowMe.entries.size),
                        modifier = Modifier.testTag(option.id),
                    ) { Text(option.label) }
                }
            }
            Spacer(Modifier.height(24.dp))

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                Button(
                    onClick = { vm.resetSwipes() },
                    modifier = Modifier.testTag("reset-swipes-button"),
                ) { Text("Reset swipes") }
            }
        }
    }
}
