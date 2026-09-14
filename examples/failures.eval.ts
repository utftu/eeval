import { createEval } from "eeval";

// Пример для ручной проверки того, как eeval ведёт себя на неудачах.

export const failures = createEval("failures", (ctx) => {
  ctx.createCase({ name: "ниже порога", minScore: 80 }, async () => {
    return { score: 61, output: { note: "ответ неполный" } };
  });

  // Падает примерно в половине вызовов. Счётчик в переменной модуля здесь
  // не годится: модуль у каждого воркера свой и обнуляется при замене воркера.
  // Без --retries trials краснеют через раз, с -r 2 почти всегда чинятся.
  ctx.createCase({ name: "падает через раз", minScore: 50 }, async () => {
    if (Math.random() < 0.5) {
      throw new Error("429 Too Many Requests");
    }

    return 90;
  });

  // Bun.sleep сигнал не слушает, поэтому abort не поможет: через секунду
  // таймаута и секунду отсрочки воркер будет убит и заменён. Таймаут — это
  // исключение, поэтому с --retries каждая попытка снова ждёт две секунды.
  ctx.createCase({ name: "зависает", minScore: 50, timeout: 1000 }, async () => {
    await Bun.sleep(10_000);

    return 90;
  });
});
