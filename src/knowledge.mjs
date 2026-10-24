/**
 * 配料表知识库：解析 + 匹配
 * 纯函数，无外部依赖 —— 这样同一份代码可以原样跑在 Node 和 React Native 里。
 */

/** "配料：水、白砂糖；柠檬酸" → ["水","白砂糖","柠檬酸"] */
export function parseIngredients(text) {
  if (!text) return [];
  return text
    .replace(/^配料表?\s*[:：]/, "")
    .replace(/[（(][^）)]*[）)]/g, (m) => m) // 括号内容保留
    .split(/[、,，;；\/\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 一个配料可能写作 "乳化剂(单双甘油脂肪酸酯)"，拆出外层与括号内两种写法 */
function variants(token) {
  const out = [token];
  const inner = token.match(/[（(]([^）)]+)[）)]/);
  if (inner) out.push(inner[1].trim());
  return out;
}

const has = (token, keyword) => variants(token).some((v) => v.includes(keyword));

/** 在配料数组里找最早出现的关键词 */
export function firstIndexOf(tokens, keywords) {
  for (let i = 0; i < tokens.length; i++) {
    for (const kw of keywords) {
      if (has(tokens[i], kw)) return { index: i, keyword: kw, token: tokens[i] };
    }
  }
  return null;
}

export function findAll(tokens, keywords) {
  const hits = [];
  for (const t of tokens) {
    for (const kw of keywords) {
      if (has(t, kw)) hits.push({ token: t, keyword: kw });
    }
  }
  return hits;
}

export function containsAny(tokens, keywords) {
  return findAll(tokens, keywords).length > 0;
}

/** 匹配添加剂：同一条配料取最长命中，避免"柠檬酸钠"被识别成"柠檬酸" */
export function matchAdditives(tokens, kb) {
  const matched = [];
  const seen = new Set();
  for (const token of tokens) {
    let best = null;
    for (const add of kb.additives) {
      for (const name of [add.name, ...(add.aliases ?? [])]) {
        if (!has(token, name)) continue;
        if (!best || name.length > best.len) best = { add, len: name.length, hit: name };
      }
    }
    if (best && !seen.has(best.add.name)) {
      seen.add(best.add.name);
      matched.push({ ...best.add, matchedAs: best.hit, source: token });
    }
  }
  return matched;
}

/** 功能类别相同的添加剂最多累计 N 个，重者优先 */
export function penaltyForAdditives(matched, params) {
  const cfg = params.additivePenalty;
  const byClass = new Map();
  for (const a of matched) {
    if (!byClass.has(a.fn)) byClass.set(a.fn, []);
    byClass.get(a.fn).push(a);
  }
  const weight = { high: 3, medium: 2, low: 1 };
  let total = 0;
  const perClass = [];
  for (const [fn, list] of byClass) {
    list.sort((x, y) => weight[y.tier] - weight[x.tier]);
    const counted = list.slice(0, cfg.maxPerFunctionalClass);
    const sub = counted.reduce((s, a) => s + (cfg[a.tier] ?? 0), 0);
    total += sub;
    perClass.push({ fn, count: list.length, counted: counted.length, penalty: sub });
  }
  return { total, perClass };
}

const ALLERGEN_SKIP = {
  "乳": ["人造", "植物", "植脂", "代可可"],
};

export function detectAllergens(tokens, kb) {
  const out = [];
  for (const a of kb.allergens) {
    for (const t of tokens) {
      if ((ALLERGEN_SKIP[a.name] ?? []).some((s) => t.includes(s))) continue;
      if (a.keywords.some((kw) => has(t, kw))) {
        out.push({ name: a.name, from: t });
        break;
      }
    }
  }
  return out;
}

/** 估算果蔬豆类占比（Nutri-Score 的加分项），中国标签不标，只能靠配料位置 */
export function estimateFvPercent(tokens, kb) {
  const hit = firstIndexOf(tokens, kb.fvKeywords);
  if (!hit) return { percent: 0, basis: null };
  if (tokens.length === 1) return { percent: 100, basis: hit.keyword };
  if (hit.index === 0) return { percent: 80, basis: hit.keyword };
  if (hit.index <= 2) return { percent: 40, basis: hit.keyword };
  return { percent: 5, basis: hit.keyword };
}

/** NOVA 4 判定依据：工业专用配料 + "修饰性"添加剂 */
export function novaMarkers(tokens, additives, kb) {
  const markers = [];
  for (const t of tokens) {
    for (const m of kb.nova4IngredientMarkers) {
      if (has(t, m)) markers.push({ type: "ingredient", value: m, from: t });
    }
  }
  for (const a of additives) {
    if (kb.nova4MarkerFunctions.includes(a.fn)) {
      markers.push({ type: "additive", value: a.name, from: a.fn });
    }
  }
  const seen = new Set();
  return markers.filter((m) => (seen.has(m.value) ? false : seen.add(m.value)));
}
