import path from 'node:path';
import { promises as fs, createWriteStream } from 'node:fs';
import crypto from 'node:crypto';
import ApkReader from 'adbkit-apkreader';
import {
  getDevices,
  getApks,
  addApk,
  removeApk,
  getRollouts,
  setRollout,
} from '../store.js';

const APKS_DIR = path.resolve('data', 'apks');

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function isOnline(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 15 * 60_000;
}

async function sha256File(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export default async function adminRoutes(fastify) {
  fastify.get('/', async (_req, reply) => {
    const devices = Object.values(getDevices()).sort((a, b) =>
      (a.name ?? a.serial).localeCompare(b.name ?? b.serial),
    );
    const apks = getApks();
    const rollouts = getRollouts();

    const enriched = devices.map((d) => {
      const pkgs = Object.entries(d.packages ?? {}).map(([pkg, v]) => {
        const target = rollouts[pkg];
        const targetApk = target ? apks.find((a) => a.id === target) : null;
        const outdated = targetApk && targetApk.versionCode > v.versionCode;
        return { pkg, ...v, outdated, targetVc: targetApk?.versionCode };
      });
      return {
        ...d,
        pkgs,
        online: isOnline(d.last_seen),
        last_seen_fmt: fmtTime(d.last_seen),
      };
    });

    return reply.view('dashboard.ejs', { devices: enriched });
  });

  fastify.get('/apks', async (_req, reply) => {
    const apks = [...getApks()].sort(
      (a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at),
    );
    const rollouts = getRollouts();
    return reply.view('apks.ejs', { apks, rollouts, fmtTime });
  });

  fastify.post('/apks/upload', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no file' });
    if (!file.filename.toLowerCase().endsWith('.apk')) {
      return reply.code(400).send({ error: 'must be .apk' });
    }

    const id = crypto.randomBytes(8).toString('hex');
    const tmpPath = path.join(APKS_DIR, `${id}.tmp`);
    await fs.mkdir(APKS_DIR, { recursive: true });

    const ws = createWriteStream(tmpPath);
    await new Promise((resolve, reject) => {
      file.file.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      file.file.on('error', reject);
    });

    let manifest;
    try {
      const reader = await ApkReader.open(tmpPath);
      manifest = await reader.readManifest();
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {});
      return reply.code(400).send({ error: `invalid apk: ${err.message}` });
    }

    const pkgName = manifest.package;
    const versionCode = manifest.versionCode;
    const versionName = manifest.versionName ?? String(versionCode);

    const pkgDir = path.join(APKS_DIR, pkgName);
    await fs.mkdir(pkgDir, { recursive: true });
    const finalPath = path.join(pkgDir, `${versionCode}.apk`);
    await fs.rename(tmpPath, finalPath);

    const sha256 = await sha256File(finalPath);

    addApk({
      id,
      package: pkgName,
      versionCode,
      versionName,
      filePath: path.relative(process.cwd(), finalPath),
      sha256,
      size: (await fs.stat(finalPath)).size,
      uploaded_at: new Date().toISOString(),
      original_filename: file.filename,
    });

    return reply.redirect('/apks');
  });

  fastify.post('/apks/:id/activate', async (req, reply) => {
    const apks = getApks();
    const apk = apks.find((a) => a.id === req.params.id);
    if (!apk) return reply.code(404).send({ error: 'not found' });
    setRollout(apk.package, apk.id);
    return reply.redirect('/apks');
  });

  fastify.post('/apks/:id/delete', async (req, reply) => {
    const removed = removeApk(req.params.id);
    if (removed) {
      const rollouts = getRollouts();
      if (rollouts[removed.package] === removed.id) {
        setRollout(removed.package, null);
      }
      await fs.unlink(path.resolve(removed.filePath)).catch(() => {});
    }
    return reply.redirect('/apks');
  });

  fastify.post('/rollouts/:package/clear', async (req, reply) => {
    setRollout(req.params.package, null);
    return reply.redirect('/apks');
  });
}
