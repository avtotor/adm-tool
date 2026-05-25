import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const APKS_FILE = path.join(DATA_DIR, 'apks.json');
const ROLLOUTS_FILE = path.join(DATA_DIR, 'rollouts.json');

const state = {
  devices: {},
  apks: [],
  rollouts: {},
};

const writeChains = new Map();

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'apks'), { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

function queueWrite(file, getData) {
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev.then(() => atomicWrite(file, getData())).catch((err) => {
    console.error(`[store] write failed for ${file}:`, err);
  });
  writeChains.set(file, next);
  return next;
}

export async function init() {
  await ensureDataDir();
  state.devices = await readJson(DEVICES_FILE, {});
  state.apks = await readJson(APKS_FILE, []);
  state.rollouts = await readJson(ROLLOUTS_FILE, {});
}

export function getDevices() {
  return state.devices;
}

export function getDevice(serial) {
  return state.devices[serial];
}

export function upsertDevice(serial, patch) {
  const existing = state.devices[serial] ?? { serial, first_seen: new Date().toISOString() };
  state.devices[serial] = { ...existing, ...patch, last_seen: new Date().toISOString() };
  queueWrite(DEVICES_FILE, () => state.devices);
  return state.devices[serial];
}

export function getApks() {
  return state.apks;
}

export function getApk(id) {
  return state.apks.find((a) => a.id === id);
}

export function addApk(apk) {
  state.apks.push(apk);
  queueWrite(APKS_FILE, () => state.apks);
  return apk;
}

export function removeApk(id) {
  const idx = state.apks.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const [removed] = state.apks.splice(idx, 1);
  queueWrite(APKS_FILE, () => state.apks);
  return removed;
}

export function getRollouts() {
  return state.rollouts;
}

export function setRollout(packageName, apkId) {
  if (apkId == null) {
    delete state.rollouts[packageName];
  } else {
    state.rollouts[packageName] = apkId;
  }
  queueWrite(ROLLOUTS_FILE, () => state.rollouts);
}

export function getActiveApkForPackage(packageName) {
  const apkId = state.rollouts[packageName];
  if (!apkId) return null;
  return getApk(apkId) ?? null;
}

export async function flush() {
  await Promise.all(Array.from(writeChains.values()));
}
