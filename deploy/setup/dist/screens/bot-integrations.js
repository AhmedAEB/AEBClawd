import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text } from "ink";
import { MultiSelect } from "../components/multi-select.js";
import { MaskedInput } from "../components/masked-input.js";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";
const BOT_PLATFORMS = [
    { label: "Telegram", value: "telegram" },
    { label: "Slack", value: "slack" },
    { label: "Discord", value: "discord" },
    { label: "Microsoft Teams", value: "teams" },
    { label: "GitHub", value: "github" },
];
const BOT_FIELDS = {
    telegram: [{ platform: "telegram", field: "token", label: "Bot Token", envKey: "TELEGRAM_BOT_TOKEN" }],
    slack: [
        { platform: "slack", field: "botToken", label: "Bot Token", envKey: "SLACK_BOT_TOKEN" },
        { platform: "slack", field: "signingSecret", label: "Signing Secret", envKey: "SLACK_SIGNING_SECRET" },
    ],
    discord: [
        { platform: "discord", field: "token", label: "Bot Token", envKey: "DISCORD_TOKEN" },
        { platform: "discord", field: "publicKey", label: "Public Key", envKey: "DISCORD_PUBLIC_KEY" },
    ],
    teams: [
        { platform: "teams", field: "appId", label: "App ID", envKey: "TEAMS_APP_ID" },
        { platform: "teams", field: "appPassword", label: "App Password", envKey: "TEAMS_APP_PASSWORD" },
    ],
    github: [
        { platform: "github", field: "token", label: "Token", envKey: "GITHUB_TOKEN" },
        { platform: "github", field: "webhookSecret", label: "Webhook Secret", envKey: "GITHUB_WEBHOOK_SECRET" },
    ],
};
export function BotIntegrations() {
    const { dispatch } = useWizard();
    const [phase, setPhase] = useState("select");
    const [selectedPlatforms, setSelectedPlatforms] = useState([]);
    const [currentFieldIdx, setCurrentFieldIdx] = useState(0);
    const [collectedValues, setCollectedValues] = useState({});
    const allFields = selectedPlatforms.flatMap((p) => BOT_FIELDS[p] || []);
    const handlePlatformSelect = (selected) => {
        if (selected.length === 0) {
            dispatch({ type: "SET_BOTS", config: {} });
            dispatch({ type: "NEXT_STEP" });
            return;
        }
        setSelectedPlatforms(selected);
        setPhase("configure");
    };
    const handleFieldSubmit = (value) => {
        const field = allFields[currentFieldIdx];
        setCollectedValues((prev) => ({
            ...prev,
            [field.platform]: { ...(prev[field.platform] || {}), [field.field]: value },
        }));
        if (currentFieldIdx + 1 >= allFields.length) {
            // All fields collected — build BotConfig
            const updatedValues = {
                ...collectedValues,
                [field.platform]: { ...(collectedValues[field.platform] || {}), [field.field]: value },
            };
            const config = {};
            for (const platform of selectedPlatforms) {
                const vals = updatedValues[platform] || {};
                switch (platform) {
                    case "telegram":
                        config.telegram = { token: vals.token || "" };
                        break;
                    case "slack":
                        config.slack = { botToken: vals.botToken || "", signingSecret: vals.signingSecret || "" };
                        break;
                    case "discord":
                        config.discord = { token: vals.token || "", publicKey: vals.publicKey || "" };
                        break;
                    case "teams":
                        config.teams = { appId: vals.appId || "", appPassword: vals.appPassword || "" };
                        break;
                    case "github":
                        config.github = { token: vals.token || "", webhookSecret: vals.webhookSecret || "" };
                        break;
                }
            }
            dispatch({ type: "SET_BOTS", config });
            dispatch({ type: "NEXT_STEP" });
        }
        else {
            setCurrentFieldIdx((i) => i + 1);
        }
    };
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StepIndicator, { step: 6, total: TOTAL_STEPS }), _jsx(Text, { bold: true, children: "BOT INTEGRATIONS" }), _jsx(Box, { marginTop: 1, marginBottom: 1, children: _jsx(Text, { dimColor: true, children: "Optional: connect chat platforms to Claude" }) }), phase === "select" && (_jsx(MultiSelect, { items: BOT_PLATFORMS, onSubmit: handlePlatformSelect })), phase === "configure" && allFields[currentFieldIdx] && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: allFields[currentFieldIdx].platform.toUpperCase() }), _jsx(MaskedInput, { label: `${allFields[currentFieldIdx].label}:`, revealPrefix: 4, onSubmit: handleFieldSubmit }, `${allFields[currentFieldIdx].platform}-${allFields[currentFieldIdx].field}`), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { dimColor: true, children: ["Field ", currentFieldIdx + 1, " of ", allFields.length] }) })] }))] }));
}
