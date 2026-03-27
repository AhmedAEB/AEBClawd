import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { Banner } from "../components/banner.js";
import { useWizard } from "../hooks/use-wizard.js";
import { detectExistingInstall } from "../hooks/use-detect-existing.js";
export function Welcome() {
    const { state, dispatch } = useWizard();
    useEffect(() => {
        const existing = detectExistingInstall();
        dispatch({ type: "SET_EXISTING", existing });
    }, [dispatch]);
    if (state.existing.found) {
        return _jsx(ExistingInstallPrompt, {});
    }
    return _jsx(FreshInstallPrompt, {});
}
function FreshInstallPrompt() {
    const { dispatch } = useWizard();
    useInput((_input, key) => {
        if (key.return) {
            dispatch({ type: "NEXT_STEP" });
        }
    });
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Banner, {}), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { children: "Press " }), _jsx(Text, { bold: true, children: "ENTER" }), _jsx(Text, { children: " to begin setup..." })] })] }));
}
function ExistingInstallPrompt() {
    const { dispatch } = useWizard();
    const items = [
        { label: "Reconfigure (update settings, rebuild)", value: "reconfigure" },
        { label: "Fresh install (start from scratch)", value: "fresh" },
        { label: "Quit", value: "quit" },
    ];
    const handleSelect = (item) => {
        if (item.value === "quit") {
            process.exit(0);
        }
        // Both reconfigure and fresh go to domain screen
        dispatch({ type: "NEXT_STEP" });
    };
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Banner, {}), _jsx(Box, { marginTop: 1, marginBottom: 1, children: _jsx(Text, { color: "yellow", children: "Existing installation detected at /opt/aebclawd" }) }), _jsx(SelectInput, { items: items, onSelect: handleSelect })] }));
}
