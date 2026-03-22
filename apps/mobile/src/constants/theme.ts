import "@/global.css";

import { Platform } from "react-native";

/**
 * Brutalist design tokens matching the web frontend.
 * Black and white only, sharp corners, solid borders.
 */
export const Colors = {
  light: {
    fg: "#000000",
    fg2: "#333333",
    fg3: "#666666",
    void: "#FFFFFF",
    panel: "#FFFFFF",
    panel2: "#F5F5F5",
    panel3: "#EBEBEB",
    edge: "#000000",
    // Backwards compat with template components
    text: "#000000",
    background: "#FFFFFF",
    backgroundElement: "#F5F5F5",
    backgroundSelected: "#EBEBEB",
    textSecondary: "#666666",
  },
  dark: {
    fg: "#FFFFFF",
    fg2: "#CCCCCC",
    fg3: "#999999",
    void: "#000000",
    panel: "#000000",
    panel2: "#1A1A1A",
    panel3: "#2A2A2A",
    edge: "#FFFFFF",
    text: "#FFFFFF",
    background: "#000000",
    backgroundElement: "#1A1A1A",
    backgroundSelected: "#2A2A2A",
    textSecondary: "#999999",
  },
} as const;

export type ThemeColor = keyof (typeof Colors)["light"] &
  keyof (typeof Colors)["dark"];

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset =
  Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
