import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Image,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { useConfig } from "@/lib/config-context";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { connectSSE } from "@/lib/sse";
import { Fonts } from "@/constants/theme";
import SourceControlModal from "@/components/source-control";
import { Markdown } from "@/components/markdown";

type MessageRole = "user" | "assistant" | "system" | "event";

interface ImageAttachment {
  data: string;
  mediaType: string;
  name: string;
  preview: string;
}

interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
  eventType?: string;
  meta?: Record<string, any>;
  images?: ImageAttachment[];
}

interface ToolApprovalRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  title?: string;
}

const EVENT_LABELS: Record<string, string> = {
  init: "INIT",
  retry: "RETRY",
  rate_limit: "RATE",
  thinking: "THINK",
  tool_use: "TOOL",
  tool_result: "RESULT",
  tool_output: "OUTPUT",
  tool_error: "ERROR",
  result: "DONE",
  error: "ERROR",
  stderr: "STDERR",
  raw: "RAW",
  system: "SYS",
};

export default function ChatScreen() {
  const theme = useTheme();
  const { apiUrl } = useConfig();
  const { sessionId: initialSessionId, dir } = useLocalSearchParams<{
    sessionId: string;
    dir: string;
  }>();
  const relativePath = dir || "";
  const isNewSession = initialSessionId === "new";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ToolApprovalRequest[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(
    isNewSession ? null : initialSessionId || null
  );
  const [statusInfo, setStatusInfo] = useState<{
    model?: string;
    costUsd?: number;
    durationMs?: number;
    turns?: number;
    permissionMode?: string;
  }>({});
  const [historyLoading, setHistoryLoading] = useState(!isNewSession);
  const [scOpen, setScOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [availableModels, setAvailableModels] = useState<
    { value: string; displayName: string; description: string }[]
  >([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);

  const clientIdRef = useRef(
    `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const disconnectRef = useRef<(() => void) | null>(null);
  const streamBufferRef = useRef("");
  const flatListRef = useRef<FlatList>(null);

  const segments = relativePath.split("/").filter(Boolean);
  const dirName = segments[segments.length - 1] || "Root";

  // Fetch models
  useEffect(() => {
    api
      .getModels()
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setAvailableModels(data);
          if (!selectedModel) setSelectedModel(data[0].value);
        }
      })
      .catch(() => {});
  }, []);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Load session history
  useEffect(() => {
    if (isNewSession) return;

    const loadHistory = async () => {
      try {
        const data = await api.getMessages(initialSessionId!);
        const parsed: Message[] = [];

        for (const msg of data as any[]) {
          if (msg.type === "user") {
            const content = msg.message?.content;
            if (typeof content === "string") {
              parsed.push({ role: "user", content, timestamp: 0 });
            } else if (Array.isArray(content)) {
              const textParts: string[] = [];
              for (const block of content) {
                if (block.type === "text") {
                  textParts.push(block.text);
                } else if (block.type === "tool_result") {
                  const resultContent =
                    typeof block.content === "string"
                      ? block.content
                      : JSON.stringify(block.content);
                  const truncated =
                    resultContent.length > 500
                      ? resultContent.slice(0, 500) + "..."
                      : resultContent;
                  parsed.push({
                    role: "event",
                    content: truncated,
                    timestamp: 0,
                    eventType: block.is_error ? "tool_error" : "tool_result",
                  });
                }
              }
              if (textParts.length > 0) {
                parsed.push({
                  role: "user",
                  content: textParts.join(""),
                  timestamp: 0,
                });
              }
            }
          } else if (msg.type === "assistant") {
            const blocks = msg.message?.content;
            if (Array.isArray(blocks)) {
              for (const block of blocks as any[]) {
                if (block.type === "thinking" && block.thinking) {
                  parsed.push({
                    role: "event",
                    content:
                      block.thinking.slice(0, 500) +
                      (block.thinking.length > 500 ? "..." : ""),
                    timestamp: 0,
                    eventType: "thinking",
                  });
                } else if (block.type === "text" && block.text) {
                  parsed.push({
                    role: "assistant",
                    content: block.text,
                    timestamp: 0,
                  });
                } else if (block.type === "tool_use") {
                  const inputStr =
                    typeof block.input === "string"
                      ? block.input
                      : JSON.stringify(block.input, null, 2);
                  const truncInput =
                    inputStr.slice(0, 300) +
                    (inputStr.length > 300 ? "..." : "");
                  parsed.push({
                    role: "event",
                    content: `${block.name}\n${truncInput}`,
                    timestamp: 0,
                    eventType: "tool_use",
                  });
                }
              }
            }
          }
        }

        setMessages(parsed);
      } catch (err) {
        console.error("[sessions] Failed to load history:", err);
        setMessages([
          {
            role: "event",
            content: "Failed to load session history",
            timestamp: Date.now(),
            eventType: "error",
          },
        ]);
      } finally {
        setHistoryLoading(false);
      }
    };

    loadHistory();
  }, [initialSessionId, isNewSession]);

  const updateAssistantMessage = useCallback((text: string) => {
    setMessages((prev) => {
      const lastAssistantIdx = prev.findLastIndex((m) => m.role === "assistant");
      const lastUserIdx = prev.findLastIndex((m) => m.role === "user");
      if (lastAssistantIdx > lastUserIdx) {
        const updated = [...prev];
        updated[lastAssistantIdx] = {
          ...updated[lastAssistantIdx],
          content: text,
        };
        return updated;
      }
      return [
        ...prev,
        { role: "assistant" as const, content: text, timestamp: Date.now() },
      ];
    });
  }, []);

  const addEvent = useCallback(
    (eventType: string, content: string, meta?: Record<string, any>) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "event" as const,
          content,
          timestamp: Date.now(),
          eventType,
          meta,
        },
      ]);
    },
    []
  );

  const handleStreamData = useCallback(
    (data: any) => {
      if (data.type === "system") {
        if (data.subtype === "init") {
          const toolCount = data.tools?.length ?? 0;
          const mcpServers: any[] = data.mcp_servers ?? [];
          const connectedMcp = mcpServers.filter(
            (s: any) => s.status === "connected"
          );
          if (data.session_id) setSessionId(data.session_id);
          setStatusInfo((prev) => ({
            ...prev,
            model: data.model,
            permissionMode: data.permissionMode,
          }));
          addEvent(
            "init",
            `${data.model} | ${toolCount} tools | ${connectedMcp.length}/${mcpServers.length} MCP | ${data.permissionMode}`
          );
        } else if (data.subtype === "api_retry") {
          addEvent(
            "retry",
            `Retry #${data.attempt}/${data.max_retries} — ${data.error}`
          );
        } else {
          addEvent("system", `System: ${data.subtype ?? JSON.stringify(data)}`);
        }
      }

      if (data.type === "stream_event" && data.event) {
        const ev = data.event;
        if (
          ev.type === "content_block_delta" &&
          ev.delta?.type === "text_delta"
        ) {
          streamBufferRef.current += ev.delta.text;
          updateAssistantMessage(streamBufferRef.current);
        }
      }

      if (data.type === "assistant" && data.message?.content) {
        const blocks: any[] = data.message.content;

        for (const t of blocks.filter((b: any) => b.type === "thinking")) {
          if (t.thinking) {
            addEvent(
              "thinking",
              t.thinking.slice(0, 500) +
                (t.thinking.length > 500 ? "..." : "")
            );
          }
        }

        const textBlocks = blocks
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
        if (textBlocks) {
          streamBufferRef.current = textBlocks;
          updateAssistantMessage(textBlocks);
        }

        for (const tool of blocks.filter((b: any) => b.type === "tool_use")) {
          const inputStr =
            typeof tool.input === "string"
              ? tool.input
              : JSON.stringify(tool.input, null, 2);
          const truncInput =
            inputStr.slice(0, 300) + (inputStr.length > 300 ? "..." : "");
          addEvent("tool_use", `${tool.name}\n${truncInput}`);
        }
      }

      if (data.type === "user" && data.message?.content) {
        const blocks: any[] = Array.isArray(data.message.content)
          ? data.message.content
          : [data.message.content];

        for (const block of blocks) {
          if (block.type === "tool_result") {
            const isError = block.is_error ?? false;
            const content =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
            const truncated =
              content.slice(0, 500) + (content.length > 500 ? "..." : "");
            addEvent(isError ? "tool_error" : "tool_result", truncated);
          }
        }

        if (data.tool_use_result) {
          const r = data.tool_use_result;
          if (typeof r === "string") {
            addEvent("tool_error", r);
          } else if (r.stdout !== undefined) {
            const parts: string[] = [];
            if (r.stdout) parts.push(r.stdout.slice(0, 500));
            if (r.stderr) parts.push(`stderr: ${r.stderr.slice(0, 200)}`);
            if (r.interrupted) parts.push("[interrupted]");
            addEvent("tool_output", parts.length > 0 ? parts.join("\n") : "(no output)");
          } else if (r.matches) {
            addEvent("tool_result", `Matched: ${r.matches.join(", ")}`);
          }
        }
      }

      if (data.type === "rate_limit_event") {
        const info = data.rate_limit_info;
        if (info) {
          addEvent(
            "rate_limit",
            `Rate limit: ${info.status} | ${info.rateLimitType}`
          );
        }
      }

      if (data.type === "result") {
        if (data.session_id) setSessionId(data.session_id);
        setStatusInfo((prev) => ({
          ...prev,
          costUsd: data.total_cost_usd,
          durationMs: data.duration_ms,
          turns: data.num_turns,
        }));

        const parts = [
          `${(data.duration_ms / 1000).toFixed(1)}s`,
          `${data.num_turns} turn${data.num_turns !== 1 ? "s" : ""}`,
          `$${data.total_cost_usd?.toFixed(4) ?? "?"}`,
        ];
        addEvent("result", `Done: ${parts.join(" · ")}`);
        setIsStreaming(false);
        streamBufferRef.current = "";
      }
    },
    [addEvent, updateAssistantMessage]
  );

  // Connect SSE
  useEffect(() => {
    if (!apiUrl) {
      console.log("[SSE] No apiUrl, skipping connection");
      return;
    }

    console.log("[SSE] Connecting to", apiUrl, "with clientId", clientIdRef.current);

    const disconnect = connectSSE(apiUrl, clientIdRef.current, {
      onOpen: () => {
        console.log("[SSE] Connected!");
        setIsConnected(true);
      },
      onStream: handleStreamData,
      onToolApproval: (data) => {
        setPendingApprovals((prev) => [...prev, data]);
      },
      onDone: (data) => {
        if (data.sessionId) setSessionId(data.sessionId);
        setIsStreaming(false);
        setPendingApprovals([]);
        streamBufferRef.current = "";
      },
      onError: (msg) => {
        console.log("[SSE] Error:", msg);
        addEvent("error", msg);
        setIsStreaming(false);
      },
      onClose: () => {
        console.log("[SSE] Closed");
        setIsConnected(false);
      },
    });
    disconnectRef.current = disconnect;

    return () => {
      disconnect();
    };
  }, [apiUrl, handleStreamData, addEvent]);

  const sendPrompt = async (directPrompt?: string) => {
    const prompt = directPrompt?.trim() || input.trim();
    const images = directPrompt ? [] : attachedImages;
    if ((!prompt && images.length === 0) || !isConnected || isStreaming) return;

    const effectivePrompt = prompt || "What is in this image?";
    if (!directPrompt) {
      setInput("");
      setAttachedImages([]);
    }
    setIsStreaming(true);
    streamBufferRef.current = "";

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: effectivePrompt,
        timestamp: Date.now(),
        images: images.length > 0 ? images : undefined,
      },
    ]);

    await api.sendPrompt({
      clientId: clientIdRef.current,
      prompt: effectivePrompt,
      sessionId: sessionId ?? undefined,
      workDir: relativePath,
      model: selectedModel,
      ...(images.length > 0 && {
        images: images.map((img) => ({
          data: img.data,
          mediaType: img.mediaType,
        })),
      }),
    });
  };

  const respondToApproval = async (toolUseId: string, approved: boolean) => {
    await api.toolApproval({
      clientId: clientIdRef.current,
      toolUseId,
      approved,
    });
    setPendingApprovals((prev) =>
      prev.filter((a) => a.toolUseId !== toolUseId)
    );
  };

  const abort = async () => {
    await api.abort(clientIdRef.current);
    setIsStreaming(false);
    setPendingApprovals([]);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets) {
      for (const asset of result.assets) {
        if (asset.base64) {
          const mediaType = asset.mimeType || "image/jpeg";
          setAttachedImages((prev) => [
            ...prev,
            {
              data: asset.base64!,
              mediaType,
              name: asset.fileName || "image",
              preview: asset.uri,
            },
          ]);
        }
      }
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    if (item.role === "event") {
      const label = EVENT_LABELS[item.eventType ?? "system"] ?? "EVENT";
      const isError =
        item.eventType === "error" || item.eventType === "tool_error";
      return (
        <View
          style={[
            styles.eventRow,
            {
              borderLeftColor: isError ? theme.fg : theme.fg3,
              backgroundColor: theme.panel2,
            },
          ]}
        >
          <Text
            style={[
              styles.eventLabel,
              { color: theme.fg3, fontFamily: Fonts?.mono },
            ]}
          >
            {label}
          </Text>
          <Text
            style={[
              styles.eventContent,
              { color: theme.fg2, fontFamily: Fonts?.mono },
            ]}
          >
            {item.content}
          </Text>
        </View>
      );
    }

    const isUser = item.role === "user";
    return (
      <View
        style={[styles.bubbleRow, isUser ? styles.bubbleRight : styles.bubbleLeft]}
      >
        <View
          style={[
            styles.bubble,
            isUser
              ? { backgroundColor: theme.fg, maxWidth: "80%" }
              : {
                  borderWidth: 1,
                  borderColor: theme.edge,
                  backgroundColor: theme.void,
                  maxWidth: "85%",
                },
          ]}
        >
          {isUser && item.images && item.images.length > 0 && (
            <View style={styles.imageRow}>
              {item.images.map((img, j) => (
                <Image
                  key={j}
                  source={{ uri: img.preview }}
                  style={styles.attachedImage}
                  resizeMode="contain"
                />
              ))}
            </View>
          )}
          {isUser ? (
            <Text
              style={[styles.bubbleText, { color: theme.void }]}
              selectable
            >
              {item.content}
            </Text>
          ) : (
            <Markdown content={item.content} />
          )}
        </View>
      </View>
    );
  };

  const currentModelName =
    availableModels.find((m) => m.value === selectedModel)?.displayName ||
    selectedModel ||
    "...";

  return (
    <>
      <Stack.Screen
        options={{
          title: sessionId ? sessionId.slice(0, 8) : dirName,
          headerRight: () => (
            <View style={styles.headerRight}>
              {/* Connection indicator */}
              <View
                style={[
                  styles.connectionDot,
                  {
                    backgroundColor: isConnected ? theme.fg : "transparent",
                    borderWidth: isConnected ? 0 : 1,
                    borderColor: theme.fg,
                  },
                ]}
              />
              {/* Source Control */}
              <Pressable
                onPress={() => setScOpen(true)}
                style={styles.headerButton}
              >
                <Text style={{ color: theme.fg, fontSize: 16 }}>SC</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: theme.void }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {/* Model selector bar */}
        <View style={[styles.modelBar, { borderBottomColor: theme.edge }]}>
          <Pressable
            onPress={() => setModelMenuOpen(true)}
            disabled={isStreaming}
            style={[styles.modelButton, { borderColor: theme.edge }]}
          >
            <Text
              style={[
                styles.modelButtonText,
                { color: theme.fg, fontFamily: Fonts?.mono },
              ]}
            >
              {currentModelName}
            </Text>
          </Pressable>
          {statusInfo.turns !== undefined && (
            <Text
              style={[styles.statusText, { color: theme.fg3, fontFamily: Fonts?.mono }]}
            >
              {statusInfo.turns}t
            </Text>
          )}
          {statusInfo.costUsd !== undefined && (
            <Text
              style={[styles.statusText, { color: theme.fg, fontFamily: Fonts?.mono }]}
            >
              ${statusInfo.costUsd.toFixed(4)}
            </Text>
          )}
        </View>

        {/* Messages */}
        {historyLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.fg} />
            <Text style={{ color: theme.fg3, marginTop: 8, fontSize: 13 }}>
              Loading...
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesList}
            onContentSizeChange={scrollToBottom}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Text style={[styles.emptyChatText, { color: theme.fg3 }]}>
                  WHAT WOULD YOU LIKE TO BUILD?
                </Text>
                <Text
                  style={[
                    styles.emptyChatSub,
                    { color: theme.fg3, fontFamily: Fonts?.mono },
                  ]}
                >
                  {dirName}
                </Text>
              </View>
            }
            ListFooterComponent={
              isStreaming &&
              messages[messages.length - 1]?.role !== "assistant" ? (
                <View style={[styles.bubbleRow, styles.bubbleLeft]}>
                  <View
                    style={[
                      styles.bubble,
                      { borderWidth: 1, borderColor: theme.edge },
                    ]}
                  >
                    <View style={styles.typingDots}>
                      {[0, 1, 2].map((i) => (
                        <View
                          key={i}
                          style={[styles.dot, { backgroundColor: theme.fg }]}
                        />
                      ))}
                    </View>
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* Tool approvals */}
        {pendingApprovals.length > 0 && (
          <View style={[styles.approvalsContainer, { borderTopColor: theme.edge }]}>
            {pendingApprovals.map((approval) => {
              const inputStr = JSON.stringify(approval.input, null, 2);
              const truncInput =
                inputStr.length > 200
                  ? inputStr.slice(0, 200) + "..."
                  : inputStr;
              return (
                <View
                  key={approval.toolUseId}
                  style={[styles.approvalCard, { borderColor: theme.fg }]}
                >
                  <Text style={[styles.approvalTitle, { color: theme.fg }]}>
                    {approval.title || `APPROVE: ${approval.toolName}`}
                  </Text>
                  <Text
                    style={[
                      styles.approvalInput,
                      {
                        color: theme.fg2,
                        backgroundColor: theme.panel2,
                        borderColor: theme.edge,
                        fontFamily: Fonts?.mono,
                      },
                    ]}
                    numberOfLines={6}
                  >
                    {truncInput}
                  </Text>
                  <View style={styles.approvalButtons}>
                    <Pressable
                      onPress={() =>
                        respondToApproval(approval.toolUseId, true)
                      }
                      style={[
                        styles.approvalAllow,
                        { backgroundColor: theme.fg },
                      ]}
                    >
                      <Text style={{ color: theme.void, fontWeight: "700", fontSize: 12 }}>
                        Allow
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        respondToApproval(approval.toolUseId, false)
                      }
                      style={[
                        styles.approvalDeny,
                        { borderColor: theme.fg },
                      ]}
                    >
                      <Text style={{ color: theme.fg, fontWeight: "700", fontSize: 12 }}>
                        Deny
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Image previews */}
        {attachedImages.length > 0 && (
          <View style={[styles.imagePreviewRow, { borderTopColor: theme.edge }]}>
            {attachedImages.map((img, i) => (
              <View key={i} style={styles.imagePreviewWrap}>
                <Image
                  source={{ uri: img.preview }}
                  style={[styles.imagePreview, { borderColor: theme.edge }]}
                />
                <Pressable
                  onPress={() =>
                    setAttachedImages((prev) => prev.filter((_, j) => j !== i))
                  }
                  style={[styles.imageRemove, { backgroundColor: theme.fg }]}
                >
                  <Text style={{ color: theme.void, fontSize: 10 }}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Input */}
        <View style={[styles.inputContainer, { borderTopColor: theme.edge }]}>
          <Pressable
            onPress={pickImage}
            disabled={!isConnected || isStreaming}
            style={styles.attachButton}
          >
            <Text style={{ color: theme.fg3, fontSize: 20 }}>+</Text>
          </Pressable>
          <TextInput
            style={[
              styles.textInput,
              {
                color: theme.fg,
                borderColor: theme.edge,
                backgroundColor: theme.void,
              },
            ]}
            value={input}
            onChangeText={setInput}
            placeholder={isConnected ? "Message Claude..." : "Connecting..."}
            placeholderTextColor={theme.fg3}
            editable={isConnected}
            multiline
            maxLength={10000}
            onSubmitEditing={() => sendPrompt()}
            blurOnSubmit={false}
          />
          {isStreaming ? (
            <Pressable
              onPress={abort}
              style={[styles.stopButton, { borderColor: theme.fg }]}
            >
              <Text style={[styles.stopButtonText, { color: theme.fg }]}>
                Stop
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => sendPrompt()}
              disabled={
                (!input.trim() && attachedImages.length === 0) || !isConnected
              }
              style={[
                styles.sendButton,
                {
                  backgroundColor: theme.fg,
                  opacity:
                    (!input.trim() && attachedImages.length === 0) ||
                    !isConnected
                      ? 0.3
                      : 1,
                },
              ]}
            >
              <Text style={[styles.sendButtonText, { color: theme.void }]}>
                Send
              </Text>
            </Pressable>
          )}
        </View>

        {/* Model picker modal */}
        <Modal
          visible={modelMenuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setModelMenuOpen(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setModelMenuOpen(false)}
          >
            <View
              style={[styles.modelMenu, { backgroundColor: theme.void, borderColor: theme.edge }]}
            >
              <Text style={[styles.modelMenuTitle, { color: theme.fg }]}>
                SELECT MODEL
              </Text>
              {availableModels.map((m) => (
                <Pressable
                  key={m.value}
                  onPress={() => {
                    setSelectedModel(m.value);
                    setModelMenuOpen(false);
                  }}
                  style={[
                    styles.modelMenuItem,
                    {
                      backgroundColor:
                        selectedModel === m.value ? theme.fg : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modelMenuItemName,
                      {
                        color:
                          selectedModel === m.value ? theme.void : theme.fg,
                      },
                    ]}
                  >
                    {m.displayName}
                  </Text>
                  <Text
                    style={[
                      styles.modelMenuItemDesc,
                      {
                        color:
                          selectedModel === m.value ? theme.void : theme.fg3,
                      },
                    ]}
                  >
                    {m.description}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>

        {/* Source control modal */}
        <SourceControlModal
          visible={scOpen}
          onClose={() => setScOpen(false)}
          relativePath={relativePath}
          onGenerateMessage={() =>
            sendPrompt(
              "Create a git commit for the currently staged changes, do not stage anything other than what is staged. Write a good conventional commit message yourself and commit it directly. Do not ask me for the message, just do it."
            )
          }
          canGenerate={isConnected && !isStreaming}
        />
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12, marginRight: 4 },
  headerButton: { padding: 4 },
  connectionDot: { width: 8, height: 8 },
  modelBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    gap: 10,
  },
  modelButton: { borderWidth: 2, paddingHorizontal: 10, paddingVertical: 4 },
  modelButtonText: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  statusText: { fontSize: 11 },
  messagesList: { padding: 16, paddingBottom: 8 },
  emptyChat: { paddingTop: 120, alignItems: "center" },
  emptyChatText: { fontSize: 18, fontWeight: "800", letterSpacing: 3 },
  emptyChatSub: { fontSize: 12, marginTop: 8 },
  eventRow: {
    borderLeftWidth: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
    flexDirection: "row",
    gap: 8,
  },
  eventLabel: { fontSize: 9, fontWeight: "700", width: 44, textTransform: "uppercase" },
  eventContent: { fontSize: 11, flex: 1, lineHeight: 16 },
  bubbleRow: { marginBottom: 8 },
  bubbleLeft: { alignItems: "flex-start" },
  bubbleRight: { alignItems: "flex-end" },
  bubble: { padding: 12 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  imageRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  attachedImage: { width: 120, height: 90, borderWidth: 1 },
  typingDots: { flexDirection: "row", gap: 4, padding: 4 },
  dot: { width: 6, height: 6 },
  approvalsContainer: { borderTopWidth: 2, padding: 16, gap: 8 },
  approvalCard: { borderWidth: 2, padding: 14 },
  approvalTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  approvalInput: { fontSize: 11, padding: 8, borderWidth: 1, marginBottom: 10, lineHeight: 16 },
  approvalButtons: { flexDirection: "row", gap: 8 },
  approvalAllow: { paddingHorizontal: 16, paddingVertical: 8 },
  approvalDeny: { paddingHorizontal: 16, paddingVertical: 8, borderWidth: 2 },
  imagePreviewRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1 },
  imagePreviewWrap: { position: "relative" },
  imagePreview: { width: 56, height: 56, borderWidth: 1 },
  imageRemove: { position: "absolute", top: -4, right: -4, width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: 1,
  },
  attachButton: { padding: 8 },
  textInput: {
    flex: 1,
    borderWidth: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: { paddingHorizontal: 16, paddingVertical: 10 },
  sendButtonText: { fontSize: 13, fontWeight: "700" },
  stopButton: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 2 },
  stopButtonText: { fontSize: 13, fontWeight: "700" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modelMenu: { borderWidth: 2, width: 280, maxHeight: 400 },
  modelMenuTitle: { fontSize: 10, fontWeight: "700", letterSpacing: 2, padding: 12, textTransform: "uppercase" },
  modelMenuItem: { paddingHorizontal: 16, paddingVertical: 10 },
  modelMenuItemName: { fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  modelMenuItemDesc: { fontSize: 11, marginTop: 2 },
});
