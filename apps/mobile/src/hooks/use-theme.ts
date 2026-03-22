import { Colors } from "@/constants/theme";
import { useColorScheme } from "react-native";

export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? "dark" : "light";
  return Colors[theme];
}
