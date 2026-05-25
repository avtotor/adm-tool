import { SERVER_URL } from "./config";
import type { DeviceSnapshot } from "./device";

export type ServerUpdate = {
  package: string;
  versionCode: number;
  versionName: string;
  url: string;
  sha256: string;
};

export type HeartbeatResult = {
  ok: boolean;
  updates: ServerUpdate[];
  error?: string;
};

export async function sendHeartbeat(snap: DeviceSnapshot): Promise<HeartbeatResult> {
  try {
    const res = await fetch(`${SERVER_URL}/api/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snap),
    });
    if (!res.ok) {
      return { ok: false, updates: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { ok: boolean; updates: ServerUpdate[] };
    return { ok: true, updates: data.updates ?? [] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, updates: [], error: msg };
  }
}

export function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${SERVER_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}
