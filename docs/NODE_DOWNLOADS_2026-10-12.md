# Ноды Windows/Linux и загрузки · кандидат 12 октября 2026

Приложение 0.2.9, общее ядро нод 0.4.1. Исходники сведены с canonical
`AutomeshNodes` по allowlist/SHA-256; старые изменённые файлы сохранены
в `.release/node-source-backup-*`. Репозитории/working changes не сбрасывались.

## Пользовательский путь

Настройки → Связь и ноды → Мои ноды → Скачать свою ноду → Проверить загрузки.
Две отдельные карточки Windows x64 и Linux x64. Ссылки появляются только после
проверки доступного описания. Версия, размер, SHA-256, preview/unsigned явно
видимы; неподдерживаемая платформа/пакет не подменяется автоматически.
В разделе установки используется тот же компонент, не другая механика.

Windows: `Automesh-Node-Setup.exe`, окно настройки/трей, выбор LAN, QR и коды,
автозапуск пользователя, управление привязанными профилями. Seed не нужен.
Сохранение private config — DPAPI current user; payload/installed backend
проверяются. Не отключать Windows protection. Пакет не имеет Authenticode.

Linux: `Automesh-Node-Linux-x64.tar.gz`, glibc x64, Node.js/production modules
внутри. Распаковка в новую папку → `./automesh-node setup` → `start`, затем
`admin-setup` и вход через веб-панель. Первая настройка только с подтверждением,
действующим сертификатом, отдельным master, private folders/exclusive create.
Повторная настройка НЕ заменяет identity/data; обновление — новой папкой,
старый `~/AutomeshNode` сохраняется. Автоматические firewall/служба/ACME/NAT
не включены. Полная [инструкция Linux](../nodes/docs/LINUX_NODE.md).

Домашний ПК не требует аренды VPS, но должен оставаться включённым без сна.
Доставка вне LAN требует рабочего интернет-маршрута. Это не обещание телефона
как фоновой ноды или автоматического доступа из любой сети.

## Сборка и проверки

Команды приложения: `node:build:windows`, `node:build:linux`.
Linux builder включает только public allowlist + npm ci --omit=dev
--ignore-scripts; закреплённый runtime сверяется с official Node SHA.
Windows ZIP включает program-only allowlist, ни configs/keys, ни developer
node_modules/data; packaged validator проверяется без исполнения установки.
Linux package имеет runtime/file hashes, executable POSIX modes, no test trees.

`security-release-check.mjs` проверяет root versions, node provenance,
production-source sinks, SHA/size/version двух пакетов и Linux archive paths.
Точный manifest находится в `static/downloads/node-release.json` и
`node-linux-release.json` (generated build artifacts, не ручной JSON).

## Статус публикации и границы

Итоговые пакеты:

| Платформа | Размер, bytes | SHA-256 |
| --- | ---: | --- |
| Windows 0.4.1 | 34877440 | `9a4394e9395d3de99b71f254e0a247e0de4543ea1f35aa134299bfe6d234bace` |
| Linux 0.4.1 | 46077641 | `27ce6e70542d34529330b95a856cb978685cd3c835a29d45691df25063d48ee2` |

Прогоны новой версии:

- Приложение: 136 files, 825 tests PASS; Svelte/TypeScript 0 errors/warnings.
- Ноды на Windows: 59 tests, 39 PASS, 20 Linux/POSIX SKIP.
- Ноды из самого Linux-пакета на текущем сервере, в изолированной папке:
  59 tests, 57 PASS, 2 Windows-specific SKIP. Включены новый personal setup,
  сохранность ключа при повторной настройке и отказ до записи при чужом SAN.
- Windows: DPAPI launcher/migration/repeated atomic saves/sentinel PASS,
  инспекция IExpress CAB, packaged ZIP validator, backend integrity PASS.
- Windows real launcher: LAN/loopback TLS, CORS, signed WSS, mailbox restart,
  DPAPI, GUI Save-and-start/TLS rotation/stale IP, local diagnostics PASS;
  offscreen UI/profile selection/defaults PASS. Без root trust/firewall изменений.
- Внутренний release gate: 269 production-source files, 87 canonical public
  node files; source provenance и оба artifact hashes PASS.
- Linux systemd unit не устанавливался; на текущем shared-хостинге
  systemd-analyze отсутствует. Проверка unit добавлена в Ubuntu release job;
  ещё не утверждается, что этот новый CI workflow был запущен на GitHub.

GitHub workflow дополнен отдельной Linux сборкой/артефактом и обязательной
проверкой обоих пакетов перед app build. Сам workflow/remote repo не запускался
и не публиковался автоматически этой локальной работой.

Это локально подготовленный кандидат. Production automesh.space и существующая
серверная нода в этом проходе не обновлялись. Новые карточки/пакеты будут
доступны пользователям после отдельно подтверждённой публикации кандидата.
Не заявлять, что current website уже предлагает Linux download.
Shared-hosting и личная Linux-нода имеют разные адаптеры запуска, но общее
ядро/протокол. Обновлять production ноду отдельным сохранным rollout; не
заменять shared-host entrypoint личным Windows/Linux launcher.

Пакеты без независимой подписи. Для массового production нужна подпись,
безопасный updater/restore и независимый security review. Удобство Linux пока
означает встроенный runtime и guided setup, а не zero-configuration desktop
GUI с автоматическим NAT/TLS. Бизнес-формы/витрины/оплата не реализовывались.
