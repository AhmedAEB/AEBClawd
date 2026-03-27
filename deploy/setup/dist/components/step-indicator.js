import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from "ink";
export function StepIndicator({ step, total }) {
    const barWidth = 32;
    const filled = Math.round((step / total) * barWidth);
    const empty = barWidth - filled;
    return (_jsxs(Box, { marginBottom: 1, children: [_jsxs(Text, { bold: true, children: ["[", step, "/", total, "]"] }), _jsx(Text, { children: " " }), _jsx(Text, { children: "━".repeat(filled) }), _jsx(Text, { dimColor: true, children: "━".repeat(empty) })] }));
}
