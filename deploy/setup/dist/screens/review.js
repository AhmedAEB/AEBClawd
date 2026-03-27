import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useInput } from "ink";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";
function maskKey(key, revealPrefix = 10, revealSuffix = 3) {
    if (key.length <= revealPrefix + revealSuffix)
        return key;
    return key.slice(0, revealPrefix) + "..." + key.slice(-revealSuffix);
}
export function Review() {
    const { state, dispatch } = useWizard();
    const { config } = state;
    useInput((input, key) => {
        if (key.return) {
            dispatch({ type: "SET_STEP", step: 7 }); // Step.Installing
        }
        if (input === "b" || input === "B") {
            dispatch({ type: "SET_STEP", step: 1 }); // Back to Domain
        }
    });
    const domainDisplay = config.domain.mode === "domain"
        ? config.domain.domain || "not set"
        : config.domain.publicIp || "auto-detect";
    const sslDisplay = config.domain.mode === "domain" ? "Yes (Let's Encrypt)" : "No (HTTP only)";
    const botList = Object.keys(config.bots);
    const botsDisplay = botList.length > 0 ? botList.join(", ") : "None";
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StepIndicator, { step: 7, total: TOTAL_STEPS }), _jsx(Text, { bold: true, children: "REVIEW CONFIGURATION" }), _jsxs(Box, { marginTop: 1, marginBottom: 1, flexDirection: "column", borderStyle: "single", paddingX: 2, paddingY: 1, children: [_jsx(Row, { label: "Domain", value: domainDisplay }), _jsx(Row, { label: "SSL", value: sslDisplay }), _jsx(Row, { label: "API Key", value: maskKey(config.anthropicApiKey) }), _jsx(Row, { label: "Username", value: config.basicAuth.username }), _jsx(Row, { label: "Password", value: "*".repeat(config.basicAuth.password.length) }), _jsx(Row, { label: "Voice Mode", value: config.voiceEnabled ? "Enabled" : "Disabled" }), _jsx(Row, { label: "Bots", value: botsDisplay }), _jsx(Row, { label: "Install Dir", value: config.installDir }), _jsx(Row, { label: "Workspaces", value: config.workspacesRoot })] }), _jsxs(Box, { children: [_jsx(Text, { children: "Press " }), _jsx(Text, { bold: true, children: "ENTER" }), _jsx(Text, { children: " to begin installation, or " }), _jsx(Text, { bold: true, children: "B" }), _jsx(Text, { children: " to go back" })] })] }));
}
function Row({ label, value }) {
    const padded = label.padEnd(14);
    return (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: padded }), _jsx(Text, { children: value })] }));
}
