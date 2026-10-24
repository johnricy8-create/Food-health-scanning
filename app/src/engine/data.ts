// 引擎入口。score.js / params.json / knowledge.json 由 npm run sync 从 Node 侧生成。
import { analyse } from "./score.js";
import params from "./params.json";
import knowledge from "./knowledge.json";
import samplesJson from "./samples.json";

export type Sample = {
  id: string;
  name: string;
  brand?: string;
  category: string;
  unit: string;
  ingredients: string;
  nutrition: Record<string, number | null | undefined>;
};

export function score(sample: Sample, preset = "balanced") {
  return analyse(sample, knowledge, params, preset);
}

export const paramsConfig = params;
export const samples: Sample[] = (samplesJson as any).samples;

/** 首页"试用示例"：故意挑了分数跨度大的四个，一眼能看出评分在干什么 */
const DEMO_IDS = ["oats", "cola", "yogurt", "instant-noodle"];
export const demoSamples = DEMO_IDS.map((id) => samples.find((s) => s.id === id)!).filter(Boolean);
