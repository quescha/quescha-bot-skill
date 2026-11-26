# Quescha Bot Skill

Локальный CLI и Agent Skill для создания и изменения ботов [Quescha](https://quescha.com) в Kimi Code, Claude Code, Codex, Cursor, DeepSeek Harness и других coding agents.

Результат — ZIP с `data.txt` и необязательными вложениями `upload/`, который пользователь загружает в свой аккаунт Quescha через **«Настройки аккаунта» → «Экспорт / Импорт»**. CLI не входит в аккаунт, не отправляет данные в сеть и не требует API-ключей Quescha.

## Что внутри

- независимый Node.js CLI без runtime-зависимостей;
- `skills/quescha-bot/SKILL.md` — самодостаточный skill с командами, справочниками и шаблоном;
- **полные русская и английская max-инструкции генерации**, а не сокращённый пересказ;
- локальный компилятор `external.code.js` с `scenario(...)` и `qb.*` в готовый JSON сценариев;
- проверка 18 полей экспорта, вложенного JSON, ID, связей, запуска цепочек, кнопок, блоков оплаты, координат и типовых секретов;
- полный локальный dry-run: переходы, достижимость, переменные, настройки действий и пробное выполнение JS с тестовыми данными;
- пользовательские смысловые тесты и обязательные мутационные проверки;
- сложный пример записи в салон с двумя списками, двумя сценариями и разграничением записей подписчиков;
- создание, распаковка и повторная проверка ZIP;
- JSON Schema и документация формата;
- unit/E2E-тесты CLI и аудит публичных файлов.

Пакет не содержит серверный runtime Quescha, базу данных, каналы, интеграции или код платформы. Компилятор и проверки — автономная публичная реализация. Локальные проверки не заменяют проверку диалога после импорта.

## Требования

- Node.js 18 или новее;
- coding agent с файловым и shell-доступом;
- аккаунт Quescha только для финального импорта и запуска бота.

## Быстрый путь: один промпт

Вставьте в свой coding agent:

```text
Установи себе skill Quescha Bot из https://github.com/quescha/quescha-bot-skill.
Скопируй каталог skills/quescha-bot целиком в поддерживаемый тобой каталог пользовательских skills, не только SKILL.md. После установки используй этот skill и создай бота: «Бот для записи в салон: услуги и цены, имя и телефон клиента, подтверждение записи и напоминание». Пройди check, test, mutate и build, проверь полученный ZIP командой inspect и дай мне путь к архиву. Не запрашивай мои токены Quescha.
```

Если агент не умеет скачивать репозиторий самостоятельно, установите skill одним из способов ниже.

## Установка по агентам

### Kimi Code

Пользовательский каталог: `~/.agents/skills/quescha-bot` (также поддерживается `~/.kimi-code/skills/quescha-bot`). Для одного проекта: `.agents/skills/quescha-bot`.

```bash
git clone https://github.com/quescha/quescha-bot-skill.git
mkdir -p ~/.agents/skills
cp -R quescha-bot-skill/skills/quescha-bot ~/.agents/skills/quescha-bot
```

Windows PowerShell:

```powershell
git clone https://github.com/quescha/quescha-bot-skill.git
New-Item -ItemType Directory -Force "$HOME\.agents\skills" | Out-Null
Copy-Item -Recurse -Force "quescha-bot-skill\skills\quescha-bot" "$HOME\.agents\skills\quescha-bot"
```

Вызов: `/skill:quescha-bot создай бота ...`. Автоматический вызов также разрешён по описанию skill. [Официальная документация Kimi Code](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html).

### Claude Code

```bash
git clone https://github.com/quescha/quescha-bot-skill.git
mkdir -p ~/.claude/skills
cp -R quescha-bot-skill/skills/quescha-bot ~/.claude/skills/quescha-bot
```

Для проекта используйте `.claude/skills/quescha-bot`. Вызов: `/quescha-bot создай бота ...`. [Официальная документация Claude Code](https://docs.anthropic.com/en/docs/claude-code/skills).

### Codex

```bash
git clone https://github.com/quescha/quescha-bot-skill.git
mkdir -p ~/.agents/skills
cp -R quescha-bot-skill/skills/quescha-bot ~/.agents/skills/quescha-bot
```

Для проекта используйте `.agents/skills/quescha-bot`. В Codex выберите skill через `/skills` или упомяните `$quescha-bot` в prompt. [Официальная документация Codex](https://developers.openai.com/codex/skills/).

### Cursor

```bash
git clone https://github.com/quescha/quescha-bot-skill.git
mkdir -p ~/.cursor/skills
cp -R quescha-bot-skill/skills/quescha-bot ~/.cursor/skills/quescha-bot
```

Поддерживаются также `~/.agents/skills`, `.cursor/skills` и `.agents/skills`. В Agent chat введите `/` и выберите `quescha-bot`. [Официальная документация Cursor](https://cursor.com/docs/context/skills).

### DeepSeek Harness

Пользовательские каталоги: `~/.dsh/skills/quescha-bot` и `~/.agents/skills/quescha-bot`; проектные: `.dsh/skills/quescha-bot` и `.agents/skills/quescha-bot`.

```bash
git clone https://github.com/quescha/quescha-bot-skill.git
mkdir -p ~/.dsh/skills
cp -R quescha-bot-skill/skills/quescha-bot ~/.dsh/skills/quescha-bot
```

Выберите skill в каталоге `/` или попросите агента вызвать `quescha-bot`. [Официальное описание обнаружения skills в DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md).

### Другой Agent Skills-совместимый агент

Скопируйте всю папку `skills/quescha-bot` в его skills-каталог. Если skill не поддерживается, попросите агента прочитать `SKILL.md` и выполнять его как рабочую инструкцию; CLI можно вызывать напрямую из `skills/quescha-bot/bin/quescha-bot.js`. Если skill не появился после установки, начните новую сессию или перезапустите агента.

## Промпты после установки

Повторная установка не нужна. Начинайте промпт с команды вашего агента:

- Kimi Code: `/skill:quescha-bot`;
- Claude Code: `/quescha-bot`;
- Codex: `$quescha-bot` или выбор через `/skills`;
- Cursor и DeepSeek Harness: введите `/` и выберите `quescha-bot`.

Пример создания:

```text
/skill:quescha-bot Создай бота записи в салон: услуги с ценами, имя, телефон и дата клиента, номер записи и просмотр только своих записей. Предусмотри пустой список и возврат в меню. Пройди check, test, mutate и build, проверь ZIP через inspect и дай путь к архиву.
```

Пример изменения:

```text
/quescha-bot Распакуй existing-bot.zip в новую папку my-bot. Добавь отмену записи, сохрани ID и listdata, дополни dryrun.js, тесты и мутации, собери новый ZIP. Исходный архив не изменяй.
```

Для другого агента замените команду в начале. Указывайте бизнес-результат, роли, путь клиента, данные, исключения и интеграции без секретов. Если поддерживается автоматический выбор skills, можно написать «Используй установленный Quescha Bot Skill…», но явная команда надёжнее.

## Как удалить skill

Удалите установленную папку `quescha-bot` и перезапустите агента. Рабочие папки, ZIP и проекты Quescha при этом не изменяются.

macOS / Linux:

```bash
rm -rf ~/.agents/skills/quescha-bot   # Kimi Code или Codex
rm -rf ~/.claude/skills/quescha-bot  # Claude Code
rm -rf ~/.cursor/skills/quescha-bot  # Cursor
rm -rf ~/.dsh/skills/quescha-bot     # DeepSeek Harness
```

Windows PowerShell:

```powershell
Remove-Item -Recurse -Force "$HOME\.agents\skills\quescha-bot"  # Kimi Code или Codex
Remove-Item -Recurse -Force "$HOME\.claude\skills\quescha-bot" # Claude Code
Remove-Item -Recurse -Force "$HOME\.cursor\skills\quescha-bot" # Cursor
Remove-Item -Recurse -Force "$HOME\.dsh\skills\quescha-bot"    # DeepSeek Harness
```

Выполняйте только команду для своего агента. Если установка была проектной, удалите `.agents/skills/quescha-bot`, `.claude/skills/quescha-bot`, `.cursor/skills/quescha-bot` или `.dsh/skills/quescha-bot` внутри проекта. Если Kimi Code использовал `~/.kimi-code/skills`, удалите `~/.kimi-code/skills/quescha-bot`. Каталог `~/.agents` может быть общим для нескольких агентов: его удаление отключит skill во всех них.

## Создание бота вручную через CLI

В примерах `QB` — путь к `skills/quescha-bot/bin/quescha-bot.js`.

```bash
node "$QB" init my-bot --name "Мой бот"
```

Агент или пользователь редактирует:

- `bot.json` — полный экспорт;
- `external.code.js` — сценарии `scenario/qb`, если боту нужны действия;
- `dryrun.js` — реалистичные данные и обязательные возможности для полного dry-run;
- `tests.js` — бизнес-проверки;
- `mutations.js` — намеренные поломки;
- `upload/` — вложения;
- `bot.config.json` — название, slug и пути файлов.

Затем:

```bash
node "$QB" check my-bot
node "$QB" test my-bot
node "$QB" mutate my-bot
node "$QB" build my-bot
node "$QB" inspect my-bot/dist/my-bot.zip
```

`build` последовательно выполняет check → test → mutate → pack и не создаёт итоговый ZIP при ошибке. Любая команда принимает `--json` для машинного вывода.

Готовый нетривиальный пример находится в [`skills/quescha-bot/assets/examples/booking/`](skills/quescha-bot/assets/examples/booking/): 7 блоков, 2 списка, 2 сценария, 6 действий, 6 смысловых тестов и 6 мутаций. Скопируйте его в рабочую папку и используйте как образец, не изменяя файлы установленного skill.

## Изменение существующего бота

1. Экспортируйте проект в аккаунте Quescha и сохраните резервную копию ZIP.
2. Выполните `node "$QB" unpack backup.zip my-bot`.
3. Измените `bot.json`, сохранив ID и накопленные `listdata`, если они нужны. Новые действия добавляйте через `external.code.js`; прежний готовый JSON действий сохраняется.
4. Дополните dry-run, тесты и мутации, выполните `build` и `inspect`.
5. Импортируйте как новый проект и проверьте его перед заменой рабочего бота.

Импорт может создать новые сущности; не направляйте непроверенный архив поверх рабочего проекта. Подписчики, каналы и подключённые интеграции настраиваются в аккаунте.

## Проверки и ограничения

Норма перед выдачей: **0 ошибок, 0 неразрешённых замечаний, все тесты пройдены, все мутации пойманы**. Список проверок — [references/checks.md](skills/quescha-bot/references/checks.md).

Dry-run выполняет JS-действия с заданными тестовыми данными и проверяет сценарии без запуска серверного runtime. CLI не подключает мессенджеры и не проверяет платежи или внешние API. Пользовательские `external.code.js`, `dryrun.js`, `tests.js` и `mutations.js` — локальный код, который запускается с правами текущего пользователя; проверяйте их перед запуском.

После импорта обязательно проверьте путь клиента в реальном канале, права ролей, повторные нажатия, ошибки ввода и настройки интеграций.

## Формат

- [Схема и 18 полей](docs/export-format.md)
- [JSON Schema](schema/bot-export.schema.json)
- [Руководство генерации](skills/quescha-bot/references/generation-guide.md)

## Разработка и аудит

```bash
npm install
npm run check
```

Перед публикацией аудит проверяет состав файлов, секреты, абсолютные пути и запрещённые серверные импорты. Не добавляйте в репозиторий реальные выгрузки клиентов, `.env`, архивы рабочих ботов или исходники платформы.
