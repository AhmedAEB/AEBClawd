import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useInput } from "ink";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";
export function Done() {
    const { state } = useWizard();
    const { config } = state;
    useInput(() => {
        process.exit(0);
    });
    const url = config.domain.mode === "domain"
        ? `https://${config.domain.domain}`
        : `http://${config.domain.publicIp || "YOUR_IP"}`;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StepIndicator, { step: 9, total: TOTAL_STEPS }), _jsx(Box, { marginBottom: 1, children: _jsx(Text, { bold: true, color: "green", children: "INSTALLATION COMPLETE" }) }), _jsxs(Box, { flexDirection: "column", borderStyle: "single", paddingX: 2, paddingY: 1, children: [_jsx(Text, { children: "AEBClawd is running at:" }), _jsx(Text, { bold: true, children: url }), _jsx(Text, {}), _jsxs(Text, { children: ["Username: ", config.basicAuth.username] }), _jsxs(Text, { children: ["Password: ", "*".repeat(config.basicAuth.password.length)] })] }), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsx(Text, { bold: true, children: "USEFUL COMMANDS" }), _jsx(Text, {}), _jsx(Text, { dimColor: true, children: "Check status:" }), _jsx(Text, { children: "  systemctl status aebclawd-server" }), _jsx(Text, { children: "  systemctl status aebclawd-frontend" }), _jsx(Text, {}), _jsx(Text, { dimColor: true, children: "View logs:" }), _jsx(Text, { children: "  journalctl -u aebclawd-server -f" }), _jsx(Text, { children: "  journalctl -u aebclawd-frontend -f" }), _jsx(Text, {}), _jsx(Text, { dimColor: true, children: "Update:" }), _jsx(Text, { children: "  sudo /opt/aebclawd/deploy/update.sh" }), _jsx(Text, {}), _jsx(Text, { dimColor: true, children: "Reconfigure:" }), _jsx(Text, { children: "  sudo node /opt/aebclawd/deploy/setup/dist/index.js" })] }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: "Full install log: /tmp/aebclawd-install.log" }) }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { children: "Press any key to exit..." }) })] }));
}
