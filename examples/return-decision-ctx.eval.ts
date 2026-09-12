import { createEval } from "eeval";

import { decideReturn } from "../src/return/decide.ts";

type Verdict = "refund" | "partial" | "reject" | "manual";

type Claim = {
  reason: string;
  daysSinceDelivery: number;
  photos: number;
  priceRub: number;
};

type Decision = {
  verdict: Verdict;
  score: number;
};

function scoreVerdict(decision: Decision, expected: Verdict): number {
  if (decision.verdict === expected) {
    return decision.score;
  }

  return 0;
}

function scoreCalibration(decision: Decision, expected: Verdict): number {
  if (decision.verdict === expected) {
    return decision.score;
  }

  return 100 - decision.score;
}

const bulkClaims: { name: string; claim: Claim; expected: Verdict }[] = [
  {
    name: "вскрытая упаковка на 3-й день",
    claim: { reason: "вскрыл и передумал", daysSinceDelivery: 3, photos: 1, priceRub: 2300 },
    expected: "partial",
  },
  {
    name: "просрочка возврата на год",
    claim: { reason: "сломался", daysSinceDelivery: 380, photos: 4, priceRub: 15000 },
    expected: "reject",
  },
];

export const returnDecisionEval = createEval("return-decision", (ctx) => {
  ctx.createCase({ name: "брак с фото в срок", minScore: 80 }, async () => {
    const decision = await decideReturn({
      reason: "пришло разбитым",
      daysSinceDelivery: 2,
      photos: 3,
      priceRub: 4900,
    });

    return scoreVerdict(decision, "refund");
  });

  ctx.createCase({ name: "передумал на 20-й день", minScore: 80 }, async () => {
    const decision = await decideReturn({
      reason: "не подошёл цвет",
      daysSinceDelivery: 20,
      photos: 0,
      priceRub: 1200,
    });

    return scoreVerdict(decision, "reject");
  });

  ctx.createCase({ name: "брак без фото уходит на ручную проверку", minScore: 60 }, async () => {
    const decision = await decideReturn({
      reason: "не включается",
      daysSinceDelivery: 5,
      photos: 0,
      priceRub: 32000,
    });

    return { score: scoreVerdict(decision, "manual"), output: decision };
  });

  ctx.createCase({ name: "недостача в комплекте", minScore: 70 }, async () => {
    const decision = await decideReturn({
      reason: "нет зарядки в коробке",
      daysSinceDelivery: 1,
      photos: 2,
      priceRub: 8700,
    });

    if (decision.verdict === "partial") {
      return 100;
    }

    if (decision.verdict === "refund") {
      return 40;
    }

    return 0;
  });

  ctx.createCase({ name: "калибровка на дорогом заказе", minScore: 0 }, async () => {
    const decision = await decideReturn({
      reason: "не тот размер",
      daysSinceDelivery: 9,
      photos: 1,
      priceRub: 74000,
    });

    return scoreCalibration(decision, "reject");
  });

  for (const item of bulkClaims) {
    ctx.createCase({ name: item.name, minScore: 70 }, async () => {
      const decision = await decideReturn(item.claim);

      return scoreVerdict(decision, item.expected);
    });
  }
});
