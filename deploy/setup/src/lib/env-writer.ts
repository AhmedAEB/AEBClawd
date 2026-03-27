import type { WizardConfig } from "../types.js";

export function generateEnvContent(config: WizardConfig): string {
  const lines: string[] = [
    "# AEBClawd Configuration",
    `# Generated on ${new Date().toISOString()}`,
    "",
    "# Required",
    ...(config.anthropicApiKey ? [`ANTHROPIC_API_KEY=${config.anthropicApiKey}`] : ["# ANTHROPIC_API_KEY not set — authenticate via: sudo -u aebclawd claude"]),
    `WORKSPACES_ROOT=${config.workspacesRoot}`,
    `DATA_DIR=${config.dataDir}`,
    `PORT=3001`,
    "",
  ];

  if (config.voiceEnabled) {
    lines.push("# Voice");
    lines.push("STT_URL=http://localhost:8001");
    lines.push("TTS_URL=http://localhost:8880");
    lines.push("TTS_VOICE=af_heart");
    lines.push("");
  }

  const { bots } = config;
  const hasBots = Object.keys(bots).length > 0;

  if (hasBots) {
    lines.push("# Bot integrations");
    if (bots.telegram) {
      lines.push(`TELEGRAM_BOT_TOKEN=${bots.telegram.token}`);
    }
    if (bots.slack) {
      lines.push(`SLACK_BOT_TOKEN=${bots.slack.botToken}`);
      lines.push(`SLACK_SIGNING_SECRET=${bots.slack.signingSecret}`);
    }
    if (bots.discord) {
      lines.push(`DISCORD_TOKEN=${bots.discord.token}`);
      lines.push(`DISCORD_PUBLIC_KEY=${bots.discord.publicKey}`);
    }
    if (bots.teams) {
      lines.push(`TEAMS_APP_ID=${bots.teams.appId}`);
      lines.push(`TEAMS_APP_PASSWORD=${bots.teams.appPassword}`);
    }
    if (bots.github) {
      lines.push(`GITHUB_TOKEN=${bots.github.token}`);
      lines.push(`GITHUB_WEBHOOK_SECRET=${bots.github.webhookSecret}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
