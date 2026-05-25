import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
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

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
}) as string;

const COLOR = {
  bg: "#0a0a0a",
  bgPanel: "rgba(15,15,15,0.85)",
  fg: "#f2f2f2",
  muted: "#a6a6a6",
  border: "#333333",
  ruleFaint: "rgba(255,255,255,0.06)",
  primary: "#39ff14",
  primarySoft: "rgba(57,255,20,0.10)",
  primaryGlow: "rgba(57,255,20,0.45)",
  destructive: "#ff4500",
  destructiveSoft: "rgba(255,69,0,0.10)",
} as const;

function fmtTimeAgo(ts: number | null): string {
  if (ts == null) return "—";
  const diff = Date.now() - ts;
  if (diff < 5_000) return "сейчас";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}с`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}м`;
  return `${Math.floor(diff / 3_600_000)}ч`;
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
      <StatusBar style="light" />
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              <Text style={styles.titlePrefix}>{"> "}</Text>ADM·UPDATER
            </Text>
            <Text style={styles.subtitle}>{SERVER_URL}</Text>
          </View>
          <StatusBadge status={status} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={status === "syncing"}
              onRefresh={refresh}
              tintColor={COLOR.primary}
              colors={[COLOR.primary]}
              progressBackgroundColor={COLOR.bg}
            />
          }
        >
          <Section title="// Синхронизация">
            <Row label="Статус" value={statusLabel(status, lastError)} highlight={status === "error" ? "err" : status === "ok" ? "ok" : undefined} />
            <Row label="Last seen" value={fmtTimeAgo(lastSync)} />
            <Row
              label="Интервал"
              value={`${Math.round(HEARTBEAT_SECONDS / 60)} мин.`}
            />
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                pressed && styles.btnPressed,
                status === "syncing" && styles.btnDisabled,
              ]}
              onPress={refresh}
              disabled={status === "syncing"}
            >
              {status === "syncing" ? (
                <ActivityIndicator color={COLOR.primary} size="small" />
              ) : (
                <Text style={styles.btnText}>Проверить</Text>
              )}
            </Pressable>
          </Section>

          <Section title="// Устройство">
            <Row label="Имя" value={device?.name ?? "—"} />
            <Row label="Serial" value={device?.serial ?? "—"} mono />
            <Row label="Android" value={device?.android ?? "—"} />
            <Row label="IP" value={device?.ip ?? "—"} mono />
            <Row
              label="Батарея"
              value={device?.battery != null ? `${device.battery}%` : "—"}
            />
          </Section>

          <Section title="// Пакеты">
            {device?.packages.map((p) => (
              <View key={p.package} style={styles.pkgRow}>
                <Text style={styles.pkgName}>{p.package}</Text>
                <Text style={styles.pkgVer}>
                  v{p.versionCode}
                  {p.versionName ? ` · ${p.versionName}` : ""}
                </Text>
              </View>
            )) ?? <Text style={styles.muted}>—</Text>}
            {!TARGET_PACKAGE && (
              <Text style={[styles.note, { marginTop: 8 }]}>
                ! TARGET_PACKAGE НЕ ЗАДАН
              </Text>
            )}
          </Section>

          <Section
            title={`// Обновления${updates.length ? ` · ${updates.length}` : ""}`}
          >
            {updates.length === 0 ? (
              <Text style={styles.muted}>// всё актуально</Text>
            ) : (
              updates.map((u) => {
                const isInstalling = installing === u.package;
                return (
                  <View key={`${u.package}-${u.versionCode}`} style={styles.updateRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.pkgName}>{u.package}</Text>
                      <Text style={styles.pkgVerUpdate}>
                        → v{u.versionCode} · {u.versionName}
                      </Text>
                      {isInstalling && progress && (
                        <Text style={styles.progress}>
                          [{progress.percent}%]
                          {progress.totalBytes > 0
                            ? ` · ${(progress.bytesWritten / 1024 / 1024).toFixed(1)}/${(progress.totalBytes / 1024 / 1024).toFixed(1)} MB`
                            : ""}
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
                        <ActivityIndicator color={COLOR.primary} size="small" />
                      ) : (
                        <Text style={styles.btnText}>Установить</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </Section>

          <Section title="// Лог">
            {log.length === 0 ? (
              <Text style={styles.muted}>// пусто</Text>
            ) : (
              log.map((e) => (
                <View key={e.ts} style={styles.logRow}>
                  <Text style={styles.logTs}>
                    {new Date(e.ts).toLocaleTimeString()}
                  </Text>
                  <Text
                    style={[styles.logMsg, e.level === "error" && styles.logErr]}
                    numberOfLines={3}
                  >
                    {e.msg}
                  </Text>
                </View>
              ))
            )}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function StatusBadge({ status }: { status: SyncStatus }) {
  const label =
    status === "ok"
      ? "ONLINE"
      : status === "error"
        ? "ERROR"
        : status === "syncing"
          ? "SYNC"
          : "IDLE";

  const palette =
    status === "ok"
      ? { color: COLOR.primary, bg: COLOR.primarySoft }
      : status === "error"
        ? { color: COLOR.destructive, bg: COLOR.destructiveSoft }
        : { color: COLOR.muted, bg: "transparent" };

  return (
    <View style={[styles.badge, { borderColor: palette.color, backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.color }]}>{label}</Text>
    </View>
  );
}

function statusLabel(s: SyncStatus, err: string | null): string {
  if (s === "syncing") return "обновляю…";
  if (s === "ok") return "ok";
  if (s === "error") return err ? `ошибка: ${err}` : "ошибка";
  return "—";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionRule} />
      </View>
      <View>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: "ok" | "err";
}) {
  const highlightColor =
    highlight === "ok"
      ? COLOR.primary
      : highlight === "err"
        ? COLOR.destructive
        : undefined;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          mono && styles.monoTight,
          highlightColor != null && { color: highlightColor },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.bg },

  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLOR.bgPanel,
    borderBottomWidth: 1,
    borderBottomColor: COLOR.border,
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2.5,
    color: COLOR.primary,
    textShadowColor: COLOR.primaryGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  titlePrefix: { color: COLOR.muted },
  subtitle: {
    fontFamily: MONO,
    fontSize: 11,
    color: COLOR.muted,
    marginTop: 3,
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  section: { marginBottom: 22 },
  sectionHeader: { marginBottom: 10 },
  sectionTitle: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: COLOR.primary,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  sectionRule: {
    height: 1,
    backgroundColor: COLOR.border,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLOR.ruleFaint,
  },
  rowLabel: {
    fontFamily: MONO,
    fontSize: 11,
    color: COLOR.muted,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  rowValue: {
    fontFamily: MONO,
    fontSize: 12,
    color: COLOR.fg,
    maxWidth: "65%",
    textAlign: "right",
  },
  monoTight: { letterSpacing: 0 },

  muted: { fontFamily: MONO, fontSize: 11, color: COLOR.muted, paddingVertical: 6 },
  note: {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: 1.5,
    color: COLOR.destructive,
    textTransform: "uppercase",
  },

  pkgRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLOR.ruleFaint,
  },
  pkgName: { fontFamily: MONO, fontSize: 12, color: COLOR.fg },
  pkgVer: { fontFamily: MONO, fontSize: 11, color: COLOR.muted, marginTop: 3 },
  pkgVerUpdate: {
    fontFamily: MONO,
    fontSize: 11,
    color: COLOR.primary,
    marginTop: 3,
  },

  updateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLOR.ruleFaint,
  },
  progress: {
    fontFamily: MONO,
    fontSize: 11,
    color: COLOR.primary,
    marginTop: 5,
  },

  btn: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    borderWidth: 1,
  },
  btnPrimary: {
    backgroundColor: COLOR.primarySoft,
    borderColor: COLOR.primary,
  },
  btnText: {
    fontFamily: MONO,
    color: COLOR.primary,
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  btnPressed: { opacity: 0.6 },
  btnDisabled: { opacity: 0.35 },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 10, marginTop: 0 },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  badgeText: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 2,
  },

  logRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 3,
  },
  logTs: {
    fontFamily: MONO,
    fontSize: 10,
    color: COLOR.muted,
    minWidth: 70,
  },
  logMsg: { fontFamily: MONO, fontSize: 11, color: COLOR.fg, flex: 1 },
  logErr: { color: COLOR.destructive, fontWeight: "700" },
});
