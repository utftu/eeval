# ordeal

Запуск эвалов для сервисов на ИИ. Кейс — асинхронная функция, которая зовёт сервис и возвращает балл 0..100; ordeal запускает кейсы в изолированных воркерах, сравнивает с порогом, печатает итог и пишет историю в `.ordeal/`. Использование — `README.md`, решения — `docs/decisions.md`.

## Стек

- Bun, TypeScript (strict), воркеры на web-API
- `argblock` — разбор аргументов CLI

## Команды

```sh
bun test                                  # тесты (src/**/*.test.ts)
bun run types                             # tsc --noEmit
bun run build                             # dist/: JS и .d.ts
bun src/cli/cli.ts [...paths] -t 3 -r 1   # прогон из исходников
bun dist/cli/cli.js examples -t 3 -r 1    # прогон примеров после сборки
```

## Структура

```
src/
  ordeal.ts                 вход пакета
  consts.ts                 значения по умолчанию
  types.ts                  запись прогона: RunRecord и вложенные
  cli/cli.ts                CLI: аргументы → discovery → пул → раннер → вывод → запись
  discovery/                поиск *.eval.ts/.tsx/.js
  eval/                     createEval, ctx.createCase, маркер эвала
  pool/                     пул воркеров, протокол, воркер, таймауты
  runner/                   trials, retries, прохождение кейса
  format/                   строки trial и итог деревом
  storage/                  .ordeal/history.jsonl и latest.json
examples/                   эвалы для ручной проверки
docs/decisions.md           решения
```
