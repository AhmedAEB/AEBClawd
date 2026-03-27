import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { MaskedInput } from "../components/masked-input.js";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";
export function ApiKey() {
    const { dispatch } = useWizard();
    const [phase, setPhase] = useState("choose");
    const [error, setError] = useState("");
    const items = [
        { label: "Skip — log in via Claude CLI after install (recommended)", value: "skip" },
        { label: "Enter an API key manually", value: "manual" },
    ];
    const handleSelect = (item) => {
        if (item.value === "skip") {
            dispatch({ type: "SET_API_KEY", key: "" });
            dispatch({ type: "NEXT_STEP" });
        }
        else {
            setPhase("enter-key");
        }
    };
    const handleSubmit = (value) => {
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
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StepIndicator, { step: 3, total: TOTAL_STEPS }), _jsx(Text, { bold: true, children: "ANTHROPIC API KEY" }), _jsx(Box, { marginTop: 1, marginBottom: 1, children: _jsx(Text, { dimColor: true, children: "You can skip this and authenticate via the Claude Code CLI instead." }) }), phase === "choose" && _jsx(SelectInput, { items: items, onSelect: handleSelect }), phase === "enter-key" && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { dimColor: true, children: "This key will be stored in /opt/aebclawd/.env" }) }), _jsx(MaskedInput, { label: "Enter your Anthropic API key:", revealPrefix: 7, placeholder: "sk-ant-...", onSubmit: handleSubmit }), error && (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "red", children: error }) }))] }))] }));
}
