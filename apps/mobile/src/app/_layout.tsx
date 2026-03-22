import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import React from "react";
import { useColorScheme } from "react-native";

import { ConfigProvider } from "@/lib/config-context";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ConfigProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="browse"
            options={{ headerShown: true, title: "Browse", headerBackTitle: "Back" }}
          />
          <Stack.Screen
            name="sessions"
            options={{ headerShown: true, title: "Sessions", headerBackTitle: "Back" }}
          />
          <Stack.Screen
            name="chat/[sessionId]"
            options={{ headerShown: true, title: "Chat", headerBackTitle: "Back" }}
          />
        </Stack>
      </ThemeProvider>
    </ConfigProvider>
  );
}
