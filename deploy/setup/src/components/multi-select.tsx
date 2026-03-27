import { useState } from "react";
import { Box, Text, useInput } from "ink";

interface Item {
  label: string;
  value: string;
}

interface Props {
  items: Item[];
  onSubmit: (selected: string[]) => void;
  initialSelected?: string[];
}

export function MultiSelect({ items, onSubmit, initialSelected = [] }: Props) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (input === " ") {
      setSelected((s) => {
        const next = new Set(s);
        const val = items[cursor].value;
        if (next.has(val)) next.delete(val);
        else next.add(val);
        return next;
      });
    } else if (key.return) {
      onSubmit([...selected]);
    }
  });

  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Box key={item.value}>
          <Text color={i === cursor ? "white" : undefined} bold={i === cursor}>
            {i === cursor ? "> " : "  "}
          </Text>
          <Text>{selected.has(item.value) ? "[x]" : "[ ]"}</Text>
          <Text> {item.label}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>SPACE to toggle, ENTER to confirm</Text>
      </Box>
    </Box>
  );
}
