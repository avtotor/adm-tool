# adm-tool

Централизованное управление обновлениями кастомных APK для парка
Android-планшетов в локальной сети.

```
┌────────────────────────────┐         ┌─────────────────────┐
│   adm-tool сервер          │         │   Планшет (×20)     │
│   (Node.js / Fastify)      │         │                     │
│                            │ ◄─HTTP─ │ adm-updater (Expo)  │
│   ├─ JSON-хранилище        │         │   ├─ heartbeat      │
│   ├─ Раздача APK           │ ────────│   ├─ download APK   │
│   └─ Web-админка           │         │   └─ install (intent│
└────────────────────────────┘         │      launcher)      │
                                       └─────────────────────┘
                                                  │
                                                  ▼
                                       ┌─────────────────────┐
                                       │ Целевой APK         │
                                       │ (любой кастомный)   │
                                       └─────────────────────┘
```

## Состав репозитория

| Папка                                   | Что это                                                                |
| --------------------------------------- | ---------------------------------------------------------------------- |
| [`server/`](server)                     | Node.js / Fastify сервер: API для планшетов + админка на EJS           |
| [`public/`](public)                     | Статика админки (`style.css`)                                          |
| [`data/`](data)                         | Runtime: `devices.json`, `apks.json`, `rollouts.json`, папка с APK     |
| [`updater-app/`](updater-app)           | Expo / React Native клиент для планшетов (см. его собственный README)  |
| [`.github/workflows/`](.github/workflows) | CI: сборка APK через `expo prebuild` + Gradle                        |

## Быстрый старт (сервер)

Требуется **Node.js 20+** и **pnpm 10+**.

```powershell
pnpm install
pnpm start
```

После запуска админка доступна по адресу `http://localhost:8080/`.
Для доступа с планшетов укажи **внешний LAN-IP** машины с сервером —
например `http://192.168.1.10:8080`.

Скрипты:

| Команда         | Что делает                                            |
| --------------- | ----------------------------------------------------- |
| `pnpm start`    | Запуск сервера в production-режиме                    |
| `pnpm dev`      | Запуск с `node --watch` — авто-перезагрузка на правки |

Переменные окружения (опционально):

| Переменная | Дефолт    | Описание                                |
| ---------- | --------- | --------------------------------------- |
| `HOST`     | `0.0.0.0` | Адрес для bind                          |
| `PORT`     | `8080`    | Порт                                    |

## Хранилище данных

Сервер не использует БД — всё лежит в [`data/`](data) как JSON, который
пишется атомарно через `.tmp` + `rename` под последовательной очередью
на файл. Достаточно для парка в несколько десятков устройств.

```
data/
├── devices.json    # текущее состояние всех планшетов (heartbeat)
├── apks.json       # каталог загруженных APK (метаданные)
├── rollouts.json   # { "com.example.app": "<apk-id>" } — какая версия активна
└── apks/
    └── <package>/<versionCode>.apk
```

Бэкап = `cp -r data data.bak`. Восстановление = обратная операция.

## HTTP API

Используется планшетным клиентом (адрес — `/api/...`).

### `POST /api/heartbeat`

Планшет рапортует о своём состоянии и получает список доступных
обновлений.

**Запрос:**

```json
{
  "serial": "android-id",
  "name": "Tablet 12",
  "ip": "192.168.1.50",
  "battery": 87,
  "android": "13",
  "packages": [
    { "package": "com.admtool.updater", "versionCode": 1, "versionName": "1.0.0" },
    { "package": "com.example.app",     "versionCode": 42, "versionName": "2.1" }
  ]
}
```

**Ответ:**

```json
{
  "ok": true,
  "updates": [
    {
      "package": "com.example.app",
      "versionCode": 45,
      "versionName": "2.2",
      "url": "/api/download/abc123",
      "sha256": "..."
    }
  ]
}
```

### `GET /api/check-update?package=<pkg>&versionCode=<vc>`

Альтернативный лёгкий эндпоинт для проверки одного пакета без heartbeat.

### `GET /api/download/:id`

Отдаёт APK по `id` из `apks.json`. Добавляет заголовок `X-SHA256` для
проверки целостности на клиенте.

## Админка

| URL                        | Что                                                                |
| -------------------------- | ------------------------------------------------------------------ |
| `/`                        | Список устройств: онлайн-статус, версии установленных пакетов      |
| `/apks`                    | Загрузка APK, список версий, активация (rollout), удаление         |

При загрузке APK сервер автоматически читает `package` / `versionCode` /
`versionName` из манифеста (через `adbkit-apkreader`) — заполнять руками
ничего не надо.

**Rollout**: на каждый пакет в любой момент активна **одна** версия —
именно её сервер предлагает клиентам в `updates[]`. Кнопка
«Активировать» меняет активную версию для пакета. Откат = активация
предыдущей.

## Сборка APK для планшетов

Полный гайд по клиентскому приложению — [`updater-app/README.md`](updater-app/README.md).

CI-сборка через GitHub Actions: workflow
[`build-apk.yml`](.github/workflows/build-apk.yml). Запускается
автоматически на push в `main` (если изменился `updater-app/`) и
вручную через **Actions → Build Updater APK → Run workflow**. Готовый
APK лежит в Artifacts конкретного run.

Перед первой реальной сборкой задай в **Settings → Variables**:

- `EXPO_PUBLIC_SERVER_URL` — адрес сервера, доступный с планшетов
- `EXPO_PUBLIC_TARGET_PACKAGE` — имя пакета твоего кастомного приложения

## Деплой сервера

Минимальный вариант — машина в локалке (мини-ПК, NAS, Raspberry Pi 4)
со статическим IP. Достаточно `pnpm start` под systemd / NSSM / pm2.

Пример systemd-юнита:

```ini
[Unit]
Description=adm-tool server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/adm-tool
ExecStart=/usr/bin/pnpm start
Environment=PORT=8080
Restart=always
User=admtool

[Install]
WantedBy=multi-user.target
```

Бэкап: периодически копировать `data/` куда-нибудь (cron, NAS-снапшот).

## Ограничения и планы

- **Чтение версии целевого приложения с планшета** — Android 10+ не даёт
  читать `PackageManager` для чужих пакетов без декларации и нативного
  кода. В v1 апдейтер сообщает только свою версию. План на v2 — Expo
  config plugin с небольшим Kotlin-модулем поверх `getPackageInfo()`.
- **Тихая установка без диалога** — требует device owner mode на
  планшете и замены `IntentLauncher` на `PackageInstaller.Session`.
- **Heartbeat работает пока приложение открыто** — для фоновой работы
  подключать `expo-task-manager` (или держать апдейтер в kiosk-режиме,
  что и подразумевается).
- **Без auth** — сервер открыт в локалке. Если репутация локалки под
  вопросом, добавить токен в `X-Auth-Token` заголовок и сравнивать его в
  middleware.

## Лицензия

Internal use — Avtotor.
