import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { HEARTBEAT_SECONDS, SERVER_URL, TARGET_PACKAGE } from "./src/config";
import { snapshot, type DeviceSnapshot } from "./src/device";
import { sendHeartbeat, type ServerUpdate } from "./src/api";
import { downloadApk, installApk, type DownloadProgress } from "./src/installer";

type SyncStatus = "idle" | "syncing" | "ok" | "error";

type LogEntry = {
  ts: number;
  level: "info" | "warn" | "error";
  msg: string;
};

function fmtTimeAgo(ts: number | null): string {
  if (ts == null) return "—";
  const diff = Date.now() - ts;
  if (diff < 5_000) return "только что";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}с назад`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}м назад`;
  return `${Math.floor(diff / 3_600_000)}ч назад`;
}

export default function App() {
  const [device, setDevice] = useState<DeviceSnapshot | null>(null);
  const [updates, setUpdates] = useState<ServerUpdate[]>([]);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [, forceTick] = useState(0);

  const appendLog = useCallback((level: LogEntry["level"], msg: string) => {
    setLog((prev) => [{ ts: Date.now(), level, msg }, ...prev].slice(0, 50));
  }, []);

  const refresh = useCallback(async () => {
    setStatus("syncing");
    try {
      const snap = await snapshot();
      setDevice(snap);
      const res = await sendHeartbeat(snap);
      if (res.ok) {
        setUpdates(res.updates);
        setLastSync(Date.now());
        setLastError(null);
        setStatus("ok");
        appendLog(
          "info",
          res.updates.length > 0
            ? `heartbeat ok, обновлений: ${res.updates.length}`
            : "heartbeat ok",
        );
      } else {
        setLastError(res.error ?? "unknown error");
        setStatus("error");
        appendLog("error", `heartbeat fail: ${res.error}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(msg);
      setStatus("error");
      appendLog("error", `snapshot fail: ${msg}`);
    }
  }, [appendLog]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, HEARTBEAT_SECONDS * 1000);
    const tick = setInterval(() => forceTick((n) => n + 1), 5_000);
    return () => {
      clearInterval(interval);
      clearInterval(tick);
    };
  }, [refresh]);

  const handleInstall = useCallback(
    async (update: ServerUpdate) => {
      if (installing) return;
      setInstalling(update.package);
      setProgress({ totalBytes: 0, bytesWritten: 0, percent: 0 });
      appendLog("info", `скачиваю ${update.package} v${update.versionCode}`);
      try {
        const uri = await downloadApk(update, setProgress);
        appendLog("info", `скачан: ${uri.split("/").pop()}`);
        await installApk(uri);
        appendLog("info", `запущена установка ${update.package}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog("error", `install fail: ${msg}`);
        Alert.alert("Ошибка установки", msg);
      } finally {
        setInstalling(null);
        setProgress(null);
      }
    },
    [installing, appendLog],
  );

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>ADM Updater</Text>
            <Text style={styles.subtitle}>{SERVER_URL}</Text>
          </View>
          <StatusBadge status={status} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={status === "syncing"} onRefresh={refresh} />
          }
        >
          <Card title="Синхронизация">
            <Row label="Статус" value={statusLabel(status, lastError)} />
            <Row label="Последний heartbeat" value={fmtTimeAgo(lastSync)} />
            <Row
              label="Интервал"
              value={`каждые ${Math.round(HEARTBEAT_SECONDS / 60)} мин.`}
            />
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                pressed && styles.btnPressed,
              ]}
              onPress={refresh}
              disabled={status === "syncing"}
            >
              {status === "syncing" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnTextPrimary}>Проверить сейчас</Text>
              )}
            </Pressable>
          </Card>

          <Card title="Устройство">
            <Row label="Имя" value={device?.name ?? "—"} />
            <Row label="Serial (ANDROID_ID)" value={device?.serial ?? "—"} mono />
            <Row label="Android" value={device?.android ?? "—"} />
            <Row label="IP" value={device?.ip ?? "—"} mono />
            <Row
              label="Батарея"
              value={device?.battery != null ? `${device.battery}%` : "—"}
            />
          </Card>

          <Card title="Отслеживаемые пакеты">
            {device?.packages.map((p) => (
              <View key={p.package} style={styles.pkgRow}>
                <Text style={styles.pkgName}>{p.package}</Text>
                <Text style={styles.pkgVer}>
                  v{p.versionCode}
                  {p.versionName ? ` (${p.versionName})` : ""}
                </Text>
              </View>
            )) ?? <Text style={styles.muted}>—</Text>}
            {!TARGET_PACKAGE && (
              <Text style={[styles.muted, { marginTop: 8 }]}>
                EXPO_PUBLIC_TARGET_PACKAGE не задан в .env
              </Text>
            )}
          </Card>

          <Card title={`Доступные обновления${updates.length ? ` (${updates.length})` : ""}`}>
            {updates.length === 0 ? (
              <Text style={styles.muted}>Все актуально</Text>
            ) : (
              updates.map((u) => {
                const isInstalling = installing === u.package;
                return (
                  <View key={`${u.package}-${u.versionCode}`} style={styles.updateRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pkgName}>{u.package}</Text>
                      <Text style={styles.pkgVer}>
                        → v{u.versionCode} ({u.versionName})
                      </Text>
                      {isInstalling && progress && (
                        <Text style={styles.progress}>
                          {progress.percent}%{" "}
                          {progress.totalBytes > 0 &&
                            `· ${(progress.bytesWritten / 1024 / 1024).toFixed(1)} / ${(progress.totalBytes / 1024 / 1024).toFixed(1)} MB`}
                        </Text>
                      )}
                    </View>
                    <Pressable
                      style={({ pressed }) => [
                        styles.btn,
                        styles.btnPrimary,
                        styles.btnSmall,
                        (isInstalling || !!installing) && styles.btnDisabled,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={() => handleInstall(u)}
                      disabled={!!installing}
                    >
                      {isInstalling ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.btnTextPrimary}>Установить</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </Card>

          <Card title="Лог">
            {log.length === 0 ? (
              <Text style={styles.muted}>пусто</Text>
            ) : (
              log.map((e) => (
                <View key={e.ts} style={styles.logRow}>
                  <Text style={[styles.logTs]}>
                    {new Date(e.ts).toLocaleTimeString()}
                  </Text>
                  <Text
                    style={[
                      styles.logMsg,
                      e.level === "error" && styles.logErr,
                      e.level === "warn" && styles.logWarn,
                    ]}
                  >
                    {e.msg}
                  </Text>
                </View>
              ))
            )}
          </Card>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function StatusBadge({ status }: { status: SyncStatus }) {
  const color =
    status === "ok"
      ? "#2ea043"
      : status === "error"
        ? "#f85149"
        : status === "syncing"
          ? "#d29922"
          : "#8b949e";
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22`, borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>
        {status === "ok"
          ? "ONLINE"
          : status === "error"
            ? "ERROR"
            : status === "syncing"
              ? "SYNC"
              : "IDLE"}
      </Text>
    </View>
  );
}

function statusLabel(s: SyncStatus, err: string | null): string {
  if (s === "syncing") return "обновляю…";
  if (s === "ok") return "ok";
  if (s === "error") return err ? `ошибка: ${err}` : "ошибка";
  return "—";
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f6f8fa" },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#d0d7de",
    flexDirection: "row",
    alignItems: "center",
  },
  title: { fontSize: 18, fontWeight: "700", color: "#1f2328" },
  subtitle: { fontSize: 12, color: "#656d76", marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 32 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d0d7de",
    padding: 12,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#656d76",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  rowLabel: { color: "#656d76", fontSize: 13 },
  rowValue: { color: "#1f2328", fontSize: 13, fontWeight: "500", maxWidth: "65%" },
  mono: { fontFamily: "monospace", fontSize: 12 },
  muted: { color: "#8b949e", fontSize: 13 },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  btnPrimary: { backgroundColor: "#0969da" },
  btnPressed: { opacity: 0.8 },
  btnDisabled: { opacity: 0.5 },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, marginTop: 0, marginLeft: 8 },
  btnTextPrimary: { color: "#fff", fontWeight: "600", fontSize: 14 },
  pkgRow: { paddingVertical: 6 },
  pkgName: { color: "#1f2328", fontSize: 13, fontFamily: "monospace" },
  pkgVer: { color: "#656d76", fontSize: 12, marginTop: 2 },
  updateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#eaeef2",
  },
  progress: { color: "#0969da", fontSize: 12, marginTop: 4 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  logRow: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  logTs: { fontFamily: "monospace", fontSize: 11, color: "#8b949e", minWidth: 64 },
  logMsg: { fontSize: 12, color: "#1f2328", flex: 1 },
  logErr: { color: "#cf222e" },
  logWarn: { color: "#9a6700" },
});
