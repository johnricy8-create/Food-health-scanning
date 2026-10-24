export const C = {
  bg: "#F6F7F9",
  card: "#FFFFFF",
  line: "#EDF0F4",
  ink: "#111827",
  sub: "#5A6878",
  faint: "#93A0AE",
  accent: "#12855A",
  accentSoft: "#E8F4EE",
  warn: "#B45309",
  warnSoft: "#FDF3E3",
  danger: "#B42318",
  blue: "#2C6FA8",
  purple: "#6B5AC9",
  amber: "#C08A2E",
};

/** 分数色：绿 → 黄 → 红，只用于分数，不用于文案 */
export function scoreColor(n: number) {
  if (n >= 85) return "#12855A";
  if (n >= 70) return "#5C9E1E";
  if (n >= 55) return "#C08A2E";
  if (n >= 40) return "#C2622A";
  return "#B42318";
}

export function scoreTint(n: number) {
  if (n >= 85) return "#E8F4EE";
  if (n >= 70) return "#EFF6E4";
  if (n >= 55) return "#FBF3E2";
  if (n >= 40) return "#FBEDE4";
  return "#FAE9E7";
}

export function gradeOf(n: number) {
  if (n >= 85) return "A";
  if (n >= 70) return "B";
  if (n >= 55) return "C";
  if (n >= 40) return "D";
  return "E";
}

export const DIM_LABEL: Record<string, { name: string; weight: string; color: string }> = {
  nutrition: { name: "营养质量", weight: "60%", color: "#2C6FA8" },
  processing: { name: "加工程度", weight: "20%", color: "#6B5AC9" },
  additives: { name: "添加剂", weight: "20%", color: "#C08A2E" },
};

/** 分数档位对应的表情：80 以上笑脸、60–79 一般、60 以下坏脸 */
export const FACE: Record<string, { emoji: string; label: string; color: string }> = {
  high: { emoji: "😊", label: "表现很好", color: "#12855A" },
  mid: { emoji: "😐", label: "中规中矩", color: "#C08A2E" },
  low: { emoji: "🙁", label: "表现较差", color: "#B42318" },
};

export function faceOf(level: string | undefined, total: number) {
  const key = level ?? (total >= 80 ? "high" : total >= 60 ? "mid" : "low");
  return FACE[key] ?? FACE.mid;
}

/** 一句话结论：确定性生成，不依赖大模型，保证同一份数据永远同一句话 */
export function summaryOf(r: any) {
  const top = r.deductions?.[0]?.text;
  if (r.total >= 85) return "配料结构干净，营养表现处在同类前列。";
  if (r.total >= 70) return "整体尚可，有个别项值得留意。";
  if (r.total >= 55) return "存在明确扣分项，建议对照下面的理由自行判断。";
  if (top) return `主要扣分来自：${top.split("（")[0]}。`;
  return "扣分项较多，建议逐条查看。";
}
