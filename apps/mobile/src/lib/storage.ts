import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL_KEY = "aebclawd_api_url";

export async function getApiUrl(): Promise<string | null> {
  return AsyncStorage.getItem(API_URL_KEY);
}

export async function setApiUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(API_URL_KEY, url);
}

export async function clearApiUrl(): Promise<void> {
  await AsyncStorage.removeItem(API_URL_KEY);
}
