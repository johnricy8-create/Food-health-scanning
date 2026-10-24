/**
 * 跑全部样本，输出分数表 + 三套预设对比 + HTML 预览。
 * 用法： node src/cli.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { analyse } from "./score.mjs";

const loadJson = (relPath) => JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8"));

const params = loadJson("../config/params.json");
const kb = loadJson("../data/knowledge.json");
const { samples } = loadJson("../data/samples.json");

const presetNames = Object.keys(params.presets);
const active = params.active;

const results = samples.map((s) => analyse(s, kb, params, active));
results.sort((a, b) => b.total - a.total);

/* ---------- 控制台表格 ---------- */

const pad = (s, n) => {
  const w = [...String(s)].reduce((acc, c) => acc + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
  return String(s) + " ".repeat(Math.max(0, n - w));
};

const rows = results.map((r) => {
  const alt = presetNames.map((p) => analyse(samples.find((s) => s.id === r.id), kb, params, p).total);
  return [
    pad(r.total, 4),
    pad(r.grade, 3),
    pad(Math.round(r.dims.nutrition), 5),
    pad(Math.round(r.dims.processing), 5),
    pad(Math.round(r.dims.additives), 6),
    pad("NOVA" + r.nova.level, 7),
    pad(r.nutritionConfidence === "high" ? "高" : r.nutritionConfidence === "medium" ? "中" : "低", 3),
    pad(r.name, 24),
    alt.join(" / "),
  ].join("");
});

const header = pad("总分", 4) + pad("级", 3) + pad("营养", 5) + pad("加工", 5) + pad("添加剂", 6) + pad("NOVA", 7) + pad("置信", 3) + pad("名称", 24) + presetNames.join(" / ");

console.log("");
console.log("预设：" + active + "   （最右三列为各预设总分对比：" + presetNames.join(" / ") + "）");
console.log("─".repeat(header.length));
console.log(header);
console.log("─".repeat(header.length));
rows.forEach((r) => console.log(r));
console.log("─".repeat(header.length));

/* ---------- 分布检查 ---------- */

const buckets = { "85-100 A": 0, "70-84 B": 0, "55-69 C": 0, "40-54 D": 0, "0-39 E": 0 };
for (const r of results) {
  if (r.total >= 85) buckets["85-100 A"]++;
  else if (r.total >= 70) buckets["70-84 B"]++;
  else if (r.total >= 55) buckets["55-69 C"]++;
  else if (r.total >= 40) buckets["40-54 D"]++;
  else buckets["0-39 E"]++;
}
console.log("");
console.log("分数分布：" + Object.entries(buckets).map(([k, v]) => `${k}=${v}`).join("  "));

const suspicious = results.filter((r) => r.energyCheck.suspicious);
if (suspicious.length) {
  console.log("");
  console.log("⚠ 能量交叉校验不通过（可能录入/识别有误）：");
  suspicious.forEach((r) => console.log(`   ${r.name}: 标示 ${r.energyCheck.declared} kJ vs 计算 ${r.energyCheck.computed} kJ`));
}

/* ---------- 写文件 ---------- */

mkdirSync(new URL("../out/", import.meta.url), { recursive: true });

const allPresets = samples.map((s) => ({
  id: s.id,
  name: s.name,
  scores: Object.fromEntries(presetNames.map((p) => [p, analyse(s, kb, params, p).total])),
}));

writeFileSync(
  new URL("../out/scores.json", import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), active, paramsVersion: params.version, results, allPresets }, null, 2)
);

const md = [];
md.push("# 评分引擎 · 第一轮结果\n");
md.push(`预设：\`${active}\`　生成时间：${new Date().toLocaleString("zh-CN")}\n`);
md.push("| 总分 | 等级 | 营养 60% | 加工 20% | 添加剂 20% | NOVA | 置信 | 产品 | 营养等级 |");
md.push("|---|---|---|---|---|---|---|---|---|");
for (const r of results) {
  md.push(
    `| **${r.total}** | ${r.grade} | ${Math.round(r.dims.nutrition)} | ${Math.round(r.dims.processing)} | ${Math.round(r.dims.additives)} | ${r.nova.level} | ${r.nutritionConfidence} | ${r.name} | ${r.nutri.grade}(${r.nutri.final}) |`
  );
}
md.push("\n## 每条的扣分理由\n");
for (const r of results) {
  md.push(`### ${r.name} — ${r.total} 分（${r.grade}）`);
  md.push(`配料：\`${r.additives.map((a) => a.name).join("、") || "无添加剂"}\`　过敏原：${r.allergens.map((a) => a.name).join("、") || "无"}`);
  if (r.deductions.length) r.deductions.forEach((d) => md.push(`- − ${d.text}`));
  if (r.credits.length) r.credits.forEach((c) => md.push(`- ＋ ${c.text}`));
  md.push("");
}
writeFileSync(new URL("../out/report.md", import.meta.url), md.join("\n"));

writeFileSync(new URL("../out/report.html", import.meta.url), html(results, presetNames, active));

console.log("");
console.log("已写出： out/report.md  out/report.html  out/scores.json");

/* ---------- HTML ---------- */

function html(rs, presets, act) {
  const color = (t) => (t >= 85 ? "#16a34a" : t >= 70 ? "#65a30d" : t >= 55 ? "#ca8a04" : t >= 40 ? "#ea580c" : "#dc2626");
  const bar = (v, c) => `<div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, v))}%;background:${c}"></div></div>`;
  const rows = rs.map((r) => `
    <tr>
      <td class="score" style="color:${color(r.total)}">${r.total}<span class="grade">${r.grade}</span></td>
      <td>${bar(r.total, color(r.total))}</td>
      <td>${bar(r.dims.nutrition, "#0ea5e9")}<small>营养 ${Math.round(r.dims.nutrition)}</small></td>
      <td>${bar(r.dims.processing, "#8b5cf6")}<small>加工 ${Math.round(r.dims.processing)} · NOVA${r.nova.level}</small></td>
      <td>${bar(r.dims.additives, "#f59e0b")}<small>添加剂 ${Math.round(r.dims.additives)} · ${r.additives.length} 种</small></td>
      <td class="name">${r.name}<br><small>${r.category} · 置信度 ${r.nutritionConfidence}</small></td>
      <td class="why"><small>${r.deductions.slice(0, 3).map((d) => "− " + d.text).join("<br>")}</small></td>
    </tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>评分引擎 · 第一轮</title>
<style>
 body{font:14px/1.6 -apple-system,"Segoe UI","Microsoft Yahei",sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:32px}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#64748b;margin-bottom:24px}
 table{border-collapse:collapse;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px #0001}
 th{background:#f1f5f9;text-align:left;font-size:12px;color:#475569;padding:10px 12px;font-weight:600}
 td{padding:10px 12px;border-top:1px solid #f1f5f9;vertical-align:middle}
 .score{font-size:22px;font-weight:700;white-space:nowrap}
 .grade{font-size:12px;margin-left:4px;opacity:.7}
 .track{background:#f1f5f9;border-radius:999px;height:6px;overflow:hidden;margin-bottom:3px}
 .fill{height:100%;border-radius:999px}
 small{color:#94a3b8;font-size:11px}
 .name{font-weight:600;white-space:nowrap} .why{max-width:280px}
</style>
<h1>评分引擎 · 第一轮结果</h1>
<div class="sub">预设 <b>${act}</b>　共 ${rs.length} 个样本　分数越高越健康</div>
<table><tr><th>总分</th><th style="width:120px">总分条</th><th>营养 60%</th><th>加工 20%</th><th>添加剂 20%</th><th>产品</th><th>主要扣分</th></tr>
${rows}</table></html>`;
}
