/**
 * 智谱 GLM 抽取层。
 *
 * ⚠️ 只能在服务端运行。API Key 绝不能进 App 包。
 *
 * 为什么是两段式：
 *   glm-4.7-flash 是纯文本模型，不接受图片输入（实测返回 400）。
 *   所以照片走「视觉模型抄录 → 文本模型结构化」两段：
 *     1. glm-4.6v 把照片上的字逐行抄下来（只抄，不判断）
 *     2. glm-4.7-flash 把文字整理成固定 JSON
 *   好处是中间那层 OCR 文本可以直接给前端看，识别错了能一眼发现。
 *
 * 用法：
 *   await extract({ text })                  // 已经拿到文字，只走第二段
 *   await extract({ imageBase64, mimeType }) // 照片，两段都走
 */

const BASE = process.env.ZHIPU_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4";
const TEXT_MODEL = process.env.AI_MODEL ?? "glm-4.7-flash";
const VISION_MODEL = process.env.AI_VISION_MODEL ?? "glm-4.6v";

export function providerInfo() {
  return {
    provider: "zhipu",
    model: TEXT_MODEL,
    visionModel: VISION_MODEL,
    hasKey: Boolean(process.env.ZHIPU_API_KEY),
  };
}

/** 目标 JSON 形状。写进 prompt 而不是 responseSchema —— 智谱的 json_schema 实测不严格生效 */
const SHAPE = `{
  "productName": string | null,
  "brand": string | null,
  "category": "饮料" | "乳制品" | "方便食品" | "饼干" | "糕点" | "坚果" | "调味品" | "谷物" | "膨化食品" | "糖果" | "肉制品" | null,
  "netContent": string | null,
  "ingredientsText": string | null,
  "ingredients": string[],
  "nutrition": {
    "basis": "100g" | "100ml",
    "energyKj": number | null,
    "proteinG": number | null,
    "fatG": number | null,
    "carbG": number | null,
    "sugarG": number | null,
    "satFatG": number | null,
    "fiberG": number | null,
    "sodiumMg": number | null
  },
  "allergensText": string | null,
  "rawText": string,
  "unclearFields": string[]
}`;

const SYSTEM_PROMPT = `你是食品标签的录入员，不是营养师。

任务：把配料表和营养成分表，**逐字抄录**成 JSON。

铁律：
1. 只抄录，不解释，不推断，不补全，不纠正错别字。
2. 看不清楚的字段一律填 null，并写进 unclearFields。宁可留空，绝不猜测。
3. ingredients 数组的顺序必须与包装完全一致（GB 7718 规定按加入量递减排列，顺序本身就是信息）。
4. 营养成分按"每 100g / 每 100ml"录入。如果标签是"每份"，先按净含量换算成每 100g。
5. 标签没写"糖"/"饱和脂肪"/"膳食纤维"，就填 null。不要因为配料表里有白砂糖就填糖含量——那是下游的活。
6. 不要在输出里加任何健康评价、建议、"注意"之类的话。
7. category 只能从结构里列出的品类中选一个，判断不了就填 null，不要硬猜。
8. 只输出 JSON，不要 markdown 代码块，不要任何解释文字。`;

const OCR_PROMPT = `把这张食品包装照片上的所有文字逐行抄录出来。

要求：
- 只抄录，不解释、不总结、不补全。
- 保持原有换行和顺序。
- 看不清的字用 □ 代替。
- 如果照片里没有配料表或营养成分表，就照实输出你看到的文字。`;

/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 统一调用入口。
 * thinking 一律关闭：抽取是转录任务，开了只会更慢更贵。
 */
async function chat({ model, messages, maxTokens = 2000, temperature = 0, json = false, retries = 3 }) {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 ZHIPU_API_KEY。请在 .env 里配置，并用 node --env-file=.env 启动。");
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    thinking: { type: "disabled" },
  };
  if (json) body.response_format = { type: "json_object" };

  // 免费额度有速率限制，退避重试通常能过。
  // 转述这种"锦上添花"的调用不重试，否则失败一次就要干等 20 秒。
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429 && attempt < retries) {
      await sleep([2000, 6000, 12000][attempt] ?? 12000);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text();
      const err = new Error(`智谱 ${res.status}: ${detail.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      usage: data.usage ?? {},
      model: data.model ?? model,
    };
  }
}

/**
 * 把模型输出变成对象。
 * 智谱的 json_object 会包一层 {"answer": {...}}，代码块围栏也不一定听话，
 * 所以这里做三步容错：去围栏 → 截取最外层大括号 → 拆 answer 包装。
 */
function parseJsonLoose(raw) {
  let t = String(raw ?? "").trim();

  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) t = fenced[1].trim();

  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);

  const obj = JSON.parse(t);

  // 拆掉 {"answer": {...}} 这层壳
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const keys = Object.keys(obj);
    const inner = obj.answer ?? obj.result ?? obj.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner) && keys.length === 1) return inner;
  }
  return obj;
}

/** 第一段：照片 → 文字。用视觉模型，只要纯文本，不要 JSON */
async function transcribe({ imageBase64, mimeType }) {
  const { content, usage } = await chat({
    model: VISION_MODEL,
    maxTokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: "text", text: OCR_PROMPT },
        ],
      },
    ],
  });
  return { text: content.trim(), usage };
}

/** 主入口 */
export async function extract({ text, imageBase64, mimeType = "image/jpeg" }) {
  if (!text && !imageBase64) throw new Error("extract() 需要 text 或 imageBase64 之一");

  let ocrText = null;
  let ocrUsage = {};
  let source = text ?? "";

  if (imageBase64) {
    const ocr = await transcribe({ imageBase64, mimeType });
    ocrText = ocr.text;
    ocrUsage = ocr.usage;
    source = [ocr.text, text].filter(Boolean).join("\n\n");
  }

  const { content, usage } = await chat({
    model: TEXT_MODEL,
    maxTokens: 2000,
    json: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `以下是包装上的文字，请整理成 JSON。\n\n===== 原文开始 =====\n${source}\n===== 原文结束 =====\n\n输出结构：\n${SHAPE}` },
    ],
  });

  const parsed = parseJsonLoose(content);
  if (!Array.isArray(parsed.ingredients)) parsed.ingredients = [];

  return {
    ...parsed,
    meta: {
      provider: "zhipu",
      model: TEXT_MODEL,
      visionModel: imageBase64 ? VISION_MODEL : null,
      ocrText,
      promptTokens: (ocrUsage.prompt_tokens ?? 0) + (usage.prompt_tokens ?? 0),
      outputTokens: (ocrUsage.completion_tokens ?? 0) + (usage.completion_tokens ?? 0),
    },
  };
}

/**
 * 可选：把计算结果翻译成一两句人话。
 * 注意——它只能"解释已有结论"，绝不能参与打分，也不能改变分数。
 */
export async function narrate(result) {
  if (!process.env.ZHIPU_API_KEY) return null;

  const facts = {
    总分: result.total,
    等级: result.grade,
    营养分: Math.round(result.dims.nutrition),
    加工程度: `NOVA ${result.nova.level}`,
    添加剂: result.additives.map((a) => a.name),
    扣分项: result.deductions.map((d) => d.text),
  };

  try {
    const { content } = await chat({
      model: TEXT_MODEL,
      maxTokens: 200,
      temperature: 0.3,
      retries: 0,
      messages: [
        {
          role: "system",
          content: `你是营养信息解读助手。把已经算好的结果转述成 2 句话、不超过 60 字的中文。

硬性要求：
- 不许修改分数，不许新增扣分项，只能转述给你的数据。
- 不许出现"能吃/不能吃/有害/致癌/治疗/预防/降三高"。
- 陈述事实，把判断留给用户。
- 不要开场白。`,
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
    });
    return content.trim() || null;
  } catch {
    // 转述失败不影响打分
    return null;
  }
}
