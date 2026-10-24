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

export async function analyzeImage(base64: string, mimeType: string): Promise<AnalyzeResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);

  try {
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, mimeType }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`服务返回 ${res.status}：${text.slice(0, 200)}`);
    }
    return (await res.json()) as AnalyzeResponse;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("识别超时，请检查网络后重试");
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
