/**
 * 抽取层入口：按 AI_PROVIDER 选择实现。
 *
 *   AI_PROVIDER=zhipu   → 智谱 GLM（默认）
 *   AI_PROVIDER=gemini  → Google Gemini
 *
 * 换供应商只改 .env 一行，proxy 和打分逻辑都不用动。
 */
const provider = (process.env.AI_PROVIDER ?? "zhipu").toLowerCase();
const impl = provider === "gemini" ? await import("./gemini.mjs") : await import("./zhipu.mjs");

export const extract = impl.extract;
export const narrate = impl.narrate;

export function providerInfo() {
  if (provider === "gemini") {
    return {
      provider: "gemini",
      model: "gemini-2.5-flash",
      visionModel: "gemini-2.5-flash",
      hasKey: Boolean(process.env.GEMINI_API_KEY),
      keyName: "GEMINI_API_KEY",
    };
  }
  return {
    provider: "zhipu",
    model: process.env.AI_MODEL ?? "glm-4.7-flash",
    visionModel: process.env.AI_VISION_MODEL ?? "glm-4.6v",
    hasKey: Boolean(process.env.ZHIPU_API_KEY),
    keyName: "ZHIPU_API_KEY",
  };
}
