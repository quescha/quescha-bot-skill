# Краткая памятка по формату

Рабочий файл — `bot.json`, объект с 18 обязательными полями:

```json
{
  "groupnull": false,
  "groups": [], "chains": [], "messages": [],
  "schedules": [], "scheduleschains": [], "schedulesmessages": [],
  "shops": [], "shopschains": [], "shopsmessages": [], "landings": [],
  "lists": [], "listdata": [], "global": [], "external": [],
  "webapp": [], "webapprubric": [], "webappdata": []
}
```

Полный рабочий образец — `assets/starter/bot.json` внутри папки skill.

1. Числовые `id` положительные и уникальные внутри массива. Сохраняй связи `BotGroupId`, `BotChainId`, `ListId`, `WebAppId`, `WebAppRubricId`.
2. Строковый ID блока — ровно 8 латинских букв или цифр и уникален внутри `messages[].message`.
3. Все блоки интерактивного сценария находятся в одном шаге `messages` с `scenario:true` и `scenariotype:"common"`.
4. `messages[].message`, `lists[].headers`, `listdata[].data`, `external[].actions`, `chains[].keywords/channel/rangedays/email/messenger`, `webapp[].settings` — JSON внутри строки.
5. Переходы блока: `{label,value}`; `value` ссылается на блок того же шага. Кнопки действий используют строковый ID блока.
6. `externalbefore` и `conditionlist[].externalafter`: `{label,value}`, где `label` — точное название `external[].name`.
7. У цепочки должен быть запуск: `subscription`, `dialog`, `nothandled`, `keywords` или `addtagstart`.
8. В списке число значений строки равно числу `headers`; автополя: `ClientID`, `Messenger`, `BotID`, `CreationDate`.
9. Глобальная переменная `name:"Телефон"` читается как `#{g_Телефон}`.
10. `external.actions` — скомпилированный JSON-массив в строке. Для новых и изменяемых сценариев редактируй `external.code.js` с `scenario(...)` и `qb.*`: CLI сам обновит `actions`. Старый экспорт без такого исходника сохраняй в готовом JSON.
11. На блок `acceptpayment:true` ничего не ведёт. Блоки не перекрываются: используй шаг сетки 260×200 или больше.
12. Секреты не входят в экспорт. Оставляй понятные placeholders и инструкцию настройки владельцу.

ZIP: `data.txt` в корне + `upload/` с необязательными вложениями. Максимум 100 МБ, пути без `..`, абсолютных путей и символических ссылок.
