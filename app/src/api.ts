import { Platform } from "react-native";

/**
 * 中转服务地址。
 * 浏览器 / iOS 模拟器：localhost 可用。
 * 真机：要换成电脑的局域网 IP，例如 http://192.168.1.5:8787
 */
const DEFAULT_BASE = Platform.OS === "web" ? "http://localhost:8787" : "http://localhost:8787";

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? DEFAULT_BASE;

export type AnalyzeResponse = {
  extracted: any;
  result: any;
  narrative: string | null;
};

/** 识别一次的客户端超时。真实手机照片走两段模型，慢的时候要 60–90 秒 */
const TIMEOUT_MS = 120_000;

export async function analyzeImage(base64: string, mimeType: string): Promise<AnalyzeResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, mimeType }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      // 中转服务把可读的原因放在 {error} 里，优先用它
      let msg = "";
      try {
        const data = await res.json();
        msg = data?.error ?? "";
      } catch {
        msg = (await res.text().catch(() => "")).slice(0, 200);
      }
      throw new Error(msg || `服务返回 ${res.status}`);
    }
    return (await res.json()) as AnalyzeResponse;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("识别超时（超过 2 分钟）。照片越大越慢，换一张更清晰、体积更小的照片再试。");
    }
    if (String(e?.message ?? "").includes("Network request failed") || String(e?.message ?? "").includes("Failed to fetch")) {
      throw new Error(
        `连不上中转服务（${API_BASE}）。\n请先在电脑上运行 npm run proxy，并确认 .env 里配了 ZHIPU_API_KEY。`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
