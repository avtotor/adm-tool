import * as Application from "expo-application";
import * as Battery from "expo-battery";
import * as Device from "expo-device";
import * as Network from "expo-network";
import { TARGET_PACKAGE } from "./config";

export type PackageInfo = {
  package: string;
  versionCode: number;
  versionName: string;
};

export type DeviceSnapshot = {
  serial: string;
  name: string;
  ip: string | null;
  battery: number | null;
  android: string;
  packages: PackageInfo[];
};

async function getSerial(): Promise<string> {
  // Android 10+ closes off Build.SERIAL. ANDROID_ID is the most stable
  // per-device identifier available without privileged permissions.
  try {
    const id = await Application.getAndroidId();
    if (id) return id;
  } catch {}
  return "unknown-device";
}

async function getIp(): Promise<string | null> {
  try {
    const ip = await Network.getIpAddressAsync();
    return ip || null;
  } catch {
    return null;
  }
}

async function getBattery(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    if (level < 0) return null;
    return Math.round(level * 100);
  } catch {
    return null;
  }
}

function getDeviceName(): string {
  const parts = [Device.manufacturer, Device.modelName].filter(Boolean) as string[];
  return parts.join(" ") || Device.deviceName || "Android device";
}

function getSelfPackage(): PackageInfo {
  return {
    package: Application.applicationId ?? "com.admtool.updater",
    versionCode: Number(Application.nativeBuildVersion ?? 0) || 0,
    versionName: Application.nativeApplicationVersion ?? "0.0.0",
  };
}

export async function snapshot(): Promise<DeviceSnapshot> {
  const [serial, ip, battery] = await Promise.all([
    getSerial(),
    getIp(),
    getBattery(),
  ]);

  const packages: PackageInfo[] = [getSelfPackage()];

  // Целевое приложение: для v1 мы знаем только имя пакета. Полноценное
  // чтение versionCode чужого пакета требует нативного модуля поверх
  // PackageManager — добавится отдельным шагом.
  if (TARGET_PACKAGE) {
    packages.push({
      package: TARGET_PACKAGE,
      versionCode: 0,
      versionName: "unknown",
    });
  }

  return {
    serial,
    name: getDeviceName(),
    ip,
    battery,
    android: Device.osVersion ?? "unknown",
    packages,
  };
}
