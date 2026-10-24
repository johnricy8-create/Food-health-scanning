import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Shell } from "../components/Shell";
import { ScoreRing } from "../components/ScoreRing";
import { DimBars } from "../components/DimBars";
import { C, scoreColor, summaryOf, faceOf } from "../theme";
import { getCurrent } from "../store";
import { samples, score } from "../engine/data";

export default function Result() {
  // 优先用 ?id= 重新算（刷新/深链都不会丢），否则读内存里的扫描结果
  const { id } = useLocalSearchParams<{ id?: string }>();
  const fromId = id ? samples.find((s) => s.id === id) : undefined;
  const r = fromId ? score(fromId) : getCurrent();

  if (!r) {
    return (
      <Shell>
        <View style={{ paddingTop: 80, alignItems: "center" }}>
          <Text style={{ color: C.sub }}>没有可显示的结果</Text>
          <Pressable style={styles.backBtn} onPress={() => router.replace("/")}>
            <Text style={styles.backBtnText}>回到首页</Text>
          </Pressable>
        </View>
      </Shell>
    );
  }

  const unit = r.isBeverage ? "ml" : "g";
  const color = scoreColor(r.total);
  const face = faceOf(r.level, r.total);
  const conf = r.nutritionConfidence;
  const confText = conf === "high" ? "数据完整" : conf === "medium" ? "部分估算" : "估算较多";
  const confColor = conf === "high" ? C.accent : conf === "medium" ? C.amber : C.danger;

  const advice: { title: string; text: string }[] = r.advice ?? [];
  const energy = r.energy ?? null;

  const nutrients: { label: string; value: string; note?: string }[] = [
    { label: "能量", value: `${Math.round(r.nutrients.energyKj ?? 0)} kJ` },
    { label: "蛋白质", value: `${fmt(r.nutrients.proteinG)} g` },
    { label: "脂肪", value: `${fmt(r.nutrients.fatG)} g` },
    { label: "碳水化合物", value: `${fmt(r.nutrients.carbG)} g` },
    { label: "钠", value: `${Math.round(r.nutrients.sodiumMg ?? 0)} mg` },
    { label: "糖", value: `${fmt(r.nutrients.sugarG)} g`, note: r.nutritionDetail?.sugar?.confidence === "high" ? "标示" : "估算" },
    { label: "饱和脂肪", value: `${fmt(r.nutrients.satFatG)} g`, note: r.nutritionDetail?.satFat?.confidence === "high" ? "标示" : "估算" },
    { label: "膳食纤维", value: `${fmt(r.nutrients.fiberG)} g` },
  ];

  const pctColor = energy ? (energy.pctPerServing <= 10 ? C.accent : energy.pctPerServing <= 25 ? C.amber : C.danger) : C.accent;

  return (
    <Shell>
      <View style={styles.topbar}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={12}>
          <Text style={styles.back}>‹ 返回</Text>
        </Pressable>
      </View>

      {/* 分数 */}
      <View style={styles.hero}>
        <Text style={styles.face}>{face.emoji}</Text>
        <Text style={[styles.faceLabel, { color: face.color }]}>{face.label}</Text>

        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={2}>
            {r.name}
          </Text>
          <View style={[styles.confChip, { backgroundColor: conf === "high" ? C.accentSoft : C.warnSoft }]}>
            <Text style={[styles.confText, { color: confColor }]}>{confText}</Text>
          </View>
        </View>
        <Text style={styles.meta}>
          {r.category} · 每 100{unit}
        </Text>

        <View style={styles.ringWrap}>
          <ScoreRing total={r.total} grade={r.grade} />
        </View>

        <View style={styles.reasonBox}>
          <Text style={styles.reasonLabel}>为什么是这个分数</Text>
          <Text style={styles.reasonText}>{r.reason ?? summaryOf(r)}</Text>
        </View>

        {r.capped ? (
          <Text style={styles.capNote}>
            Nutri-Score 等级为 {r.nutri.grade}，按国际通行的等级上限，总分封顶 {r.ceiling} 分
          </Text>
        ) : null}
      </View>

      {/* 食用建议 */}
      {advice.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>食用建议</Text>
          {advice.map((a, i) => (
            <View key={i} style={[styles.adviceItem, i > 0 && styles.adviceDivider]}>
              <Text style={styles.adviceTitle}>{a.title}</Text>
              <Text style={styles.adviceText}>{a.text}</Text>
            </View>
          ))}
          <Text style={styles.note}>以上建议根据营养数据自动生成，仅供搭配参考。</Text>
        </View>
      ) : null}

      {/* 能量摄入 */}
      {energy ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>能量摄入</Text>

          <View style={styles.energyHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.energyNum}>
                {energy.per100Kj}
                <Text style={styles.energyNumUnit}> kJ / 100{unit}</Text>
              </Text>
              <Text style={styles.energySub}>约 {energy.per100Kcal} kcal / 100{unit}</Text>
            </View>
            <View style={[styles.pctChip, { backgroundColor: pctColor + "1A" }]}>
              <Text style={[styles.pctChipText, { color: pctColor }]}>{energy.pctPerServing}%</Text>
              <Text style={styles.pctChipSub}>每日参考</Text>
            </View>
          </View>

          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.max(2, Math.min(100, energy.pctPerServing))}%`, backgroundColor: pctColor },
              ]}
            />
          </View>

          <Text style={styles.energyLine}>
            一次约 {energy.servingG}
            {unit}，能量 {energy.servingKcal} kcal，占每日参考摄入量（{energy.dailyRefKcal} kcal）的{" "}
            {energy.pctPerServing}%
          </Text>
          <Text style={styles.note}>
            参考值按成年人每天 {energy.dailyRefKcal} kcal 计；实际需求因年龄、性别、活动量而异。
          </Text>
        </View>
      ) : null}

      {/* 三个维度 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>三个维度</Text>
        <DimBars dims={r.dims} />
      </View>

      {/* 扣分 */}
      {r.deductions.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>扣分理由</Text>
          {r.deductions.map((d: any, i: number) => (
            <View key={i} style={styles.line}>
              <View style={[styles.mark, { backgroundColor: "#E3B3AE" }]} />
              <Text style={styles.lineText}>{d.text}</Text>
              {d.delta ? <Text style={styles.delta}>−{Math.round(d.delta * 10) / 10}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* 加分 */}
      {r.credits.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>加分项</Text>
          {r.credits.map((c: any, i: number) => (
            <View key={i} style={styles.line}>
              <View style={[styles.mark, { backgroundColor: "#9CCBB2" }]} />
              <Text style={styles.lineText}>{c.text}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* 配料 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>配料表</Text>
        <View style={styles.tokens}>
          {r.ingredients.map((t: string, i: number) => {
            const add = r.additives.find((a: any) => a.source === t);
            return (
              <View key={i} style={[styles.token, add && styles.tokenAdd]}>
                <Text style={[styles.tokenText, add && styles.tokenTextAdd]}>{t}</Text>
              </View>
            );
          })}
        </View>

        {r.additives.length > 0 ? (
          <View style={{ marginTop: 14 }}>
            {r.additives.map((a: any, i: number) => (
              <View key={i} style={styles.addRow}>
                <Text style={styles.addName}>{a.name}</Text>
                <Text style={styles.addFn}>
                  {a.fn}
                  {a.tier === "high" ? " · 高关注" : a.tier === "medium" ? " · 有争议" : ""}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.noAdd}>未使用食品添加剂</Text>
        )}
      </View>

      {/* 营养 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>营养成分（每 100{unit}）</Text>
        <View style={styles.grid}>
          {nutrients.map((n) => (
            <View key={n.label} style={styles.cell}>
              <Text style={styles.cellLabel}>
                {n.label}
                {n.note ? <Text style={styles.cellNote}>  {n.note}</Text> : null}
              </Text>
              <Text style={styles.cellValue}>{n.value}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.note}>「糖」与「饱和脂肪」中国标签不强制标示，未标示时由配料表推断。</Text>
      </View>

      {/* 过敏原 */}
      {r.allergens?.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>致敏物质</Text>
          <Text style={styles.allergenText}>{r.allergens.map((a: any) => a.name).join("、")}</Text>
          <Text style={styles.note}>仅作提示，不计入分数。</Text>
        </View>
      ) : null}

      <Pressable style={styles.primaryBtn} onPress={() => router.replace("/")}>
        <Text style={styles.primaryText}>再识别一个</Text>
      </Pressable>

      <Text style={styles.footer}>
        分数用于同类食品横向比较，不代表对你个人的适用性。参考 Nutri-Score 方法，仅供参考。
      </Text>
    </Shell>
  );
}

const fmt = (x: number | null | undefined) => (x == null ? "—" : Math.round(x * 10) / 10);

const styles = StyleSheet.create({
  topbar: { paddingTop: 22, paddingBottom: 12 },
  back: { color: C.sub, fontSize: 15, fontWeight: "600" },

  hero: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: "#0B1220",
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  nameRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, width: "100%" },
  name: { flex: 1, fontSize: 19, fontWeight: "800", color: C.ink, lineHeight: 26 },
  confChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  confText: { fontSize: 11, fontWeight: "700" },
  meta: { fontSize: 12, color: C.faint, marginTop: 6, alignSelf: "flex-start" },
  face: { fontSize: 54, lineHeight: 66, textAlign: "center" },
  faceLabel: { fontSize: 12.5, fontWeight: "700", letterSpacing: 1, marginBottom: 14 },
  ringWrap: { marginTop: 16, marginBottom: 16 },
  reasonBox: {
    width: "100%",
    backgroundColor: "#F7F9FB",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  reasonLabel: { fontSize: 11, fontWeight: "700", color: C.faint, letterSpacing: 0.6, marginBottom: 7 },
  reasonText: { fontSize: 13, color: C.sub, lineHeight: 21 },
  capNote: { fontSize: 11.5, color: C.faint, marginTop: 10, textAlign: "center", lineHeight: 18 },

  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 20,
    marginTop: 14,
    borderWidth: 1,
    borderColor: C.line,
  },
  cardTitle: { fontSize: 14.5, fontWeight: "700", color: C.ink, marginBottom: 16 },

  adviceItem: {},
  adviceDivider: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line },
  adviceTitle: { fontSize: 12.5, fontWeight: "700", color: C.accent, marginBottom: 6 },
  adviceText: { fontSize: 13.5, color: C.sub, lineHeight: 21 },

  energyHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  energyNum: { fontSize: 26, fontWeight: "800", color: C.ink, letterSpacing: -0.5 },
  energyNumUnit: { fontSize: 12, fontWeight: "500", color: C.faint, letterSpacing: 0 },
  energySub: { fontSize: 12, color: C.faint, marginTop: 4 },
  pctChip: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, alignItems: "center" },
  pctChipText: { fontSize: 17, fontWeight: "800" },
  pctChipSub: { fontSize: 9.5, color: C.faint, marginTop: 1 },
  track: { height: 8, backgroundColor: "#F0F3F7", borderRadius: 99, overflow: "hidden" },
  fill: { height: 8, borderRadius: 99 },
  energyLine: { fontSize: 13, color: C.sub, lineHeight: 21, marginTop: 12 },

  line: { flexDirection: "row", gap: 10, marginBottom: 12, alignItems: "flex-start" },
  mark: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  lineText: { flex: 1, fontSize: 13, color: C.sub, lineHeight: 20 },
  delta: { fontSize: 12.5, color: C.danger, fontWeight: "700", marginTop: 1 },

  tokens: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  token: {
    backgroundColor: "#F7F9FB",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: C.line,
  },
  tokenAdd: { backgroundColor: C.warnSoft, borderColor: "#F0DCB4" },
  tokenText: { fontSize: 12.5, color: C.sub },
  tokenTextAdd: { color: "#8A5A00" },
  addRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  addName: { fontSize: 12.5, color: C.ink, fontWeight: "600" },
  addFn: { fontSize: 11.5, color: C.faint },
  noAdd: { fontSize: 12.5, color: C.accent, marginTop: 12 },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", paddingVertical: 9 },
  cellLabel: { fontSize: 12, color: C.faint },
  cellNote: { fontSize: 10, color: C.amber },
  cellValue: { fontSize: 16, fontWeight: "700", color: C.ink, marginTop: 3 },
  note: { fontSize: 11, color: C.faint, lineHeight: 18, marginTop: 12 },

  allergenText: { fontSize: 13.5, color: C.ink, fontWeight: "600" },

  primaryBtn: {
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 20,
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 0.4 },
  backBtn: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: C.accent, borderRadius: 14 },
  backBtnText: { color: "#fff", fontWeight: "700" },
  footer: { fontSize: 11, color: C.faint, lineHeight: 18, marginTop: 20, textAlign: "center" },
});
