/**
 * 从 Open Food Facts 抓中国区产品，转成本引擎的样本格式。
 *
 * OFF 是开放数据库（ODbL 许可，https://opendatacommons.org/licenses/odbl/1-0/），
 * 每个产品同时有：配料表文字、营养成分、实拍标签照片 —— 正好可以当参考库。
 *
 * 用法： node scripts/fetch-off.mjs [页数]
 */
import { writeFileSync, mkdirSync } from "node:fs";

const UA = "FoodScoreEngine/0.1 (offline research; open-source nutrition scoring prototype)";
const PAGES = Number(process.argv[2] ?? 6);
const FIELDS = [
  "code",
  "product_name",
  "product_name_zh",
  "brands",
  "categories_tags",
  "ingredients_text_zh",
  "ingredients_text",
  "ingredients",
  "nutriments",
  "image_front_url",
  "image_ingredients_url",
  "labels_tags",
  "quantity",
].join(",");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(n) {
  const url = `https://world.openfoodfacts.org/api/v2/search?countries_tags=china&page=${n}&page_size=100&fields=${FIELDS}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} on page ${n}`);
  return res.json();
}

const g = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** OFF 的钠字段单位是克 */
const sodiumMg = (n) => {
  if (g(n.sodium_100g) != null) return Math.round(n.sodium_100g * 1000);
  if (g(n.salt_100g) != null) return Math.round((n.salt_100g / 2.5) * 1000);
  return null;
};

const energyKj = (n) => {
  if (g(n["energy-kj_100g"]) != null) return Math.round(n["energy-kj_100g"]);
  if (g(n.energy_100g) != null) return Math.round(n.energy_100g * 4.184); // OFF 的 energy 通常是 kcal
  return null;
};

const BEVERAGE_TAGS = ["beverages", "drinks", "waters", "sodas", "juices", "plant-based-beverages"];

function toSample(p) {
  const n = p.nutriments ?? {};
  const ing = (p.ingredients_text_zh || p.ingredients_text || "").trim();
  const isBev = (p.categories_tags ?? []).some((t) => BEVERAGE_TAGS.some((b) => t.includes(b)));

  const nutrition = {
    energyKj: energyKj(n),
    proteinG: g(n.proteins_100g),
    fatG: g(n.fat_100g),
    carbG: g(n.carbohydrates_100g),
    sodiumMg: sodiumMg(n),
  };

  return {
    id: `off-${p.code}`,
    name: (p.product_name_zh || p.product_name || "(未命名)").trim(),
    brand: (p.brands ?? "").split(",")[0].trim(),
    category: isBev ? "饮料" : "其他",
    unit: isBev ? "100ml" : "100g",
    ingredients: ing,
    nutrition,
    declaredSugarG: g(n.sugars_100g),
    declaredSatFatG: g(n["saturated-fat_100g"]),
    declaredFiberG: g(n.fiber_100g),
    offCategories: (p.categories_tags ?? []).slice(0, 4),
    imageFront: p.image_front_url ?? null,
    imageIngredients: p.image_ingredients_url ?? null,
    labels: p.labels_tags ?? [],
    quantity: p.quantity ?? null,
  };
}

const all = [];
for (let i = 1; i <= PAGES; i++) {
  try {
    const d = await page(i);
    all.push(...(d.products ?? []));
    console.log(`page ${i}: +${d.products?.length ?? 0}  (累计 ${all.length})`);
  } catch (e) {
    console.warn(`page ${i} 失败: ${e.message}`);
  }
  await sleep(1200);
}

const seen = new Set();
const dedup = all.filter((p) => (seen.has(p.code) ? false : seen.add(p.code)));
const samples = dedup.map(toSample).filter((s) => s.ingredients.length > 0);

const usable = samples.filter(
  (s) => s.ingredients.length >= 4 && s.nutrition.energyKj != null && s.nutrition.carbG != null && s.nutrition.fatG != null
);

mkdirSync("data/reference", { recursive: true });
writeFileSync("data/reference/off-all.json", JSON.stringify(samples, null, 2));
writeFileSync("data/reference/off-usable.json", JSON.stringify(usable, null, 2));

console.log("");
console.log(`抓取 ${dedup.length} 个产品，有配料表 ${samples.length}，数据可用（配料≥4 + 能量/脂肪/碳水齐）${usable.length}`);
console.log(`写出 data/reference/off-all.json / off-usable.json`);

const withZh = samples.filter((s) => /[\u4e00-\u9fa5]/.test(s.ingredients)).length;
const withImg = samples.filter((s) => s.imageIngredients || s.imageFront).length;
console.log(`其中：配料表含中文 ${withZh}，有标签照片 ${withImg}`);
