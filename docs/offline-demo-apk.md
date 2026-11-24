# Skill Trader Offline Demo APK

## Что входит в демо

Android-пакет открывает собранный локально React/Vite интерфейс Skill Trader через Capacitor. Графики, сценарии, настройки и журнал используют локальные синтетические данные. AI-чат, TradingView, реальные рыночные данные и операции с ордерами в офлайн-сборке недоступны; экран AI сообщает, что серверные запросы не отправляются. Backend и credentials в APK не встраиваются.

## Сборка

Требования: Node.js 22+, pnpm 10.18.0, полный JDK 21, Android SDK Platform 36 и Android Build Tools, Android command-line tools. Android Studio не обязательна при наличии SDK; Gradle Wrapper включается в Capacitor Android scaffold.

```bash
pnpm install --frozen-lockfile
pnpm android:debug
```

`android:debug` собирает Vite assets с Vite mode `android-demo`, синхронизирует их с Android-проектом Capacitor и выполняет `./gradlew assembleDebug`. APK для локальной проверки ожидается здесь:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Debug APK подписывается для разработки и не является Play Store/release-сборкой. Не публиковать его в открытый доступ без отдельного решения владельца.

## Ограничения и проверка

Демо не вызывает AI backend и не зависит от сети для показа интерфейса. Для полного режима понадобится отдельно развернуть HTTPS backend, задать допустимый API base URL и реализовать мобильную OAuth/CORS-схему; ключи модели остаются только на сервере. TradingView интеграция в демо отсутствует: официальный MCP не предполагается доступным произвольному стороннему APK, а Jackson MCP требует локальный Desktop/CDP и не подходит как мобильный endpoint. Никакие сделки не выполняются.

Проверка Gradle APK не доказывает запуск на физическом устройстве. Если тестового Android-устройства или эмулятора нет в текущей среде, это указывается отдельно; окончательную установку/UX следует проверить на целевых версиях Android.
