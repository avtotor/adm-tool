import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { upsertDevice, getActiveApkForPackage, getApk } from '../store.js';

const heartbeatSchema = {
  body: {
    type: 'object',
    required: ['serial'],
    properties: {
      serial: { type: 'string' },
      name: { type: 'string' },
      ip: { type: 'string' },
      battery: { type: 'number' },
      android: { type: 'string' },
      packages: {
        type: 'array',
        items: {
          type: 'object',
          required: ['package', 'versionCode'],
          properties: {
            package: { type: 'string' },
            versionCode: { type: 'integer' },
            versionName: { type: 'string' },
          },
        },
      },
    },
  },
};

export default async function apiRoutes(fastify) {
  fastify.post('/heartbeat', { schema: heartbeatSchema }, async (req) => {
    const { serial, name, ip, battery, android, packages = [] } = req.body;
    const installed = {};
    for (const p of packages) {
      installed[p.package] = { versionCode: p.versionCode, versionName: p.versionName };
    }

    upsertDevice(serial, {
      name: name ?? serial,
      ip: ip ?? req.ip,
      battery,
      android,
      packages: installed,
    });

    const updates = [];
    for (const pkg of Object.keys(installed)) {
      const target = getActiveApkForPackage(pkg);
      if (!target) continue;
      if (target.versionCode > installed[pkg].versionCode) {
        updates.push({
          package: target.package,
          versionCode: target.versionCode,
          versionName: target.versionName,
          url: `/api/download/${target.id}`,
          sha256: target.sha256,
        });
      }
    }

    return { ok: true, updates };
  });

  fastify.get('/check-update', async (req, reply) => {
    const pkg = req.query.package;
    const currentVc = Number(req.query.versionCode ?? 0);
    if (!pkg) return reply.code(400).send({ error: 'package required' });

    const target = getActiveApkForPackage(pkg);
    if (!target || target.versionCode <= currentVc) {
      return { update: false };
    }
    return {
      update: true,
      package: target.package,
      versionCode: target.versionCode,
      versionName: target.versionName,
      url: `/api/download/${target.id}`,
      sha256: target.sha256,
    };
  });

  fastify.get('/download/:id', async (req, reply) => {
    const apk = getApk(req.params.id);
    if (!apk) return reply.code(404).send({ error: 'not found' });

    const filePath = path.resolve(apk.filePath);
    try {
      const st = await stat(filePath);
      reply
        .header('Content-Type', 'application/vnd.android.package-archive')
        .header('Content-Length', st.size)
        .header('Content-Disposition', `attachment; filename="${apk.package}-${apk.versionCode}.apk"`)
        .header('X-SHA256', apk.sha256);
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: 'file missing' });
    }
  });
}
