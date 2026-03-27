import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { StepIndicator } from "../components/step-indicator.js";
import { StepLine } from "../components/step-line.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS, Step } from "../types.js";
import * as commands from "../lib/commands.js";
const STEP_COMMANDS = {
    user: () => commands.createUser(),
    dirs: (config) => commands.createDirectories(config),
    env: (config) => commands.writeEnv(config),
    "caddy-install": () => commands.installCaddy(),
    caddyfile: (config) => commands.writeCaddyfile(config),
    docker: () => commands.installDocker(),
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
    const [failedStepId, setFailedStepId] = useState(null);
    useInput((input) => {
        if (failedStepId) {
            if (input === "r" || input === "R") {
                setFailedStepId(null);
                dispatch({ type: "UPDATE_INSTALL_STEP", id: failedStepId, status: "pending" });
                // Will re-trigger the effect
            }
            else if (input === "s" || input === "S") {
                dispatch({ type: "UPDATE_INSTALL_STEP", id: failedStepId, status: "skipped" });
                setFailedStepId(null);
            }
            else if (input === "a" || input === "A") {
                process.exit(1);
            }
        }
    });
    useEffect(() => {
        if (runningRef.current || failedStepId)
            return;
        runningRef.current = true;
        (async () => {
            for (const step of installSteps) {
                if (step.status === "done" || step.status === "skipped")
                    continue;
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
                }
                catch (err) {
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
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StepIndicator, { step: 8, total: TOTAL_STEPS }), _jsx(Text, { bold: true, children: "INSTALLING" }), _jsx(Box, { marginTop: 1, flexDirection: "column", children: installSteps.map((step) => (_jsx(StepLine, { label: step.label, status: step.status, error: step.error }, step.id))) }), failedStepId && (_jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { bold: true, color: "red", children: "Step failed. Choose an action:" }), _jsx(Text, { children: "[R]etry / [S]kip / [A]bort" })] })), _jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: "Full log: /tmp/aebclawd-install.log" }) })] }));
}
