export enum Step {
  Welcome = 0,
  Domain = 1,
  ApiKey = 2,
  BasicAuth = 3,
  VoiceMode = 4,
  BotIntegrations = 5,
  Review = 6,
  Installing = 7,
  Done = 8,
}

export const TOTAL_STEPS = 9;

export interface DomainConfig {
  mode: "domain" | "ip-only";
  domain?: string;
  publicIp?: string;
}

export interface BasicAuthConfig {
  username: string;
  password: string;
}

export interface BotConfig {
  telegram?: { token: string };
  slack?: { botToken: string; signingSecret: string };
  discord?: { token: string; publicKey: string };
  teams?: { appId: string; appPassword: string };
  github?: { token: string; webhookSecret: string };
}

export interface WizardConfig {
  domain: DomainConfig;
  anthropicApiKey: string;
  basicAuth: BasicAuthConfig;
  voiceEnabled: boolean;
  bots: BotConfig;
  installDir: string;
  workspacesRoot: string;
  dataDir: string;
}

export interface InstallStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  error?: string;
  condition?: (config: WizardConfig) => boolean;
}

export interface ExistingInstall {
  found: boolean;
  envPath?: string;
  envVars?: Record<string, string>;
}

export type WizardAction =
  | { type: "SET_STEP"; step: Step }
  | { type: "SET_DOMAIN"; config: DomainConfig }
  | { type: "SET_API_KEY"; key: string }
  | { type: "SET_BASIC_AUTH"; config: BasicAuthConfig }
  | { type: "SET_VOICE"; enabled: boolean }
  | { type: "SET_BOTS"; config: BotConfig }
  | { type: "SET_EXISTING"; existing: ExistingInstall }
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "UPDATE_INSTALL_STEP"; id: string; status: InstallStep["status"]; error?: string };

export interface WizardState {
  step: Step;
  config: WizardConfig;
  installSteps: InstallStep[];
  existing: ExistingInstall;
}
