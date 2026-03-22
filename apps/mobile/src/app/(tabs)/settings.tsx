import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
} from "react-native";

import { useConfig } from "@/lib/config-context";
import { useTheme } from "@/hooks/use-theme";
import { Fonts } from "@/constants/theme";

export default function SettingsScreen() {
  const theme = useTheme();
  const { apiUrl, setApiUrl } = useConfig();
  const [urlInput, setUrlInput] = useState(apiUrl || "");
  const [testing, setTesting] = useState(false);

  const testAndSave = async () => {
    const url = urlInput.trim().replace(/\/+$/, "");
    if (!url) {
      Alert.alert("Error", "Please enter a server URL");
      return;
    }

    setTesting(true);
    try {
      const res = await fetch(`${url}/health`, { method: "GET" });
      const data = await res.json();
      if (data.status === "ok") {
        await setApiUrl(url);
        Alert.alert("Connected", "Successfully connected to server.");
      } else {
        Alert.alert("Error", "Server responded but health check failed.");
      }
    } catch (err: any) {
      Alert.alert(
        "Connection Failed",
        `${err?.message || "Unknown error"}\n\nTip: In the Simulator, use http://localhost:3001`
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.void }]}
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
    >
      <Text style={[styles.heading, { color: theme.fg }]}>SETTINGS</Text>

      <Text style={[styles.label, { color: theme.fg3 }]}>SERVER URL</Text>
      <TextInput
        style={[
          styles.input,
          {
            color: theme.fg,
            borderColor: theme.edge,
            backgroundColor: theme.void,
            fontFamily: Fonts?.mono,
          },
        ]}
        value={urlInput}
        onChangeText={setUrlInput}
        placeholder="http://192.168.1.x:3001"
        placeholderTextColor={theme.fg3}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={[styles.hint, { color: theme.fg3 }]}>
        Enter the URL of your AEBClawd server. Make sure your phone and server
        are on the same network.
      </Text>

      <Pressable
        style={[styles.button, { backgroundColor: theme.fg }]}
        onPress={testAndSave}
        disabled={testing}
      >
        {testing ? (
          <ActivityIndicator color={theme.void} size="small" />
        ) : (
          <Text style={[styles.buttonText, { color: theme.void }]}>
            TEST & SAVE
          </Text>
        )}
      </Pressable>

      {apiUrl && (
        <View style={[styles.statusBox, { borderColor: theme.edge }]}>
          <Text style={[styles.statusLabel, { color: theme.fg3 }]}>
            CURRENT SERVER
          </Text>
          <Text
            style={[
              styles.statusValue,
              { color: theme.fg, fontFamily: Fonts?.mono },
            ]}
          >
            {apiUrl}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingTop: 60 },
  heading: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 3,
    marginBottom: 32,
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 2,
    padding: 12,
    fontSize: 14,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    marginBottom: 24,
    lineHeight: 18,
  },
  button: {
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
  },
  statusBox: {
    borderWidth: 1,
    padding: 12,
    marginTop: 32,
  },
  statusLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  statusValue: {
    fontSize: 13,
  },
});
