import { Box, Text } from "ink";
import Spinner from "ink-spinner";

interface Props {
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  error?: string;
}

export function StepLine({ label, status, error }: Props) {
  return (
    <Box flexDirection="column">
      <Box>
        {status === "pending" && <Text dimColor>{"  "}</Text>}
        {status === "running" && (
          <Text color="white">
            <Spinner type="dots" />
          </Text>
        )}
        {status === "done" && <Text color="green">{"✓ "}</Text>}
        {status === "failed" && <Text color="red">{"✗ "}</Text>}
        {status === "skipped" && <Text color="yellow">{"- "}</Text>}
        <Text
          dimColor={status === "pending" || status === "skipped"}
          bold={status === "running"}
        >
          {label}
        </Text>
        {status === "skipped" && <Text dimColor> (skipped)</Text>}
      </Box>
      {status === "failed" && error && (
        <Box marginLeft={4}>
          <Text color="red">{error}</Text>
        </Box>
      )}
    </Box>
  );
}
