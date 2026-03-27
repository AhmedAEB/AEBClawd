import { useReducer } from "react";
import { Box } from "ink";
import { Step } from "./types.js";
import { wizardReducer, initialState, WizardContext } from "./hooks/use-wizard.js";
import { Welcome } from "./screens/welcome.js";
import { Domain } from "./screens/domain.js";
import { ApiKey } from "./screens/api-key.js";
import { BasicAuth } from "./screens/basic-auth.js";
import { VoiceMode } from "./screens/voice-mode.js";
import { BotIntegrations } from "./screens/bot-integrations.js";
import { Review } from "./screens/review.js";
import { InstallProgress } from "./screens/install-progress.js";
import { Done } from "./screens/done.js";

const SCREENS: Record<Step, () => JSX.Element> = {
  [Step.Welcome]: Welcome,
  [Step.Domain]: Domain,
  [Step.ApiKey]: ApiKey,
  [Step.BasicAuth]: BasicAuth,
  [Step.VoiceMode]: VoiceMode,
  [Step.BotIntegrations]: BotIntegrations,
  [Step.Review]: Review,
  [Step.Installing]: InstallProgress,
  [Step.Done]: Done,
};

export function App() {
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const Screen = SCREENS[state.step];

  return (
    <WizardContext.Provider value={{ state, dispatch }}>
      <Box flexDirection="column" padding={1}>
        <Screen />
      </Box>
    </WizardContext.Provider>
  );
}
