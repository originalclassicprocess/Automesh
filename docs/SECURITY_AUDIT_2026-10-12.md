# Внутренний аудит и hardening · 12 октября 2026

Область: Automesh (старые и новые функции), общий протокол/ядро нод,
Windows-адаптер/упаковка, Linux/server и Passenger, админ-панель,
клиентские загрузки, границы релиза. Кандидат приложения 0.2.9, ноды 0.4.1.
Это инженерная проверка с исправлениями, отрицательными тестами и реальными
прогонами Windows/Linux, НЕ независимый криптоаудит, сертификация ASVS,
построчное доказательство всего кода или обещание отсутствия уязвимостей.
Production в этом проходе не обновлялся.

## Подтверждённые находки и исправления

| Находка | Угроза / эффект | Исправление и проверка |
| --- | --- | --- |
| Произвольные поля/info/текст ошибки внешней ноды | Подмена UI, неограниченные типы; XSS/утечка не доказаны | Явные типы/ограничения, известные error codes, bounded JSON, allowlist подписываемых путей и отмена перед подписью; client/admin tests |
| Старый парольный vault использует 300 000 PBKDF2-SHA256 | Более дешёвый перебор украденного vault, особенно слабого пароля | v3: 600 000, фиксированный аутентифицированный формат; v1/v2 читаются и обновляются после успешного входа; frozen-format/tamper/downgrade/race tests |
| Windows ZIP не проверял обязательные файлы, дубли, размеры и SHA-256 | Повреждённый/неполный пакет мог начать перезапись; не доказана удалённая эксплуатация | Проверка всего архива до записи; hash каждого payload; негативные ZIP fixtures; packaged-validator реально выполнен без установки |
| Предсказуемый config.json.new | Локальная подмена временного пути, случайная перезапись; атакующий с тем же Windows-user уже внутри модели доверия | Случайный путь, CreateNew, flush(true), атомарный Replace; DPAPI reload/migration/repeated saves и sentinel test |
| Прерывание Windows program update | Возможен смешанный backend/скрипты и отказ запуска | Проверка installed manifest/hash до запуска backend; несовпадение останавливает запуск. Обновление program files не объявляется полностью транзакционным; повторная установка исправляет файлы, private data отдельно |
| Nginx-шаблон не включал новые inbox/admin/panel | При развёртывании по шаблону входящие/панель блокировались | Явный allowlist новых public routes и assets, verified upstream TLS, control закрыт; regression. Это не установленная причина всех исторических мобильных сбоев |
| Разные исходники нод: app 0.3, canonical 0.4 | Риск выпустить старый backend вместо новых receiving/admin fixes | Снимок 0.4.1 по source allowlist, SHA-256 provenance и сохранение предыдущих изменённых файлов; без Git reset, ключей/очередей/конфигов |
| Неограниченный JSON старого download lookup | Некорректное описание/ресурсы; UI не давал выбора ОС | Новый typed manifest до 8 KiB, только fixed same-origin URLs, no redirects/credentials, timeout/abort; отдельные платформы, размер/version/hash/unsigned статус |

Для work factor сверена [рекомендация OWASP для PBKDF2-HMAC-SHA256](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Она не превращает слабый пароль в сильный и не является сертификатом безопасности.

## Границы и свидетельства

| Область старого/нового кода | Проверенные свойства / основные тесты | Остаточная граница |
| --- | --- | --- |
| Identity, addressing, vault, encrypted backup, profiles | P-256 key/address binding; nonextractable signing key; dispose/generation; KDF/AAD/tamper; registry derivations; storage epochs/tab locks | JS memory copies/strings, malware same-origin/user; старый v1 metadata не был защищён; seed + archive открывает архив |
| Online MAE, сообщения, файлы | Подпись до SecureSessions; transcript/roles, direction keys, 64-bit nonce bound, replay; authenticated chunks/hashes/limits; secure-session, ChatService, file-transfer tests | Самописный live protocol; нет Double Ratchet/PCS. Не менять протокол поспешно во время UI-патча |
| Offline HPKE/courier/получение | Подпись автора/ноды/ACK, получатель/prekey, TTL; подписанный independent HTTPS inbox; ACK после save; 32 unlock cycles, lost ACK, old actor after stop | Нода может отказать/задержать/удалить, prekeys конечны; одинаковый seed без encrypted history не восстановит очередь |
| Старый LAN + новый server/Passenger | HTTPS/WSS/Host/Origin, exact one-use proof, членство/изоляция, quotas/TTL, signed LAN-only, Unix listener proof; core/server/passenger suites | Proxy/OS настройка оператора; NAT/сон/фон телефона не решены; shared global limits не заменяют anti-DDoS провайдера |
| Админ-панель и привязки | Local bootstrap, explicit consent, signed exact origin/nodeId/ticket, отдельный owner; poll token не в QR; secure cookie, Origin/CSRF, 15-min expiry, replay/revoke/close | Злонамеренный профиль/admin/user process; визуальное сверение адреса/QR остаётся важно; не считать 8 профилей multi-tenant marketplace |
| Новые звонки | Сигналы только authenticated MAE; offer/answer digest и DTLS binding; микрофон выключен до подтверждения; stop tracks/timer/history/session races | Оба клиента должны быть открыты; IP visible to direct peer; browser speaker support varies; TURN отсутствует |
| Аватары/скрины/стикеры/ZIP/голос | Ограничение bytes/pixels; metadata filter до hash/encryption; ZIP expanded budget/names/count; opaque blobs; async generations and microphone errors; media/clipboard/avatar/ZIP tests | Browser decoder bugs не sandbox-изолированы; metadata filter сохраняет необходимую ориентацию/цвет, не стирает содержание картинки; видео не очищается |
| UI, transport/admin links, updates, release | Source scan всех production файлов на опасные HTML/JS sinks; escaped Svelte/textContent; canonical URL/explicit consent; CSP/dev fixtures closed; versions/locks/checksums | Это не taint analysis. CSP/nonextractable не защищают от взломанного сайта/зависимости/обновления |
| Windows/Linux секреты, диск, запуск | DPAPI текущего user; отдельный Linux master, AEAD-purpose, NOFOLLOW/private paths, flock, no re-init on corruption; fsync/rename, crash markers | Root/тот же user/активный процесс не защищены. Windows directory fsync отсутствует. Не secure erase SSD/backup |

Источник контекста: предыдущие [crypto review](AUDIT_2026-10-02.md),
[network review](NETWORK_DELIVERY_AUDIT_2026-10-07.md),
[receiving recovery](RECEIVE_QUEUE_2026-10-11.md) и
[первый проход 12 октября](SECURITY_RELIABILITY_PASS_2026-10-12.md).
Старые свидетельства не приписываются новой сборке без повторного прогона.

## Воспроизводимые проверки

- `vitest run`: 136 файлов / 825 tests PASS после обновления ядра и vault.
- Ноды отдельно: Windows и Linux запускались штатным node:test runner;
  platform-specific tests пропускаются только на другой ОС. Итоговые числа
  и SHA пакетов зафиксированы в [отчёте сборок](NODE_DOWNLOADS_2026-10-12.md).
- Linux: изолированная временная папка на существующем сервере, официальный
  Linux runtime из самого архива; fake profiles/keys/certs; live config,
  production process, private identity/admin и очереди не менялись.
- `npm audit --json`: **0** опубликованных уязвимостей во всех зависимостях
  приложения и canonical nodes, включая dev. Это не анализ собственного кода.
- Node.js 24.21.0: официальные Windows/Linux hashes сверены с
  [SHASUMS256](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt) и latest-v24.x
  на дату проверки. Linux ELF architecture и hashes проверяются сборщиком.
- `security-release-check.mjs`: версии/lock, provenance, forbidden sinks,
  hashes двух артефактов и исключение секретов/test trees из Linux-пакета.
- Отдельно: Svelte/TypeScript, production build/test, inspector CAB/ZIP,
  packaged validation, DPAPI launcher и изолированные Windows smoke checks.

## Что НЕ закрыто и не выдаётся за безопасный production

1. Независимый криптоаудит MAE/HPKE glue и threat model. Ratchet/PCS и
   независимые protocol vectors остаются следующим отдельным проектом.
2. Подпись Windows installer/отдельная проверяемая подпись Linux artifacts:
   нужен контролируемый signing key/certificate и процесс публикации. SHA-256
   с того же сайта не защищает от взлома сайта. Пакеты — unsigned preview.
3. Взлом клиента, ОС, хостинга, CDN/repository/maintainer; upstream/DDoS,
   конфигурация production firewall/ACME, резервные копии и restore drill.
   Внутренний кодовый аудит не подтверждает патчи ОС или внешние настройки.
4. Реальные Safari/Android background/lock/power-loss условия: автотесты
   состояния/перезапуска не равны испытанию каждого мобильного устройства.
5. Публичный платный оператор: tenant quotas, billing/abuse, SLA, redress и
   каталог доверия не реализованы. TURN, маркет/платежи/бизнес-формы не включены.

Перед выпуском: проверить signing/release process, сохранить backup master
и data, обновить все активные вкладки. После миграции vault v3 старый клиент
0.2.8 не умеет читать эту запись; откат UI к нему не является откатом данных.
Не очищать storage и не сбрасывать аккаунт при ошибке входа: обновить клиент.
Seed/адреса и формат encrypted chat history этим патчем не меняются.
