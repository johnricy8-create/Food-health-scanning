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
import { createHash } from "node:crypto";

const { analyse } = await import("../src/score.mjs");
const { extract, narrate, providerInfo } = await import("../src/extract/index.mjs");

const params = JSON.parse(readFileSync(new URL("../config/params.json", import.meta.url), "utf8"));
const kb = JSON.parse(readFileSync(new URL("../data/knowledge.json", import.meta.url), "utf8"));

/** 一次扫描只调 2 次模型（抄录 + 结构化）。转述默认关闭：
 *  界面已经改成用规则生成的"为什么是这个分数"，转述既不显示又白花一次调用和时间。
 *  想开就设 AI_NARRATIVE=1。 */
const NARRATIVE_ON = process.env.AI_NARRATIVE === "1";

/** params.servingSize 里有哪些品类，用来校验模型给的品类 */
const SERVING_CATEGORIES = new Set(
  Object.keys(params.servingSize ?? {}).filter((k) => !k.startsWith("_") && k !== "default")
);

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
  // 模型从包装上读到的品类（限定在 params.servingSize 的键里）
  const c = extracted?.category;
  if (c && SERVING_CATEGORIES.has(c)) return c;
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

  // 先看 Content-Length，超大请求直接拒，不用把整个 body 读进内存
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_BODY) {
    return json(res, 413, { error: tooBigMessage() }, cors);
  }

  try {
    const body = JSON.parse(await readBody(req));
    if (!body.text && !body.imageBase64) {
      return json(res, 400, { error: "需要 text 或 imageBase64" }, cors);
    }

    // 同一张图 / 同一段文字重复请求，直接给上次的结果
    const cacheKey = hashOf(body.imageBase64 ?? `text:${body.text}`);
    const hit = cacheGet(cacheKey);
    if (hit) return json(res, 200, { ...hit, cached: true }, cors);

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

    // 转述是"锦上添花"，失败不能影响打分结果；默认关闭，省一次模型调用和十几秒
    const narrative = NARRATIVE_ON ? await narrate(result).catch(() => null) : null;

    const payload = { extracted, result, narrative };
    cacheSet(cacheKey, payload);
    return json(res, 200, payload, cors);
  } catch (err) {
    console.error("[analyze]", err);
    // 图片过大：明确告诉客户端，别让它以为"网络连不上"
    if (err?.status === 413) {
      return json(res, 413, { error: String(err.message ?? "图片太大") }, cors);
    }
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

/** 同一张图重复识别（重试、来回切页）直接返回，不用再等模型 */
const CACHE_MAX = 20;
const cache = new Map();
const hashOf = (s) => createHash("sha1").update(s).digest("hex");
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit); // 命中后挪到队尾，LRU
  return hit;
}
function cacheSet(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function tooBigMessage() {
  return `图片太大（超过 ${Math.round(MAX_BODY / 1024 / 1024)}MB），请换一张体积小一点的照片`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        const err = new Error(tooBigMessage());
        err.status = 413;
        reject(err);
        // 不能 destroy：那样响应发不出去，客户端只会看到"连接被重置"。
        // 把剩余数据读完丢掉即可。
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
