import { Box, Text, useInput } from "ink";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";

function maskKey(key: string, revealPrefix = 10, revealSuffix = 3): string {
  if (key.length <= revealPrefix + revealSuffix) return key;
  return key.slice(0, revealPrefix) + "..." + key.slice(-revealSuffix);
}

export function Review() {
  const { state, dispatch } = useWizard();
  const { config } = state;

  useInput((input, key) => {
    if (key.return) {
      dispatch({ type: "SET_STEP", step: 7 as any }); // Step.Installing
    }
    if (input === "b" || input === "B") {
      dispatch({ type: "SET_STEP", step: 1 as any }); // Back to Domain
    }
  });

  const domainDisplay =
    config.domain.mode === "domain"
      ? config.domain.domain || "not set"
      : config.domain.publicIp || "auto-detect";

  const sslDisplay = config.domain.mode === "domain" ? "Yes (Let's Encrypt)" : "No (HTTP only)";

  const botList = Object.keys(config.bots);
  const botsDisplay = botList.length > 0 ? botList.join(", ") : "None";

  return (
    <Box flexDirection="column">
      <StepIndicator step={7} total={TOTAL_STEPS} />
      <Text bold>REVIEW CONFIGURATION</Text>
      <Box
        marginTop={1}
        marginBottom={1}
        flexDirection="column"
        borderStyle="single"
        paddingX={2}
        paddingY={1}
      >
        <Row label="Domain" value={domainDisplay} />
        <Row label="SSL" value={sslDisplay} />
        <Row label="API Key" value={maskKey(config.anthropicApiKey)} />
        <Row label="Username" value={config.basicAuth.username} />
        <Row label="Password" value={"*".repeat(config.basicAuth.password.length)} />
        <Row label="Voice Mode" value={config.voiceEnabled ? "Enabled" : "Disabled"} />
        <Row label="Bots" value={botsDisplay} />
        <Row label="Install Dir" value={config.installDir} />
        <Row label="Workspaces" value={config.workspacesRoot} />
      </Box>
      <Box>
        <Text>Press </Text>
        <Text bold>ENTER</Text>
        <Text> to begin installation, or </Text>
        <Text bold>B</Text>
        <Text> to go back</Text>
      </Box>
    </Box>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const padded = label.padEnd(14);
  return (
    <Box>
      <Text dimColor>{padded}</Text>
      <Text>{value}</Text>
    </Box>
  );
}
