import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const SERVER_URL =
  extra.EXPO_PUBLIC_SERVER_URL?.replace(/\/+$/, "") ?? "http://192.168.1.10:8080";

export const TARGET_PACKAGE = extra.EXPO_PUBLIC_TARGET_PACKAGE ?? "";

export const HEARTBEAT_SECONDS = Math.max(
  30,
  Number(extra.EXPO_PUBLIC_HEARTBEAT_SECONDS ?? 300),
);
