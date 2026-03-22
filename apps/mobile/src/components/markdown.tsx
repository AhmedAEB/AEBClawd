import React from "react";
import { StyleSheet } from "react-native";
import MarkdownDisplay from "react-native-markdown-display";

import { useTheme } from "@/hooks/use-theme";
import { Fonts } from "@/constants/theme";

export function Markdown({ content }: { content: string }) {
  const theme = useTheme();

  const mdStyles = StyleSheet.create({
    body: {
      color: theme.fg2,
      fontSize: 14,
      lineHeight: 20,
    },
    heading1: {
      color: theme.fg,
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: 1,
      marginTop: 16,
      marginBottom: 8,
    },
    heading2: {
      color: theme.fg,
      fontSize: 17,
      fontWeight: "700",
      letterSpacing: 0.5,
      marginTop: 14,
      marginBottom: 6,
    },
    heading3: {
      color: theme.fg,
      fontSize: 15,
      fontWeight: "700",
      marginTop: 12,
      marginBottom: 4,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8,
    },
    strong: {
      color: theme.fg,
      fontWeight: "700",
    },
    em: {
      fontStyle: "italic",
    },
    link: {
      color: theme.fg,
      textDecorationLine: "underline" as const,
    },
    code_inline: {
      backgroundColor: theme.panel2,
      color: theme.fg,
      fontFamily: Fonts?.mono,
      fontSize: 13,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderWidth: 1,
      borderColor: theme.edge,
    },
    fence: {
      backgroundColor: theme.panel2,
      color: theme.fg,
      fontFamily: Fonts?.mono,
      fontSize: 12,
      lineHeight: 18,
      padding: 10,
      borderWidth: 1,
      borderColor: theme.edge,
      marginVertical: 8,
      borderRadius: 0,
    },
    code_block: {
      backgroundColor: theme.panel2,
      color: theme.fg,
      fontFamily: Fonts?.mono,
      fontSize: 12,
      lineHeight: 18,
      padding: 10,
      borderWidth: 1,
      borderColor: theme.edge,
      marginVertical: 8,
      borderRadius: 0,
    },
    blockquote: {
      borderLeftWidth: 2,
      borderLeftColor: theme.edge,
      paddingLeft: 12,
      marginLeft: 0,
      backgroundColor: "transparent",
    },
    bullet_list: {
      marginBottom: 8,
    },
    ordered_list: {
      marginBottom: 8,
    },
    list_item: {
      marginBottom: 4,
    },
    table: {
      borderWidth: 1,
      borderColor: theme.edge,
      marginVertical: 8,
    },
    thead: {
      backgroundColor: theme.panel2,
    },
    th: {
      borderWidth: 1,
      borderColor: theme.edge,
      padding: 6,
      fontWeight: "700",
    },
    td: {
      borderWidth: 1,
      borderColor: theme.edge,
      padding: 6,
    },
    hr: {
      backgroundColor: theme.edge,
      height: 1,
      marginVertical: 12,
    },
  });

  return <MarkdownDisplay style={mdStyles}>{content}</MarkdownDisplay>;
}
