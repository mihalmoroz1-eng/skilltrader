# Исследование: Android APK, AI-backend и TradingView MCP

**Дата проверки:** 23 ноября 2026 года. Исходный код Skill Trader остаётся в приватном GitHub-репозитории; сайт и API не публикуются без отдельного решения.

## Android APK

Для существующего React 19/Vite-интерфейса практичный путь — упаковать собранные веб-ресурсы через Capacitor, не переносить приложение в отдельный native UI. В документации текущей ветки Capacitor 8 указаны Node.js 22+, Android Studio 2025.2.1+ и Android SDK; для Android нужен полный JDK 21 (наличие только Java runtime не достаточно). Android-проект Capacitor включает Gradle Wrapper, поэтому глобальный Gradle не обязателен. Capacitor 8 нацелен на Android API 36 и поддерживает устройства с API 24+ [1–5].

Обычный Capacitor APK может содержать собранные `dist/public` ресурсы и показывать демо-интерфейс офлайн. Это не помещает Express/tRPC сервер внутрь APK. В проекте клиент обращается к относительному адресу `/api/trpc`; внутри APK такой адрес указывает на локальный WebView origin, а не на сервер. Поэтому офлайн-пакет может работать с синтетическими графиками, локальными расчётами и сохранёнными на устройстве настройками, но AI нужно честно отключить или явно сообщать, что backend недоступен. Нельзя подменять ответы модели заглушками, выдавая их за реальные.

Полноценная AI-функция требует доступного по HTTPS backend. Для неё понадобятся отдельный API base URL, корректная настройка CORS для Capacitor origin (обычно `https://localhost`), проверка OAuth/cookie-потока на Android и сохранение ключей модели только на сервере. Публикация frontend не является обязательной технически, но сервисный backend всё равно должен быть доступен устройству в сети; его размещение и публикация не авторизованы текущим решением [6–8].

На момент проверки в Sandbox доступен Java 21 runtime, но отсутствуют `javac`, Android SDK, Gradle и `adb`; в проекте нет Capacitor-конфигурации или `android/` каталога. Значит, сначала нужно добавить Android-обвязку и настроить SDK/JDK, а затем отдельно подтвердить сборку и установку APK.

## TradingView MCP

Видео показывает `LewisWJackson/tradingview-mcp-jackson`, то есть desktop-интеграцию, а не мобильный сетевой API. Этот сервер использует MCP по `stdio`, ожидает локальный запущенный TradingView Desktop и обращается к его Chrome DevTools Protocol на `localhost:9222`; часть интеграции опирается на недокументированные внутренние API. Android APK не может подключиться к такому процессу напрямую. Сетевой мост на компьютере пользователя потребовал бы отдельной аутентификации и узкого allow-list; нельзя открывать CDP порт 9222 в LAN/Internet или проксировать произвольный JavaScript [9–12].

TradingView также публикует собственный hosted MCP endpoint `https://mcp.tradingview.com/mcp` с Streamable HTTP и OAuth 2.1. Это отдельный вариант, не совместимый автоматически с Jackson MCP. Официальные материалы указывают, что мобильное подключение поддерживается в приложении Claude, но FAQ не обещает поддержку произвольных custom MCP-клиентов и ограничивает beta личным использованием. Перед разработкой клиента внутри Skill Trader нужно проверить актуальные правила и доступность конкретного OAuth-потока; наличие endpoint не означает разрешение на интеграцию в стороннее приложение или сервис [13–16].

Также нужны подходящий платный тариф и пользовательская OAuth-авторизация. Условия TradingView ограничивают обработку и передачу рыночных данных; нельзя предполагать разрешение на распространение сырых данных, unattended-сбор или автоматические торговые решения. Безопасный проектный предел — интерактивный read-only запрос с человеческим подтверждением и отображением результата только пользователю. Команда из видео «отрисовать уровни» меняет график и потому не является read-only; для строго read-only APK правильнее предложить уровни текстом, чтобы пользователь нанёс их сам. Ордеры и торговые действия не включать [14–17].

## Источники

[1]: https://capacitorjs.com/docs/getting-started/environment-setup "Capacitor: среда разработки"
[2]: https://capacitorjs.com/docs/android/setting-target-sdk "Capacitor: целевой Android SDK"
[3]: https://capacitorjs.com/docs/android "Capacitor: Android"
[4]: https://developer.android.com/studio/install "Android Studio: установка и SDK"
[5]: https://developer.android.com/build/building-cmdline "Android: сборка из командной строки"
[6]: https://capacitorjs.com/docs/config "Capacitor: конфигурация приложения и WebView origin"
[7]: https://capacitorjs.com/docs/cli/commands/sync "Capacitor: команда sync"
[8]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS "MDN: CORS и preflight"
[9]: https://github.com/LewisWJackson/tradingview-mcp-jackson "TradingView MCP Jackson: README и список инструментов"
[10]: https://raw.githubusercontent.com/LewisWJackson/tradingview-mcp-jackson/main/src/server.js "TradingView MCP Jackson: запуск stdio-сервера"
[11]: https://raw.githubusercontent.com/LewisWJackson/tradingview-mcp-jackson/main/src/connection.js "TradingView MCP Jackson: подключение к локальному Desktop через CDP"
[12]: https://github.com/LewisWJackson/tradingview-mcp-jackson/blob/main/RESEARCH.md "TradingView MCP Jackson: заметки о недокументированных API"
[13]: https://www.tradingview.com/mcp/docs "TradingView: официальный MCP"
[14]: https://www.tradingview.com/policies/ "TradingView: Terms of Use и правила рыночных данных"
[15]: https://www.tradingview.com/support/solutions/43000795699/ "TradingView: подключение MCP"
[16]: https://www.tradingview.com/support/solutions/43000795700-mcp-server-faq/ "TradingView: FAQ официального MCP"
[17]: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports "MCP: transports и Streamable HTTP"
