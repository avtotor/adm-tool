import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";
import { absoluteUrl, type ServerUpdate } from "./api";

export type DownloadProgress = {
  totalBytes: number;
  bytesWritten: number;
  percent: number;
};

export async function downloadApk(
  update: ServerUpdate,
  onProgress?: (p: DownloadProgress) => void,
): Promise<string> {
  const url = absoluteUrl(update.url);
  const dir = `${FileSystem.cacheDirectory}apks/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const path = `${dir}${update.package}-${update.versionCode}.apk`;

  const existing = await FileSystem.getInfoAsync(path);
  if (existing.exists) {
    await FileSystem.deleteAsync(path, { idempotent: true });
  }

  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    path,
    {},
    (p) => {
      const total = p.totalBytesExpectedToWrite || 1;
      onProgress?.({
        totalBytes: total,
        bytesWritten: p.totalBytesWritten,
        percent: Math.round((p.totalBytesWritten / total) * 100),
      });
    },
  );

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) {
    throw new Error("download failed");
  }
  return result.uri;
}

export async function installApk(fileUri: string): Promise<void> {
  if (Platform.OS !== "android") {
    throw new Error("install supported on Android only");
  }

  const contentUri = await FileSystem.getContentUriAsync(fileUri);

  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: "application/vnd.android.package-archive",
  });
}
