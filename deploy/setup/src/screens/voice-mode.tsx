import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { StepIndicator } from "../components/step-indicator.js";
import { useWizard } from "../hooks/use-wizard.js";
import { TOTAL_STEPS } from "../types.js";

export function VoiceMode() {
  const { dispatch } = useWizard();

  const items = [
    { label: "No, text only", value: "no" },
    { label: "Yes, enable voice mode", value: "yes" },
  ];

  const handleSelect = (item: { value: string }) => {
    dispatch({ type: "SET_VOICE", enabled: item.value === "yes" });
    dispatch({ type: "NEXT_STEP" });
  };

  return (
    <Box flexDirection="column">
      <StepIndicator step={5} total={TOTAL_STEPS} />
      <Text bold>VOICE MODE</Text>
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text>Enable speech-to-text and text-to-speech?</Text>
        <Text dimColor>Requires Docker (~2GB disk, ~1GB RAM)</Text>
      </Box>
      <SelectInput items={items} onSelect={handleSelect} />
    </Box>
  );
}
