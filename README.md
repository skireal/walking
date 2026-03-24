<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Walker

Приложение для отслеживания прогулок с туманом войны на карте.

## Запуск локально

**Требования:** Node.js

1. Установить зависимости:
   ```bash
   npm install
   ```
2. Запустить dev-сервер:
   ```bash
   ng serve --port 3050
   ```
3. Открыть в браузере: `http://localhost:3050/walker`

## Сборка APK для Android

**Требования:** Node.js, Android Studio (с установленным Android SDK)

1. Собрать Angular-приложение:
   ```bash
   ng build
   ```

2. Синхронизировать с Capacitor:
   ```bash
   npx cap sync android
   ```

3. Открыть проект в Android Studio:
   ```bash
   npx cap open android
   ```

4. В Android Studio:
   **Build → Generate App Bundles and APKs → Generate APKs → debug → Create**

5. Готовый APK будет по пути:
   ```
   android/app/build/outputs/apk/debug/app-debug.apk
   ```

6. Скинуть APK на телефон (через Telegram, Google Drive и т.д.), установить разрешив «Установку из неизвестных источников».

## Настройка на Android для фонового режима

Чтобы приложение корректно отслеживало маршрут с выключенным экраном:

- **Настройки → Приложения → Walker → Разрешения → Местоположение → Разрешить всегда**
- **Настройки → Приложения → Walker → Потребление заряда батареи → Без ограничений**
