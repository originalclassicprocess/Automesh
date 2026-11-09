# Внутренний API ядра Automesh v1

Точка входа: `src/lib/core/index.ts`. Это API библиотеки для **доверенного
контроллера**, не REST API, не опубликованный npm-пакет и не песочница.
Никакой сервер/порт не запускается. Для GitHub API приложения не нужен.
HTTP API — следующий отдельный адаптер, после определения аутентификации,
Origin/CORS, квот, привязки устройств, политик отзыва и долговечных повторов.

## Методы

| Метод | Результат / граница |
| --- | --- |
| `createCore({ environment?, identity?, replayStore?, policyStore? })` | Замороженный объект API версии 1; без identity работает проверка, но не подпись |
| `signObject(draft)` | Подписанный объект; ID/author/time задаёт ядро; **body не зашифрован** |
| `verifyObject(untrusted)` | Новая проверенная копия; не разрешение действия и не выполнение body |
| `issueGrant(body, expiresAt)` | Подпись права для одного субъекта/ресурса, без делегации |
| `authorize(grant, trustedPolicy)` | Проверка подписи, ограничений и актуального отзыва; отказ по умолчанию |
| `authorizeStored(grant, { issuer, subject, resource, action })` | Эпоха и актуальный отзыв из переданного PolicyStore; доверенный хозяин/ресурс задаются контроллером |
| `issueRevocation(update)` | Подпись обновления политики от её issuer; не шифрует body |
| `applyRevocation(object, { issuer, recipient, resource })` | Проверенное обновление только заранее доверенной политики; не назначает владельца из сети |
| `acceptOnce(object, { author, recipient, kind })` | Проверка и атомарный claim операции; нужен ReplayStore; не проверяет grant |
| `verifyEnvelope(message, recipient, maxPayloadBytes?)` | Аутентифицированные метаданные, публичный ключ и **ещё зашифрованный** кадр старого конверта; нужно SecureSessions.receive |
| `close()` | Закрытие экземпляра и блокировка поздних результатов; IdentityProvider не уничтожается автоматически |

Зависимости environment: WebCrypto subtle, проверенные часы Unix в миллисекундах
и генератор уникального UUID. Значения по умолчанию — crypto.subtle, Date.now,
crypto.randomUUID. Тесты могут передать управляемые часы; production не должен
принимать время/ID-генератор от сетевого запроса. ReplayStore.claim должен быть
атомарным, поддерживать срок и не удалять действующие claims ради свободного места.

## Пример: подпись и проверка

```ts
import { createCore } from './src/lib/core';

// provider — уже разблокированный IdentityProvider контроллера аккаунта.
// Его не передают стороннему модулю. seed не входит в этот API.
const signing = createCore({ identity: provider });
const object = await signing.signObject({
  kind: 'post',
  audience: [],
  body: { title: 'Публичная заметка', text: 'Это НЕ секретные данные' },
});

const checking = createCore();
const verified = await checking.verifyObject(object);
// Далее модуль валидирует собственную схему body и безопасно отображает текст.
// Не использовать body как HTML/код и не считать kind разрешением выполнить его.
signing.close();
checking.close();
// При блокировке контроллер отдельно уничтожает provider и закрывает сессии.
```

## Пример: ограниченное право

```ts
const grant = await signing.issueGrant({
  subject: recipientAccountId,
  resource: 'document:123',
  actions: ['read'],
  notBefore: Date.now(),
  epoch: 1,
  canDelegate: false,
}, Date.now() + 60_000);

await checking.authorize(grant, {
  issuer: resourceOwnerAccountId, // из доверенной политики документа
  subject: authenticatedCallerId, // из проверенной аутентификации посетителя
  resource: 'document:123',
  action: 'read',
  epoch: currentResourceEpoch,
  isRevoked: (issuer, grantId) => trustedPolicyStore.isRevoked(issuer, grantId),
});
// Только после успешной проверки — чтение конкретного документа.
// В этом примере используется собственный адаптер политики контроллера.
// Для долговечного браузерного адаптера см. следующий раздел.
```

Это независимые примеры: во втором signing/checking должны быть открыты.
Нельзя брать resourceOwnerAccountId/currentResourceEpoch из самого grant и
таким образом позволять посетителю назначить себе владельца или актуальную эпоху.
Отзыв недоступен — действие отклоняется. read не даёт write/execute.

## Операции и повторы

Для экспериментальных операций в одном процессе можно явно подключить
`new MemoryReplayStore(capacity)`. Для реальных долговечных задач нужен
постоянный адаптер (теперь реализован отдельно, см. ниже). Порядок проверки: схема/семантика задачи и доверенная
политика автора → authorize → acceptOnce → разрешённый эффект. Контроллер
не исполняет полученный JS, URL или команду оболочки автоматически.

При сбое после claim, но до эффекта, задача может быть потеряна. Для гарантий
доставки/выполнения необходимо связывать claim, очередь и эффект транзакционно
или реализовать idempotency внешней операции. acceptOnce не применён к чату
вместо его существующего протокола. Описание формата и ограничений — CORE_V1.md.

## Этап 0.1.4: долговечные адаптеры

`createDurableCoreState` принимает account scope, неизвлекаемый AES-GCM-256
ключ, CoreRecordStore с атомарным compare-and-swap, часы/WebCrypto и CSPRNG.
`src/lib/core-storage/browser.ts` реализует браузерный жизненный цикл с
IndexedDB и защитой от поздней записи после экстренного сброса.
`deriveCoreStorageKey` находится вне ядра; seed не входит в createCore.

```ts
// Только доверенный контроллер разблокированного конкретного профиля.
const storage = createBrowserCoreState({ accountId, key: profileStorageKey, trusted: true });
const core = createCore({ replayStore: storage.replayStore, policyStore: storage.policyStore });
// При первоначальном доверенном подключении ресурса, НЕ из неизвестного grant:
await storage.policyStore.initialize({ issuer: knownResourceOwner, recipient: accountId,
  resource: 'document:123', epoch: 1, validUntil: Date.now() + 60_000 });
await core.authorizeStored(grant, { issuer: knownResourceOwner,
  subject: authenticatedCallerId, resource: 'document:123', action: 'read' });
// Отдельно validate business schema + acceptOnce перед эффектом.
// При блокировке закрыть API И его адаптер:
core.close(); storage.close();
```

Не передавать storage или подписывающий core произвольному плагину.
Для недоверенной сессии persistent-адаптер отклоняется, запасного MemoryReplayStore
нет. Лимиты, freshness, накопительные отзывы и невозможность защиты от полного
отката/удаления базы описаны в **CORE_DURABLE_STATE.md**.
Это ещё не внедрение этих grants в действующую ноду или чат, и не HTTP API.

## Ошибки и версия

Методы возвращают Promise и отклоняют неверный ввод/неразрешённые действия.
Основные причины: `core_closed`, `core_read_only`, `invalid_signed_object`,
`invalid_core_object`, `invalid_object_signature`, `object_author_mismatch`,
`invalid_grant`, `permission_denied`, `replay_store_required`,
`object_not_accepted`, `object_replay`, `replay_capacity`,
`object_size_limit`, `object_complexity_limit`, `invalid_signed_envelope`.
Ошибки внешних криптографических/дисковых адаптеров тоже передаются вызывающему.
Это пока Error, не окончательный набор кодов будущего HTTP API. Внешний сервер
не должен выдавать посетителю технические подробности ошибок/секреты/трассировки.

Неизвестные версии и поля подписанной оболочки отклоняются. Новые байты,
действия, схемы миграций вводятся явно, не незаметной сменой старого формата.

## Проверка

```text
npm run check:core
npm run check
npm run test:core
npm test
npm run build
```

Эти изменения не требуют нового установщика ноды: её протокол не менялся.
Первый этап API включён в опубликованный релиз 0.1.3; дополнение с долговечными
адаптерами опубликовано как 0.1.4 с отдельной `/diagnostics/core`.
В обычные чаты адаптер пока не подключён. Реальные iPhone/Android и внешний
криптографический аудит в эту проверку не входят. Лицензия проекта и
видимость GitHub-репозитория этим изменением не назначаются.
