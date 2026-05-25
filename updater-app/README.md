# adm-updater

Expo / React Native клиент для adm-tool. Шлёт heartbeat на сервер, проверяет
наличие новых APK для целевого приложения, скачивает и запускает установку.

## Настройка

1. Установить зависимости:

   ```powershell
   pnpm install
   ```

2. Скопировать `.env.example` → `.env` и прописать:

   ```env
   EXPO_PUBLIC_SERVER_URL=http://192.168.1.10:8080
   EXPO_PUBLIC_TARGET_PACKAGE=com.example.app
   EXPO_PUBLIC_HEARTBEAT_SECONDS=300
   ```

3. Запуск в Expo Go (для быстрой проверки UI и heartbeat):

   ```powershell
   pnpm start
   ```

   Минус: установка APK через intent-launcher в Expo Go не работает. Для
   полной проверки нужен dev-build или production APK.

4. Сборка APK через EAS:

   ```powershell
   pnpm build:preview
   ```

## Что делает приложение

- При старте и каждые `HEARTBEAT_SECONDS` секунд: собирает snapshot
  устройства (serial = ANDROID_ID, IP, батарея, версия Android, версия
  самого апдейтера) и шлёт `POST /api/heartbeat`.
- Сервер в ответе присылает массив `updates[]` — пакеты для которых на
  сервере активна более новая версия.
- Пользователь видит список обновлений и тапает «Установить» — APK
  скачивается в кэш и запускается системный диалог установки.

## Ограничения v1

- **Чтение версии целевого приложения не реализовано** — Android 10+
  закрыл доступ к `PackageManager` для чужих пакетов без декларации
  в `queries` в манифесте + нативного кода. В v1 показываем целевой
  пакет как `versionCode: 0`, поэтому сервер всегда будет считать его
  устаревшим. План на v2: маленький Expo config plugin с нативным
  модулем поверх `getPackageInfo()`.
- **Установка с диалогом подтверждения** — пользователь тапает «ОК» в
  системном диалоге. Для тихой установки нужен device owner mode на
  планшете + замена `IntentLauncher` на нативный `PackageInstaller.Session`.
- **Heartbeat работает только пока приложение открыто** — для фоновой
  работы нужно подключать `expo-task-manager`.

## Сборка через GitHub Actions

В репозитории настроен workflow `.github/workflows/build-apk.yml`,
который собирает release APK без EAS и кладёт его в артефакты сборки.

**Запуск:**

- Автоматически на push в `main` если изменился `updater-app/**`.
- Вручную через **Actions → Build Updater APK → Run workflow**. В форме
  можно перебить `server_url` / `target_package` для этой конкретной сборки.

**Настройка дефолтов** (Settings → Secrets and variables → Actions → **Variables**):

| Variable                          | Пример                       |
| --------------------------------- | ---------------------------- |
| `EXPO_PUBLIC_SERVER_URL`          | `http://192.168.1.10:8080`   |
| `EXPO_PUBLIC_TARGET_PACKAGE`      | `com.company.factoryapp`     |
| `EXPO_PUBLIC_HEARTBEAT_SECONDS`   | `300`                        |

Если переменные не заданы, используются дефолты из `.env.example`.

**Где взять APK:**

- **GitHub Releases** — для каждой удачной сборки `main` создаётся релиз
  с тегом `build-N` и приложенным APK. Самый простой канал раздачи на
  планшеты (можно открыть страницу релиза в браузере планшета и нажать
  «Скачать»).
- **Actions → конкретный run → Artifacts** — то же самое, но без
  публичного релиза (хранится 30 дней). Удобно для одноразовых сборок
  с перебитыми параметрами через workflow_dispatch.

**Подпись:** APK подписывается `debug.keystore` из Expo-шаблона — этот
ключ одинаков между сборками, поэтому обновление через adm-tool сервер
работает корректно. Для production-ключа замените блок «Build release
APK» на свой `signingConfig` с секретами `ANDROID_KEYSTORE_BASE64` и т.д.

## Сценарий деплоя на планшет

1. Поставить `adm-updater.apk` (этот проект, собранный EAS).
2. Поставить целевой APK (любой ваш кастомный).
3. Открыть adm-updater — он зарегистрируется на сервере и начнёт ловить
   обновления.
