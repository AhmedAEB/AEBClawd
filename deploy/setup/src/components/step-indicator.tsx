import { Box, Text } from "ink";

interface Props {
  step: number;
  total: number;
}

export function StepIndicator({ step, total }: Props) {
  const barWidth = 32;
  const filled = Math.round((step / total) * barWidth);
  const empty = barWidth - filled;

  return (
    <Box marginBottom={1}>
      <Text bold>
        [{step}/{total}]
      </Text>
      <Text> </Text>
      <Text>{"━".repeat(filled)}</Text>
      <Text dimColor>{"━".repeat(empty)}</Text>
    </Box>
  );
}
