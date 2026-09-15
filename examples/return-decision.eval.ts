import { createEval } from "ordeal";

// Пример для ручной проверки. Вместо настоящего сервиса — имитация: отвечает
// с задержкой и иногда ошибается, как модель, поэтому с --trials видно разброс.

type Verdict = "refund" | "partial" | "reject";

type Claim = {
  name: string;
  photo: boolean;
  days: number;
  expected: Verdict;
};

const claims: Claim[] = [
  { name: "брак с фото в срок", photo: true, days: 3, expected: "refund" },
  { name: "брак без фото", photo: false, days: 3, expected: "partial" },
  { name: "возврат после срока", photo: true, days: 40, expected: "reject" },
];

async function decideReturn(claim: Claim, signal: AbortSignal): Promise<Verdict> {
  await Bun.sleep(100 + Math.random() * 400);
  signal.throwIfAborted();

  if (Math.random() < 0.2) {
    return "partial";
  }

  if (claim.days > 30) {
    return "reject";
  }

  return claim.photo ? "refund" : "partial";
}

export const returnDecision = createEval("return-decision", (ctx) => {
  for (const claim of claims) {
    ctx.createCase({ name: claim.name, minScore: 100 }, async (signal) => {
      const verdict = await decideReturn(claim, signal);

      return { score: verdict === claim.expected ? 100 : 0, output: { verdict } };
    });
  }
});
