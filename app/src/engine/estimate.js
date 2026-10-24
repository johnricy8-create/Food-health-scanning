// ⚠️ 自动生成，请勿直接修改。源文件：src/estimate.mjs（改完跑 npm run sync）
/**
 * 缺失营养素估算。
 *
 * 中国营养成分表强制标示只有"1+4"：能量、蛋白质、脂肪、碳水化合物、钠。
 * "糖"和"饱和脂肪"绝大多数产品不标 —— 而这两个恰恰是健康评分最关键的输入。
 * 所以必须从配料表推断，并且必须把"这是估算"这件事清楚地传给上层。
 */
import { firstIndexOf, containsAny } from "./knowledge.js";

const isNonCaloricSweetener = (token) => /糖醇|低聚/.test(token);

function resolveSugar(tokens, kb, params, carbG) {
  const cfg = params.sugarEstimate;

  // 1) 找第一个"会产生热量"的糖源
  let found = null;
  let foundIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (isNonCaloricSweetener(tokens[i])) continue;
    const kw = kb.caloricSugars.find((k) => tokens[i].includes(k) || expand(tokens[i]).includes(k));
    if (kw) {
      found = kw;
      foundIndex = i;
      break;
    }
  }

  // 2) 没找到糖源：按品类给一个自然存在的基线
  if (!found) {
    if (containsAny(tokens, kb.dairyKeywords)) {
      const r = cfg.noSugarFound.dairy;
      return { value: Math.min(carbG * r.fraction, r.capG), basis: "乳糖自然基线", confidence: "low" };
    }
    if (containsAny(tokens, kb.juiceKeywords)) {
      const r = cfg.noSugarFound.juice;
      return { value: Math.min(carbG * r.fraction, r.capG), basis: "果汁天然糖", confidence: "low" };
    }
    const r = cfg.noSugarFound.default;
    return { value: Math.min(carbG * r.fraction, r.capG), basis: "未见添加糖", confidence: "medium" };
  }

  // 3) 找到了：按糖源出现的位置分档，再加两个修正
  const band = cfg.bands.find((b) => foundIndex <= b.maxIndex) ?? cfg.bands.at(-1);
  let fraction = band.fraction;
  const notes = [`"${found}"位于配料第 ${foundIndex + 1} 位`];

  // 碳水主要来自淀粉时，糖占比要打折（否则方便面/饼干会被冤枉）
  const starch = firstIndexOf(tokens, kb.starchKeywords);
  if (starch && starch.index <= 3) {
    fraction *= cfg.starchDampening;
    notes.push(`主料为淀粉类（${starch.keyword}），下调糖占比`);
  }
  return {
    value: carbG * fraction,
    fraction,
    basis: notes.join("；"),
    confidence: "low",
    _band: band,
    _needsBeverageBoost: true,
  };
}

function expand(token) {
  const m = token.match(/[（(]([^）)]+)[）)]/);
  return m ? m[1].trim() : token;
}

function resolveSatFat(tokens, kb, params, fatG) {
  const cfg = params.satFatEstimate;
  let best = null;
  for (const rule of cfg.rules) {
    // dominantOnly 的规则要求该原料出现在配料表靠前位置，否则它是蛋白/辅料而非脂肪来源
    const hit = rule.dominantOnly
      ? firstIndexOf(tokens, rule.keywords)
      : null;
    const kw = rule.dominantOnly
      ? hit && hit.index <= cfg.dominantMaxIndex ? hit.keyword : null
      : rule.keywords.find((k) => containsAny(tokens, [k]));
    if (kw && (!best || rule.factor > best.factor)) best = { factor: rule.factor, keyword: kw };
  }
  if (!best) {
    return {
      value: fatG * cfg.default,
      factor: cfg.default,
      basis: "按混合脂肪默认比例估算",
      confidence: "low",
    };
  }
  return { value: fatG * best.factor, factor: best.factor, basis: `脂肪主要来自 ${best.keyword}`, confidence: "low" };
}

function resolveFiber(tokens, kb, params) {
  const cfg = params.fiberEstimate;
  for (const rule of cfg.rules) {
    if (rule.dominantOnly) {
      const hit = firstIndexOf(tokens, rule.keywords);
      if (hit && hit.index <= cfg.dominantMaxIndex) {
        return { value: rule.fiberG, basis: `按主料（${hit.keyword}）估算`, confidence: "low" };
      }
    } else if (containsAny(tokens, rule.keywords)) {
      return { value: rule.fiberG, basis: `按原料（${rule.keywords[0]}）估算`, confidence: "low" };
    }
  }
  return { value: 0, basis: "未标示，按 0 处理（保守）", confidence: "high" };
}

export function resolveNutrition(raw, tokens, kb, params, isBeverage) {
  const estimates = [];

  const carbG = num(raw.carbG);
  const fatG = num(raw.fatG);
  const proteinG = num(raw.proteinG);

  // 能量
  let energyKj = num(raw.energyKj);
  let energyBasis = "标签标示";
  if (energyKj == null && proteinG != null && fatG != null && carbG != null) {
    const e = params.energyFallback;
    energyKj = proteinG * e.proteinKj + fatG * e.fatKj + carbG * e.carbKj;
    energyBasis = "按 蛋白17/脂肪37/碳水17 计算";
    estimates.push("能量");
  }

  // 糖
  let sugarG = num(raw.sugarG);
  let sugarBasis = "标签标示";
  let sugarConfidence = "high";
  if (sugarG == null && carbG != null) {
    const r = resolveSugar(tokens, kb, params, carbG);
    sugarG = r.value;
    if (r._needsBeverageBoost && isBeverage) {
      sugarG = carbG * Math.min(r.fraction * params.sugarEstimate.beverageBoost, params.sugarEstimate.beverageCap);
    }
    sugarG = Math.min(sugarG, carbG);
    sugarBasis = r.basis;
    // 估算误差对总分的影响取决于绝对量：糖越高，估错的代价越大
    sugarConfidence = sugarG >= 8 ? "low" : "medium";
    estimates.push("糖");
  }

  // 饱和脂肪
  let satFatG = num(raw.satFatG);
  let satBasis = "标签标示";
  let satConfidence = "high";
  if (satFatG == null && fatG != null) {
    const r = resolveSatFat(tokens, kb, params, fatG);
    satFatG = Math.min(r.value, fatG);
    satBasis = r.basis;
    satConfidence = r.confidence;
    estimates.push("饱和脂肪");
  }

  // 膳食纤维
  let fiberG = num(raw.fiberG);
  let fiberBasis = "标签标示";
  if (fiberG == null) {
    const r = resolveFiber(tokens, kb, params);
    fiberG = r.value;
    fiberBasis = r.basis;
    if (r.confidence !== "high") estimates.push("膳食纤维");
  }

  return {
    values: {
      energyKj,
      proteinG,
      fatG,
      carbG,
      sugarG,
      satFatG,
      fiberG,
      sodiumMg: num(raw.sodiumMg),
    },
    estimates,
    detail: {
      energy: energyBasis,
      sugar: { basis: sugarBasis, confidence: sugarConfidence },
      satFat: { basis: satBasis, confidence: satConfidence },
      fiber: fiberBasis,
    },
    confidence: sugarConfidence,
  };
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
