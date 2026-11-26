# Формат экспорта и импорта бота Quescha

ZIP для штатного импорта содержит:

```text
data.txt          JSON-объект экспорта в UTF-8
upload/           необязательные вложения, на которые ссылается бот
```

`data.txt` не является JavaScript и не содержит Markdown. Публичный CLI сохраняет JSON без форматирования внутри ZIP; рабочий `bot.json` форматируется для редактирования.

## 18 обязательных полей

| Поле | Тип | Назначение |
|---|---|---|
| `groupnull` | boolean | Признак экспорта сущностей вне проекта; для нового бота обычно `false` |
| `groups` | array | Проекты бота |
| `chains` | array | Цепочки и триггеры запуска |
| `messages` | array | Шаги цепочек; интерактивные блоки лежат внутри `message` |
| `schedules` | array | Рассылки |
| `scheduleschains` | array | Связи рассылок и цепочек |
| `schedulesmessages` | array | Связи рассылок и сообщений |
| `shops` | array | Устаревший модуль магазинов; новый каталог — через WebApp |
| `shopschains` | array | Связи старого магазина |
| `shopsmessages` | array | Сообщения старого магазина |
| `landings` | array | Бот-лендинги |
| `lists` | array | Списки-таблицы |
| `listdata` | array | Начальные строки списков |
| `global` | array | Глобальные переменные |
| `external` | array | Сценарии действий с готовым JSON в `actions` |
| `webapp` | array | Каталоги, календари и мини-приложения |
| `webapprubric` | array | Рубрики каталогов |
| `webappdata` | array | Товары каталогов |

Пустые разделы представляются `[]`, а не отсутствующим полем или `null`. Машинная схема: [`schema/bot-export.schema.json`](../schema/bot-export.schema.json). Схема намеренно допускает дополнительные свойства записей: это сохраняет совместимость с полями конструктора, не перечисляя внутреннюю модель целиком.

## Числовые и строковые ID

Числовые `id` записей положительные и уникальные внутри своего массива. Связи:

```text
chains.BotGroupId          → groups.id
messages.BotChainId        → chains.id
lists.BotGroupId           → groups.id
listdata.ListId            → lists.id
global.BotGroupId          → groups.id
external.BotGroupId        → groups.id
webapp.BotGroupId          → groups.id
webapprubric.WebAppId      → webapp.id
webappdata.WebAppId        → webapp.id
webappdata.WebAppRubricId  → webapprubric.id или null
```

Блоки внутри `messages[].message` имеют строковый ID из 8 символов `[A-Za-z0-9]`. Он уникален внутри шага. Переходы не ищут блоки в других шагах.

## Вложенный JSON хранится строкой

Это принципиальная часть формата, а не ошибка примера:

| Запись | Поля с JSON в строке |
|---|---|
| `chains` | `channel`, `keywords`, `rangedays`, `email`, `messenger` |
| `messages` | `message` — массив блоков |
| `lists` | `headers` — массив названий колонок |
| `listdata` | `data` — массив значений |
| `external` | `actions` — массив действий |
| `webapp` | `settings`; структуры `data` зависят от типа |

Пример: `"headers":"[\"Название\",\"ClientID\"]"`, а не `"headers":["Название","ClientID"]`.

## Минимальные записи

Проект:

```json
{ "id": 100001, "name": "Мой бот", "ordernumber": 1 }
```

Цепочка содержит как минимум `id`, `code`, `name`, `ordernumber`, `BotGroupId`, `channel`, `keywords`, `subscription`, `dialog`, `nothandled` и поля расписания. Полный рабочий пример находится в `skills/quescha-bot/assets/starter/bot.json`.

У интерактивной цепочки должен быть способ запуска: `subscription:true`, `dialog:true`, `nothandled:true`, непустые `keywords` или `addtagstart`.

Шаг содержит `id`, `ordernumber`, `message`, `code`, `scenario:true`, `scenariotype:"common"`, `BotChainId` и остальные поля из примера. Для одного интерактивного сценария — один общий шаг со всеми блоками.

Блок содержит как минимум:

```json
{
  "id": "start000",
  "x": 0,
  "y": 0,
  "order": 0,
  "name": "Главное меню",
  "text": "Здравствуйте!",
  "media": [],
  "btn": [],
  "conditionlist": [{ "nextmessage": null, "externalafter": null, "cond": "" }],
  "externalbefore": null,
  "acceptpayment": false,
  "wronganswer": null
}
```

Переход блока и его кнопки: `{ "label": "Следующий блок", "value": "next000" }`. Ссылка на сценарий действий: `{ "label": "Точное имя сценария", "value": 0 }`. Текст `[Actions]` требует `externalbefore`.

Список:

```json
{ "id": 100401, "name": "Услуги", "headers": "[\"Название\",\"Цена\",\"ClientID\",\"Messenger\",\"BotID\",\"CreationDate\"]", "ordernumber": 0, "count": null, "BotGroupId": 100001 }
```

Число значений в каждой строке `listdata` должно совпадать с числом колонок, включая автополя `ClientID`, `Messenger`, `BotID`, `CreationDate`.

Глобальная переменная:

```json
{ "id": 100501, "name": "Телефон", "note": "Публичный телефон", "value": "+7 ...", "ordernumber": 0, "BotGroupId": 100001 }
```

В тексте она читается как `#{g_Телефон}` с точным совпадением имени.

Сценарий действий:

```json
{ "id": 100601, "name": "Оформить запись", "ordernumber": 0, "actions": "[]", "BotGroupId": 100001, "CrmId": null }
```

В архиве `actions` всегда содержит **готовый JSON действий**. В рабочей папке сценарии удобно писать в `external.code.js` через `await scenario(...)`, `qb.step(...)` и `qb.cfg.*`: локальный компилятор преобразует их при проверках и сборке. Полный пример — `skills/quescha-bot/assets/examples/booking/`. Старый экспорт без `external.code.js` остаётся рабочим источником готового JSON. Смысловые тесты обязаны проверять критические поля действий.

## Правила безопасного архива

- Пути только относительные, без `..`, абсолютных путей и символических ссылок.
- Общий размер — не более 100 МБ.
- В `upload/` складываются только нужные боту файлы; посторонние файлы и секреты запрещены.
- Перед импортом проверьте архив `quescha-bot inspect archive.zip`.
- Сохраняйте исходный экспорт перед изменением рабочего бота.

Формат даёт совместимый контейнер, а dry-run ловит многие ошибки связей, переменных, настроек и JS. Ни то ни другое не доказывает поведение каждого действия в серверном runtime. Финальная проверка выполняется после импорта в аккаунт.
