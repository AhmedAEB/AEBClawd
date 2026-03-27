import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { MaskedInput } from "../components/masked-input.js";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";
export function BasicAuth() {
    const { state, dispatch } = useWizard();
    const [phase, setPhase] = useState("username");
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
    const handlePasswordSubmit = (password) => {
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
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StepIndicator, { step: 4, total: TOTAL_STEPS }), _jsx(Text, { bold: true, children: "BASIC AUTH CREDENTIALS" }), _jsx(Box, { marginTop: 1, marginBottom: 1, children: _jsx(Text, { dimColor: true, children: "Protect your instance with HTTP Basic Auth" }) }), phase === "username" && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: "Username:" }), _jsx(TextInput, { value: username, onChange: setUsername, onSubmit: handleUsernameSubmit })] })), phase === "password" && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { children: "Username: " }), _jsx(Text, { bold: true, children: username })] }), _jsx(MaskedInput, { label: "Password (min 8 chars):", onSubmit: handlePasswordSubmit })] })), error && (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "red", children: error }) }))] }));
}
