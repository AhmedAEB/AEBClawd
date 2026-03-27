import { useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { MaskedInput } from "../components/masked-input.js";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";

type Phase = "choose" | "enter-key";

export function ApiKey() {
  const { dispatch } = useWizard();
  const [phase, setPhase] = useState<Phase>("choose");
  const [error, setError] = useState("");

  const items = [
    { label: "Skip — log in via Claude CLI after install (recommended)", value: "skip" },
    { label: "Enter an API key manually", value: "manual" },
  ];

  const handleSelect = (item: { value: string }) => {
    if (item.value === "skip") {
      dispatch({ type: "SET_API_KEY", key: "" });
      dispatch({ type: "NEXT_STEP" });
    } else {
      setPhase("enter-key");
    }
  };

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
        <Text dimColor>
          You can skip this and authenticate via the Claude Code CLI instead.
        </Text>
      </Box>

      {phase === "choose" && <SelectInput items={items} onSelect={handleSelect} />}

      {phase === "enter-key" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
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
      )}
    </Box>
  );
}
