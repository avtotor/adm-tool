import "dotenv/config";
import { type ExpoConfig } from "expo/config";

export default ({ config }: { config: ExpoConfig }): ExpoConfig => {
  const targetPackage = process.env.EXPO_PUBLIC_TARGET_PACKAGE ?? "";

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [
        "expo-build-properties",
        {
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
    android: {
      ...config.android,
      ...(targetPackage
        ? { queries: [{ package: targetPackage }] }
        : {}),
    } as ExpoConfig["android"] & { queries?: unknown },
    extra: {
      ...config.extra,
      EXPO_PUBLIC_SERVER_URL: process.env.EXPO_PUBLIC_SERVER_URL,
      EXPO_PUBLIC_TARGET_PACKAGE: targetPackage,
      EXPO_PUBLIC_HEARTBEAT_SECONDS: process.env.EXPO_PUBLIC_HEARTBEAT_SECONDS,
    },
  };
};
