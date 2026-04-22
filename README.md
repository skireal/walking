# Walker

Приложение для отслеживания прогулок с туманом войны на карте.

## Требования

- **Node.js 22.12.0** (через [Volta](https://volta.sh/) — версия зафиксирована в `package.json`)
- **Android Studio** с Android SDK (для сборки APK)
- **JAVA_HOME** — нужно установить один раз в переменных среды Windows:
  `JAVA_HOME = C:\Program Files\Android\Android Studio\jbr`
  *(Win + R → `sysdm.cpl` → Advanced → Environment Variables → System Variables → New)*

## Запуск локально

```bash
npm install
npm start
```

Открыть в браузере: `http://localhost:4200/`

## Сборка APK для Android

### Первый раз: настройка подписи

Создай файл `android/app/keystore.properties` (не попадает в git):

```properties
storeFile=walker-release.jks
storePassword=ВАШ_ПАРОЛЬ
keyAlias=walker
keyPassword=ВАШ_ПАРОЛЬ
```

> `walker-release.jks` должен лежать в `android/app/`. Храни его в надёжном месте — без него нельзя будет обновлять приложение.

### Сборка

```bash
npm run build
npx cap sync android
cd android
.\gradlew assembleRelease
```

Готовый APK:

```
android/app/build/outputs/apk/release/app-release.apk
```

Скинь на телефон (через Telegram, Google Drive и т.д.) и установи, разрешив «Установку из неизвестных источников».

## Настройка геолокации на Android

Для корректного отслеживания маршрута:

**Настройки → Приложения → Walker → Разрешения → Местоположение → Разрешить всегда**
