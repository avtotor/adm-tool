import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

const SERVER_URL_KEY = "adm.serverUrl";

export const DEFAULT_SERVER_URL =
  extra.EXPO_PUBLIC_SERVER_URL?.replace(/\/+$/, "") ?? "http://192.168.1.10:8080";

export const TARGET_PACKAGE = extra.EXPO_PUBLIC_TARGET_PACKAGE ?? "";

export const HEARTBEAT_SECONDS = Math.max(
  30,
  Number(extra.EXPO_PUBLIC_HEARTBEAT_SECONDS ?? 300),
);

let currentServerUrl = DEFAULT_SERVER_URL;

export function getServerUrl(): string {
  return currentServerUrl;
}

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function isValidServerUrl(raw: string): boolean {
  const v = normalizeUrl(raw);
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

export async function loadServerUrl(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(SERVER_URL_KEY);
    if (stored && isValidServerUrl(stored)) {
      currentServerUrl = normalizeUrl(stored);
    }
  } catch {
    // ignore — fall back to default
  }
  return currentServerUrl;
}

export async function setServerUrl(raw: string): Promise<string> {
  const normalized = normalizeUrl(raw);
  if (!isValidServerUrl(normalized)) {
    throw new Error("Некорректный URL (нужен http:// или https://)");
  }
  await SecureStore.setItemAsync(SERVER_URL_KEY, normalized);
  currentServerUrl = normalized;
  return currentServerUrl;
}

export async function resetServerUrl(): Promise<string> {
  try {
    await SecureStore.deleteItemAsync(SERVER_URL_KEY);
  } catch {
    // ignore
  }
  currentServerUrl = DEFAULT_SERVER_URL;
  return currentServerUrl;
}
