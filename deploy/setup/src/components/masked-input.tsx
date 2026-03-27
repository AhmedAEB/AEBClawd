import { useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  label: string;
  revealPrefix?: number;
  placeholder?: string;
  onSubmit: (value: string) => void;
}

export function MaskedInput({ label, revealPrefix = 0, placeholder = "", onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.return) {
      if (value.length > 0) onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor));
        setCursor((c) => c - 1);
      }
      return;
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v.slice(0, cursor) + input + v.slice(cursor));
      setCursor((c) => c + input.length);
    }
  });

  const display =
    value.length === 0
      ? placeholder
      : value.length <= revealPrefix
        ? value
        : value.slice(0, revealPrefix) + "*".repeat(value.length - revealPrefix);

  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      <Box>
        <Text>{value.length === 0 ? <Text dimColor>{display}</Text> : display}</Text>
        <Text inverse> </Text>
      </Box>
    </Box>
  );
}
