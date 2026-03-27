import { useState } from "react";
import { Box, Text } from "ink";
import { MaskedInput } from "../components/masked-input.js";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";

export function ApiKey() {
  const { dispatch } = useWizard();
  const [error, setError] = useState("");

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed.startsWith("sk-ant-")) {
      setError("API key should start with sk-ant-");
      return;
    }
    if (trimmed.length < 20) {
      setError("API key seems too short");
      return;
    }
    setError("");
    dispatch({ type: "SET_API_KEY", key: trimmed });
    dispatch({ type: "NEXT_STEP" });
  };

  return (
    <Box flexDirection="column">
      <StepIndicator step={3} total={TOTAL_STEPS} />
      <Text bold>ANTHROPIC API KEY</Text>
      <Box marginTop={1} marginBottom={1}>
        <Text dimColor>This key will be stored in /opt/aebclawd/.env</Text>
      </Box>
      <MaskedInput
        label="Enter your Anthropic API key:"
        revealPrefix={7}
        placeholder="sk-ant-..."
        onSubmit={handleSubmit}
      />
      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
    </Box>
  );
}
