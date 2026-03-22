import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
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

interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
}

function timeAgo(ts: number): string {
  const age = Date.now() - ts;
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  return `${Math.floor(age / 86_400_000)}d`;
}

export default function SessionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { dir } = useLocalSearchParams<{ dir: string }>();
  const relativePath = dir || "";

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const segments = relativePath.split("/").filter(Boolean);
  const dirName = segments[segments.length - 1] || "Root";

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listSessions(relativePath);
      setSessions(data);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  }, [relativePath]);

  useFocusEffect(
    useCallback(() => {
      fetchSessions();
    }, [fetchSessions])
  );

  return (
    <>
      <Stack.Screen options={{ title: `${dirName} — Sessions` }} />
      <View style={[styles.container, { backgroundColor: theme.void }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.edge }]}>
          <Text style={[styles.heading, { color: theme.fg }]}>
            {dirName} — SESSIONS
          </Text>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: theme.fg }]}
            onPress={() =>
              router.push({
                pathname: "/chat/[sessionId]",
                params: { sessionId: "new", dir: relativePath },
              })
            }
          >
            <Text style={[styles.primaryButtonText, { color: theme.void }]}>
              NEW SESSION
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.fg} />
          </View>
        ) : sessions.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ color: theme.fg3, fontSize: 13 }}>
              No sessions yet. Start a new session to begin.
            </Text>
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.sessionId}
            renderItem={({ item }) => {
              const summary =
                item.customTitle || item.summary || item.firstPrompt || "Untitled";
              const truncSummary =
                summary.length > 100 ? summary.slice(0, 100) + "..." : summary;

              return (
                <Pressable
                  style={[styles.row, { borderBottomColor: theme.edge }]}
                  onPress={() =>
                    router.push({
                      pathname: "/chat/[sessionId]",
                      params: { sessionId: item.sessionId, dir: relativePath },
                    })
                  }
                >
                  <Text
                    style={[styles.summary, { color: theme.fg2 }]}
                    numberOfLines={2}
                  >
                    {truncSummary}
                  </Text>
                  <View style={styles.meta}>
                    {item.gitBranch && (
                      <View style={[styles.branchBadge, { borderColor: theme.edge }]}>
                        <Text
                          style={[
                            styles.branchText,
                            { color: theme.fg3, fontFamily: Fonts?.mono },
                          ]}
                        >
                          {item.gitBranch}
                        </Text>
                      </View>
                    )}
                    <Text
                      style={[
                        styles.sessionIdText,
                        { color: theme.fg3, fontFamily: Fonts?.mono },
                      ]}
                    >
                      {item.sessionId.slice(0, 8)}
                    </Text>
                    <Text
                      style={[
                        styles.timeText,
                        { color: theme.fg3 },
                      ]}
                    >
                      {timeAgo(item.lastModified)}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  heading: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
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
  row: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  summary: {
    fontSize: 13,
    lineHeight: 18,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  branchBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  branchText: { fontSize: 10 },
  sessionIdText: { fontSize: 10 },
  timeText: { fontSize: 10, marginLeft: "auto" },
});
