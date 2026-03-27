import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
export function StepLine({ label, status, error }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [status === "pending" && _jsx(Text, { dimColor: true, children: "  " }), status === "running" && (_jsx(Text, { color: "white", children: _jsx(Spinner, { type: "dots" }) })), status === "done" && _jsx(Text, { color: "green", children: "✓ " }), status === "failed" && _jsx(Text, { color: "red", children: "✗ " }), status === "skipped" && _jsx(Text, { color: "yellow", children: "- " }), _jsx(Text, { dimColor: status === "pending" || status === "skipped", bold: status === "running", children: label }), status === "skipped" && _jsx(Text, { dimColor: true, children: " (skipped)" })] }), status === "failed" && error && (_jsx(Box, { marginLeft: 4, children: _jsx(Text, { color: "red", children: error }) }))] }));
}
