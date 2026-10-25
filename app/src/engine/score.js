// ⚠️ 自动生成，请勿直接修改。源文件：src/score.mjs（改完跑 npm run sync）
/**
 * 评分引擎。
 *
 * 设计原则：
 *  1. 纯规则、无随机、无大模型参与 → 同一张标签永远得到同一个分数（可解释、可复现、审核可说明）
 *  2. 所有阈值和权重都在 config/params.json 里 → 调参不动代码
 *  3. 只输出"分数 + 扣分理由"，不输出"能不能吃" → 把决策权留给用户
 */
import {
  parseIngredients,
  matchAdditives,
  penaltyForAdditives,
  detectAllergens,
  estimateFvPercent,
  novaMarkers,
  findAll,
  containsAny,
} from "./knowledge.js";
import { resolveNutrition } from "./estimate.js";

/* ---------- 基础工具 ---------- */

/** 分段线性插值；points 必须按 x 升序 */
export function interp(points, x) {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  if (x <= p[0][0]) return p[0][1];
  if (x >= p.at(-1)[0]) return p.at(-1)[1];
  for (let i = 0; i < p.length - 1; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    if (x >= x1 && x <= x2) return x2 === x1 ? y2 : y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
  return p.at(-1)[1];
}

/** Nutri-Score 打分："严格大于几个阈值"就是几分 */
function pointsFor(value, thresholds) {
  if (value == null) return 0;
  let p = 0;
  for (const t of thresholds) if (value > t) p++;
  return p;
}

function fvPoints(percent, thresholds) {
  if (percent > thresholds[2]) return 5;
  if (percent > thresholds[1]) return 2;
  if (percent > thresholds[0]) return 1;
  return 0;
}

function gradeFromRank(final, g) {
  if (final <= g.A) return "A";
  if (final <= g.B) return "B";
  if (final <= g.C) return "C";
  if (final <= g.D) return "D";
  return "E";
}

/* ---------- Nutri-Score ---------- */

export function nutriScore(v, params, isBeverage, fvPercent) {
  const t = isBeverage ? params.nutriScore.beverage : params.nutriScore.solid;

  const energyP = pointsFor(v.energyKj, t.energyKj);
  const sugarP = pointsFor(v.sugarG, t.sugarG);
  const satFatP = pointsFor(v.satFatG, t.satFatG);
  const sodiumP = pointsFor(v.sodiumMg, t.sodiumMg);
  const proteinP = pointsFor(v.proteinG, t.proteinG);
  const fiberP = pointsFor(v.fiberG, t.fiberG);
  const fvP = fvPoints(fvPercent, params.nutriScore.fvThresholds);

  const neg = energyP + sugarP + satFatP + sodiumP;
  const pos = proteinP + fiberP;

  // 官方规则：负分 ≥11 且果蔬分满格时，蛋白质不计入（防止用蛋白粉"洗白"）
  const final = neg >= 11 && fvP === 5 ? neg - (fvP + fiberP) : neg - (fvP + pos);
  const grade = gradeFromRank(final, params.nutriScore.rankGrades);
  const score = Math.round(interp(params.nutritionMapping.anchors, final) * 10) / 10;

  return {
    points: { energyP, sugarP, satFatP, sodiumP, proteinP, fiberP, fvP },
    neg,
    pos,
    final,
    grade,
    score,
    table: isBeverage ? "beverage" : "solid",
  };
}

/* ---------- NOVA 加工程度 ---------- */

export function novaLevel(tokens, additives, markers) {
  if (markers.length >= 2) return { level: 4, reason: `含 ${markers.length} 种超加工标志成分` };
  if (markers.length === 1) return { level: 4, reason: `含超加工标志成分（${markers[0].value}）` };
  if (additives.length > 0) return { level: 3, reason: "含食品添加剂" };
  const hasBasic = containsAny(tokens, ["糖", "盐", "油", "醋", "酱油"]);
  if (!hasBasic && tokens.length <= 2) return { level: 1, reason: "单一/未加工原料" };
  if (hasBasic) return { level: 3, reason: "经调味或油脂加工的食品" };
  return { level: 2, reason: "由基础食材加工而成" };
}

/* ---------- 食用建议 ---------- */

/**
 * 食用建议：纯规则生成，只描述份量、搭配和场景。
 * 刻意不写"能不能吃 / 健不健康"——那是用户自己的判断。
 */
function buildAdvice({ values, isBeverage, servingG, servingKcal, dailyRefKcal }) {
  const unit = isBeverage ? "ml" : "g";
  const pct = Math.round((servingKcal / dailyRefKcal) * 100);
  const items = [];

  items.push({
    title: "一次吃多少",
    text: `一次约 ${servingG}${unit}，约 ${servingKcal} kcal，占每日参考能量（${dailyRefKcal} kcal）的 ${pct}%。`,
  });

  let pairing;
  if (isBeverage) {
    if ((values.sugarG ?? 0) > 5) {
      pairing = "含糖饮料饱腹感弱，随餐喝、控制总量比空腹喝更好把握。";
    } else if ((values.proteinG ?? 0) >= 3) {
      pairing = "可以搭配主食一起喝，顺便补一部分蛋白质。";
    } else {
      pairing = "几乎没有能量负担，按平时的量喝就行。";
    }
  } else if ((values.sodiumMg ?? 0) > 600) {
    pairing = "钠偏高。同一餐少放盐和酱油，多配新鲜蔬果。";
  } else if ((values.sugarG ?? 0) > 15) {
    pairing = "糖偏高。和鸡蛋、无糖酸奶这类蛋白质，或高纤维食物一起吃，血糖上升更平缓。";
  } else if ((values.fiberG ?? 0) < 1.5 && (values.carbG ?? 0) > 40) {
    pairing = "膳食纤维偏少。配一份蔬菜或水果，饱腹感更持久。";
  } else if ((values.proteinG ?? 0) < 3) {
    pairing = "蛋白质偏低。可以配一份奶、蛋或豆制品。";
  } else {
    pairing = "营养结构比较均衡，按平时的份量吃就行。";
  }
  items.push({ title: "怎么搭配", text: pairing });

  let occasion;
  if ((values.energyKj ?? 0) >= 1800) {
    occasion = "能量密度较高，更适合少量当零食，别拿它当正餐。";
  } else if (isBeverage && (values.sugarG ?? 0) > 5) {
    occasion = "液体热量饱腹感弱，容易在不知不觉中喝多，留意总量。";
  } else if ((values.proteinG ?? 0) >= 12 && (values.sugarG ?? 0) < 10) {
    occasion = "蛋白质充足、糖不高，适合当早餐或运动后的补充。";
  } else {
    occasion = "适合作为日常饮食的一部分，注意别用它替代正餐。";
  }
  items.push({ title: "什么时候吃", text: occasion });

  return items;
}

/* ---------- 分数解释 ---------- */

const DIM_CN = { nutrition: "营养质量", processing: "加工程度", additives: "添加剂" };
const TIER_CN = { high: "高关注", medium: "中等", low: "低关注" };

/**
 * 添加剂的"构成 + 含量"。
 *
 * 含量：标签一般只写名字不写添加量，但 GB 7718 要求配料按加入量递减排列，
 * 所以配料表排位就是含量的近似——排得越前，含量越高。这里如实说明是排位推断。
 */
function describeAdditives(additives, addPen, tokens) {
  if (!additives.length) return null;

  const tiers = ["high", "medium", "low"]
    .map((t) => [t, additives.filter((a) => a.tier === t).length])
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${TIER_CN[t]} ${n} 种`);

  // 按功能类别聚合，扣分重的排前面
  const classes = [...addPen.perClass]
    .sort((a, b) => b.penalty - a.penalty)
    .slice(0, 3)
    .map((c) => (c.count > 1 ? `${c.fn} ${c.count} 种` : c.fn));

  // 排位 = 含量高低的近似
  const ranked = additives
    .map((a) => ({ name: a.name, idx: tokens.findIndex((t) => t.includes(a.matchedAs)) }))
    .filter((a) => a.idx >= 0)
    .sort((a, b) => a.idx - b.idx)
    .slice(0, 3)
    .map((a) => `${a.name}（第 ${a.idx + 1} 位）`);

  return {
    count: additives.length,
    tierText: tiers.join("、"),
    classText: classes.join("、"),
    posText: ranked.join("、"),
  };
}

/**
 * 说明"为什么是这个分数"。
 * 主线是添加剂：多少种、什么功能、什么关注级别、在配料表里的排位（含量近似）。
 * 纯规则，同一份数据永远得到同一段解释。
 */
function buildScoreReason({ total, dims, w, losses, deductions, nutri, nova, additives, addPen, tokens, capped, ceiling }) {
  const pct = (k) => Math.round(w[k] * 100);
  const sc = (k) => Math.round(dims[k]);
  const byLoss = [...losses].sort((a, b) => b.lost - a.lost);
  const addLost = Math.round(w.additives * (100 - dims.additives) * 10) / 10;
  const comp = describeAdditives(additives, addPen, tokens);
  const parts = [];

  /* 1) 添加剂构成 + 含量 */
  if (!comp) {
    parts.push(
      `添加剂项满分 ${sc("additives")} 分（占 ${pct("additives")}% 权重）：配料表里没有检出食品添加剂。`
    );
  } else {
    parts.push(`添加剂共 ${comp.count} 种（${comp.tierText}），集中在${comp.classText}。`);
    if (comp.posText) {
      parts.push(`标签不标添加量，按配料表"含量从高到低"的排位看：${comp.posText}。`);
    }
    parts.push(
      `添加剂项因此得 ${sc("additives")} 分（占 ${pct("additives")}% 权重，损失约 ${Math.round(addLost)} 分）` +
        (byLoss[0].key === "additives" ? "，是这次扣分的主要来源。" : "，不是主要失分点。")
    );
  }

  /* 2) 其余维度：一句话交代，不喧宾夺主 */
  const others = byLoss.filter((l) => l.key !== "additives" && l.lost >= 3);
  const addIsMain = byLoss[0].key === "additives";
  if (total >= 80) {
    const support = [];
    if (dims.nutrition >= 80) support.push(`营养质量 ${sc("nutrition")} 分`);
    if (dims.processing >= 80) support.push(`加工程度 ${sc("processing")} 分（NOVA ${nova.level}）`);
    if (support.length) parts.push(`另外${support.join("、")}，三个维度都没有明显扣分。`);
  } else if (others.length) {
    const o = others[0];
    const d = deductions.find((x) => x.weight === o.key);
    parts.push(
      `${DIM_CN[o.key]} ${sc(o.key)} 分（占 ${pct(o.key)}%）${addIsMain ? "也在拉低总分" : "是主要失分点"}` +
        (d ? `，例如「${d.text}」` : "") + "。"
    );
  }

  if (capped) parts.push(`营养等级为 ${nutri.grade}，按规则总分封顶 ${ceiling} 分。`);
  return parts.join("");
}

/* ---------- 汇总 ---------- */

export function analyse(sample, kb, params, presetName = params.active) {
  const preset = params.presets[presetName];
  if (!preset) throw new Error(`未知预设: ${presetName}`);
  const w = preset.weights;

  const isBeverage = (params.beverageCategories?.list ?? []).includes(sample.category);
  const tokens = parseIngredients(sample.ingredients);

  /* 1) 配料解析 */
  const additives = matchAdditives(tokens, kb);

  /* 2) 营养素补全 */
  const nut = resolveNutrition(sample.nutrition ?? {}, tokens, kb, params, isBeverage);

  /* 3) 营养分 */
  const fv = estimateFvPercent(tokens, kb);
  const nutri = nutriScore(nut.values, params, isBeverage, fv.percent);

  /* 4) 加工程度 */
  const markers = novaMarkers(tokens, additives, kb);
  const nova = novaLevel(tokens, additives, markers);
  const processingScore = params.processingScore[`nova${nova.level}`];

  /* 5) 隐藏信号：反式脂肪来源、游离糖、含糖饮料、含钠配料叠加
        原「隐形风险」维度已取消，这些信号按性质并入营养质量 / 添加剂 */
  const transFat = findAll(tokens, kb.transFatSources).map((h) => h.keyword);
  const hiddenSugar = findAll(tokens, kb.hiddenSugars).map((h) => h.keyword);
  // 同义词归一：味精 = 谷氨酸钠，呈味核苷酸二钠 = 5'-呈味核苷酸二钠
  const SYNONYM = { 味精: "谷氨酸钠", 呈味核苷酸二钠: "5'-呈味核苷酸二钠" };
  const sodiumHits = [
    ...new Set(kb.sodiumSynergyKeywords.filter((k) => containsAny(tokens, [k])).map((k) => SYNONYM[k] ?? k)),
  ];
  const allergens = detectAllergens(tokens, kb);
  const addedSugarBeverage =
    isBeverage && containsAny(tokens, kb.caloricSugars) && !containsAny(tokens, kb.nonNutritiveSweeteners);

  const hp = params.hiddenSignalPenalty;
  let nutritionPenalty = 0;
  if (transFat.length) nutritionPenalty += hp.transFatSource.points;
  if (hiddenSugar.length) nutritionPenalty += hp.hiddenSugar.points;
  if (addedSugarBeverage) nutritionPenalty += hp.addedSugarBeverage.points;
  const additiveExtra = sodiumHits.length >= 2 ? hp.sodiumSynergy.points : 0;

  /* 6) 添加剂 */
  const addPen = penaltyForAdditives(additives, params);
  const additiveScore = Math.max(0, 100 - addPen.total - additiveExtra);
  const nutritionScore = Math.max(0, nutri.score - nutritionPenalty);

  /* 7) 合成总分 */
  const dims = {
    nutrition: nutritionScore,
    processing: processingScore,
    additives: additiveScore,
  };

  const mean = Object.keys(w).reduce((s, k) => s + w[k] * dims[k], 0);
  // 木桶效应：只惩罚"某一维明显拖后腿"，且总量封顶。
  // 不做封顶的话，全维度都差的产品会被重复扣分，最后全挤到 0 分。
  let shortBoard = 0;
  for (const k of Object.keys(w)) shortBoard += w[k] * Math.max(0, preset.lowThreshold - dims[k]);
  shortBoard = Math.min(shortBoard * preset.penaltyStrength, preset.maxPenalty ?? 100);
  const beforeCap = mean - shortBoard;
  const ceiling = params.gradeCeiling[nutri.grade];
  const total = Math.max(0, Math.min(100, Math.round(Math.min(beforeCap, ceiling))));
  const grade = total >= params.displayGrade.A ? "A"
    : total >= params.displayGrade.B ? "B"
    : total >= params.displayGrade.C ? "C"
    : total >= params.displayGrade.D ? "D" : "E";

  /* 8) 能量交叉校验（判断 OCR 是否可能读错） */
  const e = params.energyFallback;
  const computed = (nut.values.proteinG ?? 0) * e.proteinKj + (nut.values.fatG ?? 0) * e.fatKj + (nut.values.carbG ?? 0) * e.carbKj;
  const declared = sample.nutrition?.energyKj;
  const deviation = declared && computed ? Math.abs(declared - computed) / computed : null;

  /* 9) 扣分理由 */
  const loss = Object.keys(w).map((k) => ({ key: k, lost: Math.round(w[k] * (100 - dims[k]) * 10) / 10 }));
  const deductions = [];
  if (nut.detail.sugar.confidence === "low" && (nut.values.sugarG ?? 0) > 5)
    deductions.push({ text: `糖约 ${fmt(nut.values.sugarG)}g/100${isBeverage ? "ml" : "g"}（估算）：${nut.detail.sugar.basis}`, weight: "nutrition" });
  if ((nut.values.sodiumMg ?? 0) > 600) deductions.push({ text: `钠 ${fmt(nut.values.sodiumMg)}mg/100${isBeverage ? "ml" : "g"}，属高钠`, weight: "nutrition" });
  if ((nut.values.satFatG ?? 0) > 5) deductions.push({ text: `饱和脂肪约 ${fmt(nut.values.satFatG)}g（${nut.detail.satFat.basis}）`, weight: "nutrition" });
  for (const a of additives.filter((x) => x.tier !== "low"))
    deductions.push({ text: `${a.name}（${a.fn}，${a.note}）`, weight: "additives", delta: Math.round(w.additives * params.additivePenalty[a.tier] * 10) / 10 });
  if (transFat.length) deductions.push({ text: `含反式脂肪来源：${[...new Set(transFat)].join("、")}`, weight: "nutrition", delta: hp.transFatSource.points * w.nutrition });
  if (hiddenSugar.length) deductions.push({ text: `含游离糖来源：${[...new Set(hiddenSugar)].join("、")}`, weight: "nutrition", delta: hp.hiddenSugar.points * w.nutrition });
  if (addedSugarBeverage) deductions.push({ text: "含糖饮料：液体糖更易过量摄入", weight: "nutrition", delta: hp.addedSugarBeverage.points * w.nutrition });
  if (sodiumHits.length >= 2) deductions.push({ text: `多种含钠配料叠加（${sodiumHits.join("、")}）`, weight: "additives", delta: hp.sodiumSynergy.points * w.additives });
  if (nova.level === 4) deductions.push({ text: `超加工食品：${nova.reason}`, weight: "processing" });

  const credits = [];
  if ((nut.values.proteinG ?? 0) >= 12) {
    credits.push({ text: `蛋白质 ${fmt(nut.values.proteinG)}g/100${isBeverage ? "ml" : "g"}，达到"高蛋白"标示标准（≥20% NRV）` });
  } else if (nutri.points.proteinP >= 3) {
    credits.push({ text: `蛋白质 ${fmt(nut.values.proteinG)}g/100${isBeverage ? "ml" : "g"}，高于多数同类产品` });
  }
  if (nutri.points.fiberP >= 3) credits.push({ text: `膳食纤维 ${fmt(nut.values.fiberG)}g，有助于饱腹与肠道` });
  if (nutri.points.fvP >= 1) credits.push({ text: `含果蔬豆类原料（约占 ${fv.percent}%${fv.basis ? "，" + fv.basis : ""}）` });
  if (additives.length === 0) credits.push({ text: "未使用食品添加剂" });
  if (nova.level <= 2) credits.push({ text: "加工程度低" });
  if (!transFat.length) credits.push({ text: "无反式脂肪来源" });

  /* 10) 食用建议 + 能量换算 */
  const servingG = params.servingSize[sample.category] ?? params.servingSize.default;
  const per100Kj = nut.values.energyKj ?? 0;
  const dailyRefKj = params.energyIntake.dailyRefKj;
  const kjToKcal = (kj) => Math.round(kj / 4.184);
  const servingKj = Math.round((per100Kj * servingG) / 100);
  const dailyRefKcal = params.energyIntake.dailyRefKcal;

  const energy = {
    per100Kj: Math.round(per100Kj),
    per100Kcal: kjToKcal(per100Kj),
    servingG,
    servingKj,
    servingKcal: kjToKcal(servingKj),
    dailyRefKj,
    dailyRefKcal,
    pctPer100: Math.round((per100Kj / dailyRefKj) * 100),
    pctPerServing: Math.round((servingKj / dailyRefKj) * 100),
  };

  const advice = buildAdvice({
    values: nut.values,
    isBeverage,
    servingG,
    servingKcal: energy.servingKcal,
    dailyRefKcal,
  });

  /* 11) 分数档位 + 原因说明
        80 以上笑脸、60–79 一般、60 以下坏脸 */
  const level = total >= 80 ? "high" : total >= 60 ? "mid" : "low";
  const reason = buildScoreReason({
    total,
    dims,
    w,
    losses: loss,
    deductions,
    credits,
    nutri,
    nova,
    additives,
    addPen,
    tokens,
    capped: ceiling < 100 && beforeCap > ceiling,
    ceiling,
  });

  return {
    id: sample.id,
    name: sample.name,
    category: sample.category,
    unit: sample.unit,
    isBeverage,
    preset: presetName,
    total,
    grade,
    level,
    reason,
    dims,
    losses: loss,
    ceiling,
    beforeCap: Math.round(beforeCap * 10) / 10,
    // 只有真的被营养等级上限压下来时才提示，否则是噪音
    capped: ceiling < 100 && beforeCap > ceiling,
    nutrients: nut.values,
    nutritionConfidence: deviation != null && deviation > params.energyCrossCheck.tolerance ? "low" : nut.confidence,
    nutritionDetail: nut.detail,
    nutri,
    fv,
    nova,
    additives,
    additivePenalty: addPen,
    hidden: { transFat: [...new Set(transFat)], hiddenSugar: [...new Set(hiddenSugar)], sodiumHits, addedSugarBeverage },
    allergens,
    ingredients: tokens,
    energyCheck: { declared, computed: Math.round(computed), deviation, suspicious: deviation != null && deviation > params.energyCrossCheck.tolerance },
    energy,
    advice,
    deductions,
    credits,
  };
}

const fmt = (x) => (x == null ? "—" : Math.round(x * 10) / 10);
