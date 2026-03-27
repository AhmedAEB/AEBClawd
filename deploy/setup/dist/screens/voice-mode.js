import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";
export function VoiceMode() {
    const { dispatch } = useWizard();
    const items = [
        { label: "No, text only", value: "no" },
        { label: "Yes, enable voice mode", value: "yes" },
    ];
    const handleSelect = (item) => {
        dispatch({ type: "SET_VOICE", enabled: item.value === "yes" });
        dispatch({ type: "NEXT_STEP" });
    };
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StepIndicator, { step: 5, total: TOTAL_STEPS }), _jsx(Text, { bold: true, children: "VOICE MODE" }), _jsxs(Box, { marginTop: 1, marginBottom: 1, flexDirection: "column", children: [_jsx(Text, { children: "Enable speech-to-text and text-to-speech?" }), _jsx(Text, { dimColor: true, children: "Requires Docker (~2GB disk, ~1GB RAM)" })] }), _jsx(SelectInput, { items: items, onSelect: handleSelect })] }));
}
