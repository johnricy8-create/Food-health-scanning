/**
 * 端到端测试：把一段文字或一张图片发给中转服务，打印抽取结果和打分结果。
 *
 *   node scripts/test-analyze.mjs --text  some-label.txt
 *   node scripts/test-analyze.mjs --image some-label.png
 *
 * 中转服务要先跑起来：npm run proxy
 */
import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";

const BASE = process.env.PROXY_URL ?? "http://localhost:8787";
const args = process.argv.slice(2);
const mode = args[0];
const file = args[1];

if (!mode || !file) {
  console.error("用法：node scripts/test-analyze.mjs --text|--image <文件路径>");
  process.exit(1);
}

const payload = {};
if (mode === "--text") {
  payload.text = readFileSync(file, "utf8");
} else {
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(file).toLowerCase()];
  if (!mime) throw new Error("不支持的图片格式：" + file);
  payload.imageBase64 = readFileSync(file).toString("base64");
  payload.mimeType = mime;
  payload.fallbackName = basename(file);
}

const t0 = Date.now();
const res = await fetch(`${BASE}/api/analyze`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const ms = Date.now() - t0;
const data = await res.json();

if (!res.ok) {
  console.error(`HTTP ${res.status}  (${ms}ms)`);
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

const { extracted, result, narrative } = data;

console.log(`\n耗时 ${ms}ms   模型 ${extracted.meta?.model}   视觉 ${extracted.meta?.visionModel ?? "未使用"}`);
console.log(`token  ${extracted.meta?.promptTokens} in / ${extracted.meta?.outputTokens} out`);

if (extracted.meta?.ocrText) {
  console.log("\n—— 视觉抄录 ——");
  console.log(extracted.meta.ocrText);
}

console.log("\n—— 结构化 ——");
console.log(JSON.stringify({
  productName: extracted.productName,
  ingredients: extracted.ingredients,
  nutrition: extracted.nutrition,
  unclearFields: extracted.unclearFields,
}, null, 2));

console.log("\n—— 打分 ——");
console.log(`${result.total} 分  ${result.grade}  (${result.name} · ${result.category})`);
console.log("维度 " + Object.entries(result.dims).map(([k, v]) => `${k}=${Math.round(v)}`).join("  "));
console.log("\n扣分：");
for (const d of result.deductions) console.log("  - " + d.text);
console.log("\n加分：");
for (const c of result.credits) console.log("  + " + c.text);
console.log("\n转述：" + (narrative ?? "（无）"));
