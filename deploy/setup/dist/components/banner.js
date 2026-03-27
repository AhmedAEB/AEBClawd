import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
const ASCII_ART = `
 █████  ███████ ██████   ██████ ██       █████  ██     ██ ██████
██   ██ ██      ██   ██ ██      ██      ██   ██ ██     ██ ██   ██
███████ █████   ██████  ██      ██      ███████ ██  █  ██ ██   ██
██   ██ ██      ██   ██ ██      ██      ██   ██ ██ ███ ██ ██   ██
██   ██ ███████ ██████   ██████ ███████ ██   ██  ███ ███  ██████`;
export function Banner() {
    return (_jsxs(Box, { flexDirection: "column", alignItems: "center", marginBottom: 1, children: [_jsx(Box, { borderStyle: "double", paddingX: 2, paddingY: 1, children: _jsx(Text, { bold: true, children: ASCII_ART }) }), _jsx(Text, { dimColor: true, children: "Self-hosted Claude Code Interface" })] }));
}
