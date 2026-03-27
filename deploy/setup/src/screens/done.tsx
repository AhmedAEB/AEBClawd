import { Box, Text, useInput } from "ink";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";

export function Done() {
  const { state } = useWizard();
  const { config } = state;

  useInput(() => {
    process.exit(0);
  });

  const url =
    config.domain.mode === "domain"
      ? `https://${config.domain.domain}`
      : `http://${config.domain.publicIp || "YOUR_IP"}`;

  return (
    <Box flexDirection="column">
      <StepIndicator step={9} total={TOTAL_STEPS} />

      <Box marginBottom={1}>
        <Text bold color="green">
          INSTALLATION COMPLETE
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="single"
        paddingX={2}
        paddingY={1}
      >
        <Text>AEBClawd is running at:</Text>
        <Text bold>{url}</Text>
        <Text />
        <Text>Username: {config.basicAuth.username}</Text>
        <Text>Password: {"*".repeat(config.basicAuth.password.length)}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>USEFUL COMMANDS</Text>
        <Text />
        <Text dimColor>Check status:</Text>
        <Text>  systemctl status aebclawd-server</Text>
        <Text>  systemctl status aebclawd-frontend</Text>
        <Text />
        <Text dimColor>View logs:</Text>
        <Text>  journalctl -u aebclawd-server -f</Text>
        <Text>  journalctl -u aebclawd-frontend -f</Text>
        <Text />
        <Text dimColor>Update:</Text>
        <Text>  sudo /opt/aebclawd/deploy/update.sh</Text>
        <Text />
        <Text dimColor>Reconfigure:</Text>
        <Text>  sudo node /opt/aebclawd/deploy/setup/dist/index.js</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Full install log: /tmp/aebclawd-install.log</Text>
      </Box>

      <Box marginTop={1}>
        <Text>Press any key to exit...</Text>
      </Box>
    </Box>
  );
}
