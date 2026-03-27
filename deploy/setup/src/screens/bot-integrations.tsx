import { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { MultiSelect } from "../components/multi-select.js";
import { MaskedInput } from "../components/masked-input.js";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS, type BotConfig } from "../types.js";

const BOT_PLATFORMS = [
  { label: "Telegram", value: "telegram" },
  { label: "Slack", value: "slack" },
  { label: "Discord", value: "discord" },
  { label: "Microsoft Teams", value: "teams" },
  { label: "GitHub", value: "github" },
];

interface BotField {
  platform: string;
  field: string;
  label: string;
  envKey: string;
}

const BOT_FIELDS: Record<string, BotField[]> = {
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

type Phase = "select" | "configure";

export function BotIntegrations() {
  const { dispatch } = useWizard();
  const [phase, setPhase] = useState<Phase>("select");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [currentFieldIdx, setCurrentFieldIdx] = useState(0);
  const [collectedValues, setCollectedValues] = useState<Record<string, Record<string, string>>>({});

  const allFields = selectedPlatforms.flatMap((p) => BOT_FIELDS[p] || []);

  const handlePlatformSelect = (selected: string[]) => {
    if (selected.length === 0) {
      dispatch({ type: "SET_BOTS", config: {} });
      dispatch({ type: "NEXT_STEP" });
      return;
    }
    setSelectedPlatforms(selected);
    setPhase("configure");
  };

  const handleFieldSubmit = (value: string) => {
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
      const config: BotConfig = {};
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
    } else {
      setCurrentFieldIdx((i) => i + 1);
    }
  };

  return (
    <Box flexDirection="column">
      <StepIndicator step={6} total={TOTAL_STEPS} />
      <Text bold>BOT INTEGRATIONS</Text>
      <Box marginTop={1} marginBottom={1}>
        <Text dimColor>Optional: connect chat platforms to Claude</Text>
      </Box>

      {phase === "select" && (
        <MultiSelect items={BOT_PLATFORMS} onSubmit={handlePlatformSelect} />
      )}

      {phase === "configure" && allFields[currentFieldIdx] && (
        <Box flexDirection="column">
          <Text bold>
            {allFields[currentFieldIdx].platform.toUpperCase()}
          </Text>
          <MaskedInput
            key={`${allFields[currentFieldIdx].platform}-${allFields[currentFieldIdx].field}`}
            label={`${allFields[currentFieldIdx].label}:`}
            revealPrefix={4}
            onSubmit={handleFieldSubmit}
          />
          <Box marginTop={1}>
            <Text dimColor>
              Field {currentFieldIdx + 1} of {allFields.length}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
