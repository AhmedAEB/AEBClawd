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
    return <ExistingInstallPrompt />;
  }

  return <FreshInstallPrompt />;
}

function FreshInstallPrompt() {
  const { dispatch } = useWizard();

  useInput((_input, key) => {
    if (key.return) {
      dispatch({ type: "NEXT_STEP" });
    }
  });

  return (
    <Box flexDirection="column">
      <Banner />
      <Box marginTop={1}>
        <Text>Press </Text>
        <Text bold>ENTER</Text>
        <Text> to begin setup...</Text>
      </Box>
    </Box>
  );
}

function ExistingInstallPrompt() {
  const { dispatch } = useWizard();

  const items = [
    { label: "Reconfigure (update settings, rebuild)", value: "reconfigure" },
    { label: "Fresh install (start from scratch)", value: "fresh" },
    { label: "Quit", value: "quit" },
  ];

  const handleSelect = (item: { value: string }) => {
    if (item.value === "quit") {
      process.exit(0);
    }
    // Both reconfigure and fresh go to domain screen
    dispatch({ type: "NEXT_STEP" });
  };

  return (
    <Box flexDirection="column">
      <Banner />
      <Box marginTop={1} marginBottom={1}>
        <Text color="yellow">Existing installation detected at /opt/aebclawd</Text>
      </Box>
      <SelectInput items={items} onSelect={handleSelect} />
    </Box>
  );
}
