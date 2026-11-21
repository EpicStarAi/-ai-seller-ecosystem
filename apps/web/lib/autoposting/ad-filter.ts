/** Conservative filter for obvious donor ads and giveaways. */
export type AdFilterResult = { rejected: false } | { rejected: true; reason: string };

const RULES: { reason: string; pattern: RegExp }[] = [
  { reason: "розыгрыш / giveaway", pattern: /розыгрыш|giveaway|\braffle\b|выиграй\s+(приз|uc|юс)|подпишись.{0,40}выигра/i },
  { reason: "промокод", pattern: /промокод|\bpromo\s*code\b|промо-код/i },
  { reason: "продажа UC / донат-магазин", pattern: /купи(ть|те)?\s+(uc|юс)|дешев(ые|ый|о)\s+(uc|юс)|донат(ы|ов)?\s+(uc|юс)|пополни(ть|те)?\s+(uc|юс)|(uc|юс)\s+за\s+\d+|\buc[\s-]*shop\b/i },
  { reason: "маркированная реклама", pattern: /#реклама\b|\berid\s*[:=]|реклама\s+(от|магазина|партн)/i },
];

export function detectDonorAd(text: string): AdFilterResult {
  const sample = (text || "").trim();
  if (!sample) return { rejected: false };
  for (const rule of RULES) {
    if (rule.pattern.test(sample)) return { rejected: true, reason: rule.reason };
  }
  return { rejected: false };
}
