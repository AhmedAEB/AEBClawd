import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";
import { execaSync } from "execa";
export function Domain() {
    const { state, dispatch } = useWizard();
    const [phase, setPhase] = useState("choose");
    const [domain, setDomain] = useState(state.config.domain.domain || "");
    const [detectedIp, setDetectedIp] = useState("");
    const [error, setError] = useState("");
    const items = [
        { label: "Enter a domain name (HTTPS via Let's Encrypt)", value: "domain" },
        { label: "Use IP address only (HTTP, no TLS)", value: "ip-only" },
    ];
    const handleModeSelect = (item) => {
        if (item.value === "domain") {
            setPhase("enter-domain");
        }
        else {
            setPhase("detect-ip");
            try {
                const result = execaSync("curl", ["-s4", "--max-time", "5", "ifconfig.me"]);
                setDetectedIp(result.stdout.trim());
                setPhase("confirm-ip");
            }
            catch {
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
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StepIndicator, { step: 2, total: TOTAL_STEPS }), _jsx(Text, { bold: true, children: "DOMAIN CONFIGURATION" }), _jsx(Box, { marginTop: 1, marginBottom: 1, children: _jsx(Text, { children: "How will you access AEBClawd?" }) }), phase === "choose" && _jsx(SelectInput, { items: items, onSelect: handleModeSelect }), phase === "enter-domain" && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: "Domain name:" }), _jsx(Box, { children: _jsx(TextInput, { value: domain, onChange: setDomain, onSubmit: submitDomain }) }), error && _jsx(Text, { color: "red", children: error }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: "e.g., claude.example.com (DNS must point to this server)" }) })] })), phase === "detect-ip" && (_jsxs(Box, { children: [_jsx(Spinner, { type: "dots" }), _jsx(Text, { children: " Detecting public IP..." })] })), phase === "confirm-ip" && (_jsx(ConfirmIp, { ip: detectedIp, onConfirm: confirmIp }))] }));
}
function ConfirmIp({ ip, onConfirm }) {
    useInput((_input, key) => {
        if (key.return)
            onConfirm();
    });
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Text, { children: "Public IP: " }), _jsx(Text, { bold: true, children: ip })] }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "yellow", children: "Warning: IP-only mode uses HTTP (unencrypted). Suitable for testing only." }) }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { children: "Press " }), _jsx(Text, { bold: true, children: "ENTER" }), _jsx(Text, { children: " to continue..." })] })] }));
}
