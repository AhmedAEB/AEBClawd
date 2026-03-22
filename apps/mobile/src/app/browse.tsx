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
import {
  useLocalSearchParams,
  useRouter,
  useFocusEffect,
  Stack,
} from "expo-router";

import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { Fonts } from "@/constants/theme";

interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
}

export default function BrowseScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { path } = useLocalSearchParams<{ path: string }>();
  const currentPath = path || "";

  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const segments = currentPath.split("/").filter(Boolean);
  const dirName = segments[segments.length - 1] || "Root";

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listDirectory(currentPath);
      setEntries(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch entries:", err);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useFocusEffect(
    useCallback(() => {
      fetchEntries();
    }, [fetchEntries])
  );

  const createFolder = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.mkdir(`${currentPath}/${name}`);
      setNewName("");
      setCreating(false);
      fetchEntries();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to create folder");
    }
  };

  const deleteFolder = (name: string) => {
    Alert.alert("Delete", `Delete "${name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.rmdir(`${currentPath}/${name}`);
            fetchEntries();
          } catch (err: any) {
            Alert.alert("Error", err.message || "Failed to delete");
          }
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: dirName }} />
      <View style={[styles.container, { backgroundColor: theme.void }]}>
        {/* Breadcrumb */}
        <View style={[styles.breadcrumb, { borderBottomColor: theme.edge }]}>
          <Pressable onPress={() => router.back()}>
            <Text
              style={[
                styles.breadcrumbText,
                { color: theme.fg3, fontFamily: Fonts?.mono },
              ]}
            >
              {segments.map((s, i) => (i === 0 ? s : ` / ${s}`)).join("")}
            </Text>
          </Pressable>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: theme.fg }]}
            onPress={() => setCreating(true)}
          >
            <Text style={[styles.primaryButtonText, { color: theme.void }]}>
              NEW FOLDER
            </Text>
          </Pressable>
          <Pressable
            style={[styles.outlineButton, { borderColor: theme.edge }]}
            onPress={() =>
              router.push({
                pathname: "/sessions",
                params: { dir: currentPath },
              })
            }
          >
            <Text style={[styles.outlineButtonText, { color: theme.fg }]}>
              SESSIONS
            </Text>
          </Pressable>
        </View>

        {creating && (
          <View style={[styles.createRow, { borderBottomColor: theme.edge }]}>
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
              onSubmitEditing={createFolder}
            />
            <Pressable
              style={[styles.primaryButton, { backgroundColor: theme.fg }]}
              onPress={createFolder}
            >
              <Text style={[styles.primaryButtonText, { color: theme.void }]}>
                CREATE
              </Text>
            </Pressable>
            <Pressable onPress={() => setCreating(false)}>
              <Text style={{ color: theme.fg3, fontSize: 10, fontWeight: "700", letterSpacing: 1.5 }}>
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
            <Text style={{ color: theme.fg3, fontSize: 13 }}>
              No subdirectories
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
                    params: { path: `${currentPath}/${item.name}` },
                  })
                }
                onLongPress={() => deleteFolder(item.name)}
              >
                <Text style={[styles.rowName, { color: theme.fg }]}>
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  breadcrumb: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  breadcrumbText: { fontSize: 11 },
  actions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  primaryButtonText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  outlineButton: {
    borderWidth: 2,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  outlineButtonText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  createInput: {
    flex: 1,
    borderWidth: 2,
    padding: 8,
    fontSize: 13,
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: "600",
  },
});
