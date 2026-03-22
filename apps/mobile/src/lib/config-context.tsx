import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getApiUrl, setApiUrl as saveApiUrl } from "./storage";

interface ConfigContextValue {
  apiUrl: string | null;
  setApiUrl: (url: string) => Promise<void>;
  isLoading: boolean;
}

const ConfigContext = createContext<ConfigContextValue>({
  apiUrl: null,
  setApiUrl: async () => {},
  isLoading: true,
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [apiUrl, setApiUrlState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getApiUrl().then((url) => {
      setApiUrlState(url);
      setIsLoading(false);
    });
  }, []);

  const setApiUrl = async (url: string) => {
    const trimmed = url.replace(/\/+$/, "");
    await saveApiUrl(trimmed);
    setApiUrlState(trimmed);
  };

  return (
    <ConfigContext.Provider value={{ apiUrl, setApiUrl, isLoading }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}
