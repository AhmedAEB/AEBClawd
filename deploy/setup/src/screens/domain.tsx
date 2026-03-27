import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";
import { execaSync } from "execa";

type Phase = "choose" | "enter-domain" | "detect-ip" | "confirm-ip";

export function Domain() {
  const { state, dispatch } = useWizard();
  const [phase, setPhase] = useState<Phase>("choose");
  const [domain, setDomain] = useState(state.config.domain.domain || "");
  const [detectedIp, setDetectedIp] = useState("");
  const [error, setError] = useState("");

  const items = [
    { label: "Enter a domain name (HTTPS via Let's Encrypt)", value: "domain" },
    { label: "Use IP address only (HTTP, no TLS)", value: "ip-only" },
  ];

  const handleModeSelect = (item: { value: string }) => {
    if (item.value === "domain") {
      setPhase("enter-domain");
    } else {
      setPhase("detect-ip");
      try {
        const result = execaSync("curl", ["-s4", "--max-time", "5", "ifconfig.me"]);
        setDetectedIp(result.stdout.trim());
        setPhase("confirm-ip");
      } catch {
        setDetectedIp("Could not detect IP");
        setPhase("confirm-ip");
      }
    }
  };

  const submitDomain = () => {
    const d = domain.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(\.[a-z]{2,})+$/.test(d)) {
      setError("Invalid domain format");
      return;
    }
    dispatch({ type: "SET_DOMAIN", config: { mode: "domain", domain: d } });
    dispatch({ type: "NEXT_STEP" });
  };

  const confirmIp = () => {
    dispatch({ type: "SET_DOMAIN", config: { mode: "ip-only", publicIp: detectedIp } });
    dispatch({ type: "NEXT_STEP" });
  };

  return (
    <Box flexDirection="column">
      <StepIndicator step={2} total={TOTAL_STEPS} />
      <Text bold>DOMAIN CONFIGURATION</Text>
      <Box marginTop={1} marginBottom={1}>
        <Text>How will you access AEBClawd?</Text>
      </Box>

      {phase === "choose" && <SelectInput items={items} onSelect={handleModeSelect} />}

      {phase === "enter-domain" && (
        <Box flexDirection="column">
          <Text>Domain name:</Text>
          <Box>
            <TextInput value={domain} onChange={setDomain} onSubmit={submitDomain} />
          </Box>
          {error && <Text color="red">{error}</Text>}
          <Box marginTop={1}>
            <Text dimColor>e.g., claude.example.com (DNS must point to this server)</Text>
          </Box>
        </Box>
      )}

      {phase === "detect-ip" && (
        <Box>
          <Spinner type="dots" />
          <Text> Detecting public IP...</Text>
        </Box>
      )}

      {phase === "confirm-ip" && (
        <ConfirmIp ip={detectedIp} onConfirm={confirmIp} />
      )}
    </Box>
  );
}

function ConfirmIp({ ip, onConfirm }: { ip: string; onConfirm: () => void }) {
  useInput((_input, key) => {
    if (key.return) onConfirm();
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text>Public IP: </Text>
        <Text bold>{ip}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="yellow">
          Warning: IP-only mode uses HTTP (unencrypted). Suitable for testing only.
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>Press </Text>
        <Text bold>ENTER</Text>
        <Text> to continue...</Text>
      </Box>
    </Box>
  );
}
