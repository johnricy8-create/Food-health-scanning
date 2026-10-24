/**
 * Gemini 2.5 Flash 抽取层。
 *
 * ⚠️ 这个文件只能在服务端运行。API Key 绝对不能进 App 包，
 *    否则任何人反编译 IPA 就能拿走你的 key 刷你的额度。
 *
 * 用法：
 *   const r = await extract({ text: ocrText });          // 便宜：端侧 OCR 后只传文字
 *   const r = await extract({ imageBase64, mimeType });  // 兜底：OCR 失败时传图
 */

const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** 强约束输出结构。gemini 支持 responseSchema，不会返回多余字段 */
const LABEL_SCHEMA = {
  type: "OBJECT",
  properties: {
    productName: { type: "STRING", nullable: true, description: "产品名称，看不清填 null" },
    brand: { type: "STRING", nullable: true },
    netContent: { type: "STRING", nullable: true, description: "净含量，如 '500g'、'330ml'" },
    ingredientsText: { type: "STRING", nullable: true, description: "配料表原文，逐字抄录，不做任何改写" },
    ingredients: {
      type: "ARRAY",
      description: "按包装上的先后顺序拆分的配料，顺序必须保持",
      items: { type: "STRING" },
    },
    nutrition: {
      type: "OBJECT",
      description: "营养成分表。数值一律换算为每 100g 或每 100ml。没有的项填 null，禁止猜测",
      properties: {
        basis: { type: "STRING", enum: ["100g", "100ml"] },
        energyKj: { type: "NUMBER", nullable: true, description: "能量，kJ" },
        proteinG: { type: "NUMBER", nullable: true },
        fatG: { type: "NUMBER", nullable: true },
        carbG: { type: "NUMBER", nullable: true },
        sugarG: { type: "NUMBER", nullable: true, description: "仅当标签明确标示'糖'时才填" },
        satFatG: { type: "NUMBER", nullable: true, description: "仅当标签明确标示'饱和脂肪'时才填" },
        fiberG: { type: "NUMBER", nullable: true, description: "仅当标签明确标示'膳食纤维'时才填" },
        sodiumMg: { type: "NUMBER", nullable: true, description: "钠，mg。若标签给的是'盐'，用 mg÷2.5 换算成钠" },
      },
    },
    allergensText: { type: "STRING", nullable: true, description: "致敏物质提示原文" },
    rawText: { type: "STRING", description: "图片中识别到的全部文字，用于人工核对" },
    unclearFields: {
      type: "ARRAY",
      description: "看不清或缺失的字段名，用于给前端提示'请重拍这一块'",
      items: { type: "STRING" },
    },
  },
  required: ["rawText", "ingredients"],
};

const SYSTEM_PROMPT = `你是食品标签的录入员，不是营养师。

任务：把图片或文字里的配料表和营养成分表，**逐字抄录**成 JSON。

铁律：
1. 只抄录，不解释，不推断，不补全，不纠正错别字。
2. 看不清楚的字段一律填 null，并写进 unclearFields。宁可留空，绝不猜测。
3. 配料顺序必须与包装完全一致（GB 7718 规定按加入量递减排列，顺序本身就是信息）。
4. 营养成分按"每 100g / 每 100ml"录入。如果标签是"每份"，先按净含量换算成每 100g。
5. 标签没写"糖"/"饱和脂肪"/"膳食纤维"，就填 null。不要因为配料表里有白砂糖就填糖含量——那是下游的活。
6. 不要在输出里加任何健康评价、建议、"注意"之类的话。`;

function buildBody({ system, parts, temperature = 0 }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      responseSchema: LABEL_SCHEMA,
      // 关掉思考链：抽任务是纯转录，开了只会更慢更贵
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

export async function extract({ text, imageBase64, mimeType = "image/jpeg" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 GEMINI_API_KEY。本地开发请在 .env 里配置，或运行 node --env-file=.env ...");
  }
  if (!text && !imageBase64) throw new Error("extract() 需要 text 或 imageBase64 之一");

  const parts = [];
  if (text) {
    parts.push({ text: `以下是 OCR 得到的标签原文，请整理成 JSON：\n\n${text}` });
  }
  if (imageBase64) {
    parts.push({ inlineData: { mimeType, data: imageBase64 } });
    parts.push({ text: "请读取这张食品包装标签照片，整理成 JSON。" });
  }

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBody({ system: SYSTEM_PROMPT, parts })),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!raw) throw new Error("Gemini 返回为空：" + JSON.stringify(data).slice(0, 300));

  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    meta: {
      model: MODEL,
      promptTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      // 粗略成本估算（Flash 输入 $0.30/百万，输出 $2.50/百万）
      costUsd:
        ((data.usageMetadata?.promptTokenCount ?? 0) * 0.3 +
          (data.usageMetadata?.candidatesTokenCount ?? 0) * 2.5) /
        1_000_000,
    },
  };
}

/**
 * 可选：把计算结果翻译成一两句人话。
 * 注意——它只能"解释已有结论"，绝不能参与打分，也不能改变分数。
 */
export async function narrate(result) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const facts = {
    总分: result.total,
    等级: result.grade,
    营养分: Math.round(result.dims.nutrition),
    加工程度: `NOVA ${result.nova.level}`,
    添加剂: result.additives.map((a) => a.name),
    扣分项: result.deductions.map((d) => d.text),
  };

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: `你是营养信息解读助手。把已经算好的结果转述成 2 句话、不超过 60 字的中文。

硬性要求：
- 不许修改分数，不许新增扣分项，只能转述给你的数据。
- 不许出现"能吃/不能吃/有害/致癌/治疗/预防/降三高"。
- 陈述事实，把判断留给用户。
- 不要开场白。`,
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(facts) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim() ?? null;
}
