import { createContext, useContext } from "react";
import type { WizardState, WizardAction, InstallStep } from "../types.js";
import { Step } from "../types.js";

export const DEFAULT_INSTALL_STEPS: InstallStep[] = [
  { id: "user", label: "Creating system user", status: "pending" },
  { id: "dirs", label: "Creating directories", status: "pending" },
  { id: "env", label: "Writing .env configuration", status: "pending" },
  { id: "caddy-install", label: "Installing Caddy", status: "pending" },
  { id: "caddyfile", label: "Writing Caddyfile", status: "pending" },
  {
    id: "docker",
    label: "Installing Docker",
    status: "pending",
    condition: (c) => c.voiceEnabled,
  },
  { id: "pnpm-install", label: "Installing dependencies", status: "pending" },
  { id: "build-frontend", label: "Building frontend", status: "pending" },
  { id: "build-server", label: "Building server", status: "pending" },
  {
    id: "build-bot",
    label: "Building bot",
    status: "pending",
    condition: (c) => Object.keys(c.bots).length > 0,
  },
  { id: "systemd", label: "Installing systemd services", status: "pending" },
  { id: "firewall", label: "Configuring firewall", status: "pending" },
  {
    id: "voice-containers",
    label: "Starting voice containers",
    status: "pending",
    condition: (c) => c.voiceEnabled,
  },
  { id: "start", label: "Starting services", status: "pending" },
];

export const initialState: WizardState = {
  step: Step.Welcome,
  config: {
    domain: { mode: "domain" },
    anthropicApiKey: "",
    basicAuth: { username: "admin", password: "" },
    voiceEnabled: false,
    bots: {},
    installDir: "/opt/aebclawd",
    workspacesRoot: "/home/aebclawd/workspaces",
    dataDir: "/opt/aebclawd/data",
  },
  installSteps: DEFAULT_INSTALL_STEPS,
  existing: { found: false },
};

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };

    case "NEXT_STEP":
      return { ...state, step: Math.min(state.step + 1, Step.Done) as Step };

    case "PREV_STEP":
      return { ...state, step: Math.max(state.step - 1, Step.Welcome) as Step };

    case "SET_DOMAIN":
      return { ...state, config: { ...state.config, domain: action.config } };

    case "SET_API_KEY":
      return { ...state, config: { ...state.config, anthropicApiKey: action.key } };

    case "SET_BASIC_AUTH":
      return { ...state, config: { ...state.config, basicAuth: action.config } };

    case "SET_VOICE":
      return { ...state, config: { ...state.config, voiceEnabled: action.enabled } };

    case "SET_BOTS":
      return { ...state, config: { ...state.config, bots: action.config } };

    case "SET_EXISTING":
      return { ...state, existing: action.existing };

    case "UPDATE_INSTALL_STEP":
      return {
        ...state,
        installSteps: state.installSteps.map((s) =>
          s.id === action.id
            ? { ...s, status: action.status, error: action.error }
            : s
        ),
      };

    default:
      return state;
  }
}

interface WizardContextValue {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}

export const WizardContext = createContext<WizardContextValue>(null!);

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardContext.Provider");
  return ctx;
}
