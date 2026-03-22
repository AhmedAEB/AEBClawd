import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { Fonts } from "@/constants/theme";

interface FileChange {
  file: string;
  status: string;
}

interface Commit {
  graph?: string;
  graphOnly?: boolean;
  hash?: string;
  shortHash?: string;
  author?: string;
  timestamp?: number;
  subject?: string;
  refs?: string[];
}

const STATUS_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  "?": "Untracked",
};

function statusLabel(s: string): string {
  return STATUS_LABELS[s] || s;
}

function timeAgo(ts: number): string {
  const age = Date.now() - ts;
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  return `${Math.floor(age / 86_400_000)}d`;
}

export default function SourceControlModal({
  visible,
  onClose,
  relativePath,
  onGenerateMessage,
  canGenerate,
}: {
  visible: boolean;
  onClose: () => void;
  relativePath: string;
  onGenerateMessage?: () => void;
  canGenerate?: boolean;
}) {
  const theme = useTheme();
  const [branch, setBranch] = useState("");
  const [staged, setStaged] = useState<FileChange[]>([]);
  const [unstaged, setUnstaged] = useState<FileChange[]>([]);
  const [untracked, setUntracked] = useState<{ file: string }[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"changes" | "log">("changes");
  const [syncStatus, setSyncStatus] = useState<{
    hasUpstream: boolean;
    ahead: number;
    behind: number;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.gitStatus(relativePath);
      if (data.error) {
        setError(data.error);
        return;
      }
      setBranch(data.branch);
      setStaged(data.staged ?? []);
      setUnstaged(data.unstaged ?? []);
      setUntracked(data.untracked ?? []);
      setError(null);
    } catch {
      setError("Failed to connect");
    }
  }, [relativePath]);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const data = await api.gitSyncStatus(relativePath);
      if (!data.error) {
        setSyncStatus({
          hasUpstream: data.hasUpstream,
          ahead: data.ahead,
          behind: data.behind,
        });
      }
    } catch {}
  }, [relativePath]);

  const fetchLog = useCallback(async () => {
    try {
      const data = await api.gitLog(relativePath);
      if (!data.error) setCommits(data.commits ?? []);
    } catch {}
  }, [relativePath]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    Promise.all([fetchStatus(), fetchLog(), fetchSyncStatus()]).finally(() =>
      setLoading(false)
    );
  }, [visible, fetchStatus, fetchLog, fetchSyncStatus]);

  const refresh = async () => {
    await Promise.all([fetchStatus(), fetchLog(), fetchSyncStatus()]);
  };

  const stageFiles = async (files: string[]) => {
    await api.gitStage(relativePath, files);
    await refresh();
  };

  const unstageFiles = async (files: string[]) => {
    await api.gitUnstage(relativePath, files);
    await refresh();
  };

  const discardFiles = (files: string[]) => {
    Alert.alert("Discard Changes", "Discard changes to these files?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: async () => {
          await api.gitDiscard(relativePath, files);
          await refresh();
        },
      },
    ]);
  };

  const doCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      const data = await api.gitCommit(relativePath, commitMsg.trim());
      if (data.error) {
        setError(data.error);
      } else {
        setCommitMsg("");
        setError(null);
      }
      await refresh();
    } catch {
      setError("Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  const doSync = async () => {
    setSyncing(true);
    try {
      const pullData = await api.gitPull(relativePath);
      if (pullData.error) {
        setError(pullData.conflict ? `MERGE CONFLICT: ${pullData.error}` : pullData.error);
        await refresh();
        return;
      }
      const pushData = await api.gitPush(relativePath);
      if (pushData.error) setError(pushData.error);
      await refresh();
    } catch {
      setError("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const viewDiff = async (file: string, isStaged: boolean) => {
    if (diffFile === file) {
      setDiff(null);
      setDiffFile(null);
      return;
    }
    try {
      const data = await api.gitDiff(relativePath, file, isStaged);
      setDiff(data.diff || "(no diff)");
      setDiffFile(file);
    } catch {
      setDiff("Failed to load diff");
      setDiffFile(file);
    }
  };

  const totalChanges = staged.length + unstaged.length + untracked.length;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: theme.void }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.edge }]}>
          <View style={styles.headerLeft}>
            <Text style={[styles.heading, { color: theme.fg }]}>
              SOURCE CONTROL
            </Text>
            {branch ? (
              <View style={[styles.branchBadge, { borderColor: theme.edge }]}>
                <Text
                  style={[
                    styles.branchText,
                    { color: theme.fg3, fontFamily: Fonts?.mono },
                  ]}
                >
                  {branch}
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={{ color: theme.fg, fontSize: 18, fontWeight: "700" }}>
              ×
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.fg} />
          </View>
        ) : (
          <>
            {/* Tabs */}
            <View style={[styles.tabBar, { borderBottomColor: theme.edge }]}>
              <Pressable
                onPress={() => setTab("changes")}
                style={[
                  styles.tabButton,
                  {
                    backgroundColor:
                      tab === "changes" ? theme.fg : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: tab === "changes" ? theme.void : theme.fg3 },
                  ]}
                >
                  CHANGES{totalChanges > 0 ? ` (${totalChanges})` : ""}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setTab("log")}
                style={[
                  styles.tabButton,
                  {
                    backgroundColor: tab === "log" ? theme.fg : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: tab === "log" ? theme.void : theme.fg3 },
                  ]}
                >
                  LOG
                </Text>
              </Pressable>
            </View>

            {/* Sync bar */}
            {syncStatus && (
              <View style={[styles.syncBar, { borderBottomColor: theme.edge }]}>
                <Pressable
                  onPress={doSync}
                  disabled={syncing}
                  style={[styles.syncButton, { borderColor: theme.fg }]}
                >
                  {syncing ? (
                    <ActivityIndicator size="small" color={theme.fg} />
                  ) : (
                    <Text style={[styles.syncText, { color: theme.fg }]}>
                      {syncStatus.hasUpstream
                        ? `SYNC${syncStatus.ahead || syncStatus.behind ? ` ${syncStatus.ahead}↑ ${syncStatus.behind}↓` : ""}`
                        : "PUBLISH"}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}

            {error && (
              <View style={[styles.errorBar, { borderBottomColor: theme.edge }]}>
                <Text
                  style={[
                    styles.errorText,
                    { color: theme.fg, fontFamily: Fonts?.mono },
                  ]}
                >
                  {error}
                </Text>
                <Pressable onPress={() => setError(null)}>
                  <Text style={{ color: theme.fg3, fontSize: 10, fontWeight: "700" }}>
                    DISMISS
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Diff viewer */}
            {diff && diffFile && (
              <View
                style={[styles.diffContainer, { borderBottomColor: theme.edge }]}
              >
                <View style={styles.diffHeader}>
                  <Pressable
                    onPress={() => {
                      setDiff(null);
                      setDiffFile(null);
                    }}
                  >
                    <Text style={{ color: theme.fg3, fontSize: 11, fontWeight: "700" }}>
                      ← BACK
                    </Text>
                  </Pressable>
                  <Text
                    style={[
                      styles.diffFileName,
                      { color: theme.fg3, fontFamily: Fonts?.mono },
                    ]}
                    numberOfLines={1}
                  >
                    {diffFile}
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  style={styles.diffScroll}
                  nestedScrollEnabled
                >
                  <Text
                    style={[
                      styles.diffContent,
                      { color: theme.fg2, fontFamily: Fonts?.mono },
                    ]}
                    selectable
                  >
                    {diff}
                  </Text>
                </ScrollView>
              </View>
            )}

            <ScrollView style={styles.scrollContent}>
              {tab === "changes" ? (
                <View>
                  {/* Commit box */}
                  <View
                    style={[styles.commitBox, { borderBottomColor: theme.edge }]}
                  >
                    <TextInput
                      style={[
                        styles.commitInput,
                        {
                          color: theme.fg,
                          borderColor: theme.edge,
                          fontFamily: Fonts?.mono,
                        },
                      ]}
                      value={commitMsg}
                      onChangeText={setCommitMsg}
                      placeholder="Commit message"
                      placeholderTextColor={theme.fg3}
                      multiline
                      numberOfLines={3}
                    />
                    <View style={styles.commitActions}>
                      <Pressable
                        onPress={doCommit}
                        disabled={
                          committing || !commitMsg.trim() || staged.length === 0
                        }
                        style={[
                          styles.commitButton,
                          {
                            backgroundColor: theme.fg,
                            opacity:
                              committing ||
                              !commitMsg.trim() ||
                              staged.length === 0
                                ? 0.3
                                : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.commitButtonText, { color: theme.void }]}
                        >
                          {committing ? "COMMITTING..." : "COMMIT"}
                        </Text>
                      </Pressable>
                      {onGenerateMessage && (
                        <Pressable
                          onPress={() => {
                            onClose();
                            onGenerateMessage();
                          }}
                          disabled={!canGenerate}
                          style={[
                            styles.generateButton,
                            {
                              borderColor: theme.fg,
                              opacity: canGenerate ? 1 : 0.3,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.generateButtonText,
                              { color: theme.fg },
                            ]}
                          >
                            GENERATE
                          </Text>
                        </Pressable>
                      )}
                      {staged.length === 0 &&
                        (unstaged.length > 0 || untracked.length > 0) && (
                          <Pressable
                            onPress={() => {
                              const all = [
                                ...unstaged.map((f) => f.file),
                                ...untracked.map((f) => f.file),
                              ];
                              stageFiles(all);
                            }}
                            style={[
                              styles.generateButton,
                              { borderColor: theme.fg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.generateButtonText,
                                { color: theme.fg },
                              ]}
                            >
                              STAGE ALL
                            </Text>
                          </Pressable>
                        )}
                    </View>
                  </View>

                  {/* Staged */}
                  {staged.length > 0 && (
                    <FileSection
                      title={`STAGED (${staged.length})`}
                      files={staged.map((f) => ({
                        file: f.file,
                        status: statusLabel(f.status),
                      }))}
                      action="unstage"
                      onAction={(file) => unstageFiles([file])}
                      onBulkAction={() =>
                        unstageFiles(staged.map((f) => f.file))
                      }
                      bulkLabel="UNSTAGE ALL"
                      onPress={(file) => viewDiff(file, true)}
                      theme={theme}
                      activeFile={diffFile}
                    />
                  )}

                  {/* Unstaged */}
                  {unstaged.length > 0 && (
                    <FileSection
                      title={`CHANGES (${unstaged.length})`}
                      files={unstaged.map((f) => ({
                        file: f.file,
                        status: statusLabel(f.status),
                      }))}
                      action="stage"
                      onAction={(file) => stageFiles([file])}
                      onBulkAction={() =>
                        stageFiles(unstaged.map((f) => f.file))
                      }
                      bulkLabel="STAGE ALL"
                      onPress={(file) => viewDiff(file, false)}
                      onDiscard={(file) => discardFiles([file])}
                      theme={theme}
                      activeFile={diffFile}
                    />
                  )}

                  {/* Untracked */}
                  {untracked.length > 0 && (
                    <FileSection
                      title={`UNTRACKED (${untracked.length})`}
                      files={untracked.map((f) => ({
                        file: f.file,
                        status: "Untracked",
                      }))}
                      action="stage"
                      onAction={(file) => stageFiles([file])}
                      onBulkAction={() =>
                        stageFiles(untracked.map((f) => f.file))
                      }
                      bulkLabel="STAGE ALL"
                      onPress={() => {}}
                      theme={theme}
                      activeFile={null}
                    />
                  )}

                  {totalChanges === 0 && (
                    <Text
                      style={{
                        color: theme.fg3,
                        textAlign: "center",
                        padding: 32,
                        fontSize: 13,
                      }}
                    >
                      Working tree clean
                    </Text>
                  )}
                </View>
              ) : (
                <View>
                  {commits.filter((c) => !c.graphOnly).length === 0 ? (
                    <Text
                      style={{
                        color: theme.fg3,
                        textAlign: "center",
                        padding: 32,
                        fontSize: 13,
                      }}
                    >
                      No commits found
                    </Text>
                  ) : (
                    commits
                      .filter((c) => !c.graphOnly)
                      .map((c) => (
                        <View
                          key={c.hash}
                          style={[
                            styles.commitRow,
                            { borderBottomColor: theme.edge },
                          ]}
                        >
                          <View style={styles.commitRowContent}>
                            <Text
                              style={[styles.commitSubject, { color: theme.fg }]}
                              numberOfLines={1}
                            >
                              {c.subject}
                            </Text>
                            <View style={styles.commitMeta}>
                              <Text
                                style={[
                                  styles.commitHash,
                                  { color: theme.fg3, fontFamily: Fonts?.mono },
                                ]}
                              >
                                {c.shortHash}
                              </Text>
                              <Text style={[styles.commitAuthor, { color: theme.fg3 }]}>
                                {c.author}
                              </Text>
                              {c.timestamp && (
                                <Text
                                  style={[styles.commitTime, { color: theme.fg3 }]}
                                >
                                  {timeAgo(c.timestamp)}
                                </Text>
                              )}
                            </View>
                            {c.refs && c.refs.length > 0 && (
                              <View style={styles.refsRow}>
                                {c.refs.map((ref) => (
                                  <View
                                    key={ref}
                                    style={[
                                      styles.refBadge,
                                      { borderColor: theme.edge },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.refText,
                                        { color: theme.fg3, fontFamily: Fonts?.mono },
                                      ]}
                                    >
                                      {ref}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            )}
                          </View>
                        </View>
                      ))
                  )}
                </View>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  );
}

function FileSection({
  title,
  files,
  action,
  onAction,
  onBulkAction,
  bulkLabel,
  onPress,
  onDiscard,
  theme,
  activeFile,
}: {
  title: string;
  files: { file: string; status: string }[];
  action: "stage" | "unstage";
  onAction: (file: string) => void;
  onBulkAction: () => void;
  bulkLabel: string;
  onPress: (file: string) => void;
  onDiscard?: (file: string) => void;
  theme: any;
  activeFile: string | null;
}) {
  return (
    <View>
      <View
        style={[styles.sectionHeader, { borderBottomColor: theme.edge }]}
      >
        <Text style={[styles.sectionTitle, { color: theme.fg3 }]}>
          {title}
        </Text>
        <Pressable onPress={onBulkAction}>
          <Text style={{ color: theme.fg3, fontSize: 10, fontWeight: "700", letterSpacing: 1 }}>
            {bulkLabel}
          </Text>
        </Pressable>
      </View>
      {files.map((f) => {
        const filename = f.file.split("/").pop() || f.file;
        const dir = f.file.includes("/")
          ? f.file.slice(0, f.file.lastIndexOf("/"))
          : "";
        return (
          <Pressable
            key={f.file}
            onPress={() => onPress(f.file)}
            style={[
              styles.fileRow,
              {
                borderBottomColor: theme.edge,
                backgroundColor:
                  activeFile === f.file ? theme.panel2 : "transparent",
              },
            ]}
          >
            <View style={styles.fileInfo}>
              <Text
                style={[
                  styles.fileName,
                  { color: theme.fg, fontFamily: Fonts?.mono },
                ]}
                numberOfLines={1}
              >
                {filename}
              </Text>
              {dir ? (
                <Text
                  style={[
                    styles.fileDir,
                    { color: theme.fg3, fontFamily: Fonts?.mono },
                  ]}
                  numberOfLines={1}
                >
                  {dir}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.fileStatus, { color: theme.fg3 }]}>
              {f.status}
            </Text>
            <View style={styles.fileActions}>
              <Pressable
                onPress={() => onAction(f.file)}
                style={styles.fileActionButton}
              >
                <Text style={{ color: theme.fg3, fontSize: 14, fontWeight: "700" }}>
                  {action === "stage" ? "+" : "−"}
                </Text>
              </Pressable>
              {onDiscard && (
                <Pressable
                  onPress={() => onDiscard(f.file)}
                  style={styles.fileActionButton}
                >
                  <Text style={{ color: theme.fg3, fontSize: 14, fontWeight: "700" }}>
                    ×
                  </Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 16,
    borderBottomWidth: 2,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { fontSize: 13, fontWeight: "800", letterSpacing: 2 },
  branchBadge: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  branchText: { fontSize: 10 },
  closeButton: { padding: 4 },
  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tabButton: { flex: 1, paddingVertical: 8, alignItems: "center" },
  tabText: { fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  syncBar: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  syncButton: {
    borderWidth: 2,
    paddingVertical: 6,
    alignItems: "center",
  },
  syncText: { fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  errorBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  errorText: { fontSize: 10, flex: 1, marginRight: 8 },
  diffContainer: { maxHeight: 200, borderBottomWidth: 1 },
  diffHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  diffFileName: { fontSize: 10, flex: 1 },
  diffScroll: { paddingHorizontal: 12 },
  diffContent: { fontSize: 10, lineHeight: 16 },
  scrollContent: { flex: 1 },
  commitBox: { padding: 12, borderBottomWidth: 1 },
  commitInput: {
    borderWidth: 2,
    padding: 8,
    fontSize: 12,
    minHeight: 60,
    textAlignVertical: "top",
  },
  commitActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  commitButton: { paddingHorizontal: 12, paddingVertical: 6 },
  commitButtonText: { fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  generateButton: { borderWidth: 2, paddingHorizontal: 10, paddingVertical: 6 },
  generateButtonText: { fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  sectionTitle: { fontSize: 9, fontWeight: "700", letterSpacing: 2 },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  fileInfo: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 11 },
  fileDir: { fontSize: 9 },
  fileStatus: { fontSize: 8, fontWeight: "700", letterSpacing: 1, marginHorizontal: 4 },
  fileActions: { flexDirection: "row", gap: 2 },
  fileActionButton: { paddingHorizontal: 6, paddingVertical: 2 },
  commitRow: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  commitRowContent: {},
  commitSubject: { fontSize: 12, lineHeight: 16 },
  commitMeta: { flexDirection: "row", gap: 8, marginTop: 4 },
  commitHash: { fontSize: 9 },
  commitAuthor: { fontSize: 9 },
  commitTime: { fontSize: 9 },
  refsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  refBadge: { borderWidth: 1, paddingHorizontal: 4, paddingVertical: 1 },
  refText: { fontSize: 8 },
});
