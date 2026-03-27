import { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { MaskedInput } from "../components/masked-input.js";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";

type Phase = "username" | "password";

export function BasicAuth() {
  const { state, dispatch } = useWizard();
  const [phase, setPhase] = useState<Phase>("username");
  const [username, setUsername] = useState(state.config.basicAuth.username);
  const [error, setError] = useState("");

  const handleUsernameSubmit = () => {
    const u = username.trim();
    if (!u) {
      setError("Username is required");
      return;
    }
    setError("");
    setPhase("password");
  };

  const handlePasswordSubmit = (password: string) => {
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError("");
    dispatch({
      type: "SET_BASIC_AUTH",
      config: { username: username.trim(), password },
    });
    dispatch({ type: "NEXT_STEP" });
  };

  return (
    <Box flexDirection="column">
      <StepIndicator step={4} total={TOTAL_STEPS} />
      <Text bold>BASIC AUTH CREDENTIALS</Text>
      <Box marginTop={1} marginBottom={1}>
        <Text dimColor>Protect your instance with HTTP Basic Auth</Text>
      </Box>

      {phase === "username" && (
        <Box flexDirection="column">
          <Text>Username:</Text>
          <TextInput
            value={username}
            onChange={setUsername}
            onSubmit={handleUsernameSubmit}
          />
        </Box>
      )}

      {phase === "password" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text>Username: </Text>
            <Text bold>{username}</Text>
          </Box>
          <MaskedInput
            label="Password (min 8 chars):"
            onSubmit={handlePasswordSubmit}
          />
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
    </Box>
  );
}
