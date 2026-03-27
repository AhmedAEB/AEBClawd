import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { StepIndicator } from "../components/step-indicator.js";
import { StepLine } from "../components/step-line.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS, Step } from "../types.js";
import * as commands from "../lib/commands.js";

type CommandFn = (config: any) => Promise<void>;

const STEP_COMMANDS: Record<string, CommandFn> = {
  user: () => commands.createUser(),
  dirs: (config) => commands.createDirectories(config),
  env: (config) => commands.writeEnv(config),
  "caddy-install": () => commands.installCaddy(),
  caddyfile: (config) => commands.writeCaddyfile(config),
  docker: () => commands.installDocker(),
  "claude-cli": () => commands.installClaudeCli(),
  "pnpm-install": (config) => commands.installDeps(config),
  "build-frontend": (config) => commands.buildFrontend(config),
  "build-server": (config) => commands.buildServer(config),
  "build-bot": (config) => commands.buildBot(config),
  systemd: (config) => commands.installSystemdServices(config),
  firewall: () => commands.configureFirewall(),
  "voice-containers": (config) => commands.startVoiceContainers(config),
  start: (config) => commands.startServices(config),
};

export function InstallProgress() {
  const { state, dispatch } = useWizard();
  const { config, installSteps } = state;
  const runningRef = useRef(false);
  const [failedStepId, setFailedStepId] = useState<string | null>(null);

  useInput((input) => {
    if (failedStepId) {
      if (input === "r" || input === "R") {
        setFailedStepId(null);
        dispatch({ type: "UPDATE_INSTALL_STEP", id: failedStepId, status: "pending" });
        // Will re-trigger the effect
      } else if (input === "s" || input === "S") {
        dispatch({ type: "UPDATE_INSTALL_STEP", id: failedStepId, status: "skipped" });
        setFailedStepId(null);
      } else if (input === "a" || input === "A") {
        process.exit(1);
      }
    }
  });

  useEffect(() => {
    if (runningRef.current || failedStepId) return;
    runningRef.current = true;

    (async () => {
      for (const step of installSteps) {
        if (step.status === "done" || step.status === "skipped") continue;

        // Check condition
        if (step.condition && !step.condition(config)) {
          dispatch({ type: "UPDATE_INSTALL_STEP", id: step.id, status: "skipped" });
          continue;
        }

        dispatch({ type: "UPDATE_INSTALL_STEP", id: step.id, status: "running" });

        const commandFn = STEP_COMMANDS[step.id];
        if (!commandFn) {
          dispatch({ type: "UPDATE_INSTALL_STEP", id: step.id, status: "skipped" });
          continue;
        }

        try {
          await commandFn(config);
          dispatch({ type: "UPDATE_INSTALL_STEP", id: step.id, status: "done" });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          dispatch({
            type: "UPDATE_INSTALL_STEP",
            id: step.id,
            status: "failed",
            error: errorMsg.slice(0, 200),
          });
          setFailedStepId(step.id);
          runningRef.current = false;
          return;
        }
      }

      // All done
      dispatch({ type: "SET_STEP", step: Step.Done });
      runningRef.current = false;
    })();
  }, [installSteps, config, dispatch, failedStepId]);

  return (
    <Box flexDirection="column">
      <StepIndicator step={8} total={TOTAL_STEPS} />
      <Text bold>INSTALLING</Text>
      <Box marginTop={1} flexDirection="column">
        {installSteps.map((step) => (
          <StepLine
            key={step.id}
            label={step.label}
            status={step.status}
            error={step.error}
          />
        ))}
      </Box>

      {failedStepId && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="red">
            Step failed. Choose an action:
          </Text>
          <Text>
            [R]etry / [S]kip / [A]bort
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Full log: /tmp/aebclawd-install.log</Text>
      </Box>
    </Box>
  );
}
