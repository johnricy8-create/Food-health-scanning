/**
 * 极薄中转服务 —— App 唯一应该调用的地址。
 *
 * 职责只有两件：
 *   1. 保管 GEMINI_API_KEY（绝不下发给客户端）
 *   2. 手机 → 这里 → Gemini → 这里打分 → 手机
 *
 * 运行： node --env-file=.env server/proxy.mjs
 * 试一下： curl -X POST localhost:8787/api/analyze -H "Content-Type: application/json" -d "{\"text\":\"配料：水、白砂糖、柠檬酸\"}"
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const { analyse } = await import("../src/score.mjs");
const { extract, narrate, providerInfo } = await import("../src/extract/index.mjs");

const params = JSON.parse(readFileSync(new URL("../config/params.json", import.meta.url), "utf8"));
const kb = JSON.parse(readFileSync(new URL("../data/knowledge.json", import.meta.url), "utf8"));

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 8 * 1024 * 1024; // 8MB，够一张压缩后的手机照片

/** 简易限流：每 IP 每小时 N 次。上线请换成 Redis/Cloudflare 的正式方案 */
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR ?? 60);
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) ?? { count: 0, resetAt: now + 3600_000 };
  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + 3600_000;
  }
  rec.count++;
  hits.set(ip, rec);
  return rec.count > RATE_LIMIT ? Math.ceil((rec.resetAt - now) / 1000) : 0;
}

/** 没有类目时兜底推断。饮料走严格阈值，猜错影响很大，生产环境应由条码库/用户选择给出 */
function inferCategory(extracted, body) {
  if (body.category) return body.category;
  if (extracted?.nutrition?.basis === "100ml") return "饮料";
  return "其他";
}

const server = createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors).end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, ...providerInfo() }, cors);
  }
  if (req.method !== "POST" || req.url !== "/api/analyze") {
    return json(res, 404, { error: "not found" }, cors);
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  const wait = rateLimited(ip);
  if (wait) return json(res, 429, { error: `请求过于频繁，请 ${wait} 秒后再试` }, cors);

  try {
    const body = JSON.parse(await readBody(req));
    if (!body.text && !body.imageBase64) {
      return json(res, 400, { error: "需要 text 或 imageBase64" }, cors);
    }

    const extracted = await extract({
      text: body.text,
      imageBase64: body.imageBase64,
      mimeType: body.mimeType,
    });

    const sample = {
      id: `scan-${Date.now()}`,
      name: extracted.productName ?? body.fallbackName ?? "未命名产品",
      category: inferCategory(extracted, body),
      unit: extracted.nutrition?.basis ?? "100g",
      ingredients: (extracted.ingredients ?? []).join("、"),
      nutrition: extracted.nutrition ?? {},
    };

    const result = analyse(sample, kb, params, body.preset);

    // 转述是"锦上添花"，失败不能影响打分结果
    const narrative = await narrate(result).catch(() => null);

    return json(res, 200, { extracted, result, narrative }, cors);
  } catch (err) {
    console.error("[analyze]", err);
    // 上游限流要让客户端知道是"稍后再试"，而不是"服务坏了"
    const busy = err?.status === 429 || /429|1302|1305|速率限制|访问量过大/.test(String(err?.message ?? ""));
    if (busy) {
      return json(res, 429, { error: "识别服务当前繁忙（上游限流），请等 1 分钟再试。" }, cors);
    }
    return json(res, 500, { error: String(err?.message ?? err) }, cors);
  }
});

server.listen(PORT, () => {
  const info = providerInfo();
  console.log(`proxy 已启动  http://localhost:${PORT}`);
  console.log(`  供应商       ${info.provider}`);
  console.log(`  抽取模型     ${info.model}`);
  if (info.visionModel && info.visionModel !== info.model) console.log(`  视觉模型     ${info.visionModel}`);
  console.log(`  ${info.keyName} ${info.hasKey ? "已配置 ✓" : "未配置 ✗（抽取会失败）"}`);
  console.log(`  健康检查     GET  /health`);
  console.log(`  分析接口     POST /api/analyze`);
});

function json(res, code, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...headers }).end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
