import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
  TextInput,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { useConfig } from "@/lib/config-context";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { Fonts } from "@/constants/theme";

interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
}

export default function WorkspacesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { apiUrl, isLoading: configLoading } = useConfig();
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const fetchWorkspaces = useCallback(async () => {
    if (!apiUrl) return;
    setLoading(true);
    try {
      const data = await api.listDirectory();
      setEntries(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch workspaces:", err);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useFocusEffect(
    useCallback(() => {
      fetchWorkspaces();
    }, [fetchWorkspaces])
  );

  const createWorkspace = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.mkdir(name);
      setNewName("");
      setCreating(false);
      fetchWorkspaces();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to create workspace");
    }
  };

  const deleteWorkspace = (name: string) => {
    Alert.alert("Delete Workspace", `Delete "${name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.rmdir(name);
            fetchWorkspaces();
          } catch (err: any) {
            Alert.alert("Error", err.message || "Failed to delete");
          }
        },
      },
    ]);
  };

  if (configLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.void }]}>
        <ActivityIndicator color={theme.fg} />
      </View>
    );
  }

  if (!apiUrl) {
    return (
      <View style={[styles.center, { backgroundColor: theme.void }]}>
        <Text style={[styles.heading, { color: theme.fg }]}>AEBCLAWD</Text>
        <Text style={[styles.subtitle, { color: theme.fg3 }]}>
          Configure your server URL in Settings to get started.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.void }]}>
      <View style={styles.header}>
        <Text style={[styles.heading, { color: theme.fg }]}>WORKSPACES</Text>
        <Pressable
          style={[styles.primaryButton, { backgroundColor: theme.fg }]}
          onPress={() => setCreating(true)}
        >
          <Text style={[styles.primaryButtonText, { color: theme.void }]}>
            NEW
          </Text>
        </Pressable>
      </View>

      {creating && (
        <View style={[styles.createRow, { borderColor: theme.edge }]}>
          <TextInput
            style={[
              styles.createInput,
              {
                color: theme.fg,
                borderColor: theme.edge,
                fontFamily: Fonts?.mono,
              },
            ]}
            value={newName}
            onChangeText={setNewName}
            placeholder="Folder name"
            placeholderTextColor={theme.fg3}
            autoFocus
            onSubmitEditing={createWorkspace}
          />
          <Pressable
            style={[styles.primaryButton, { backgroundColor: theme.fg }]}
            onPress={createWorkspace}
          >
            <Text style={[styles.primaryButtonText, { color: theme.void }]}>
              CREATE
            </Text>
          </Pressable>
          <Pressable onPress={() => setCreating(false)}>
            <Text style={[styles.cancelText, { color: theme.fg3 }]}>
              CANCEL
            </Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.fg} />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: theme.fg3 }]}>
            No workspaces yet. Create one to get started.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.name}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, { borderBottomColor: theme.edge }]}
              onPress={() =>
                router.push({
                  pathname: "/browse",
                  params: { path: item.name },
                })
              }
              onLongPress={() => deleteWorkspace(item.name)}
            >
              <View style={styles.rowContent}>
                <Text style={[styles.rowName, { color: theme.fg }]}>
                  {item.name}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/sessions",
                    params: { dir: item.name },
                  })
                }
                style={[
                  styles.outlineButton,
                  { borderColor: theme.edge },
                ]}
              >
                <Text style={[styles.outlineButtonText, { color: theme.fg }]}>
                  SESSIONS
                </Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  heading: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 20,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  createInput: {
    flex: 1,
    borderWidth: 2,
    padding: 10,
    fontSize: 13,
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryButtonText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },
  outlineButton: {
    borderWidth: 2,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  outlineButtonText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  cancelText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowContent: { flex: 1 },
  rowName: {
    fontSize: 15,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
  },
});
