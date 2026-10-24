import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Shell } from "../components/Shell";
import { C, scoreColor } from "../theme";
import { demoSamples, score, Sample } from "../engine/data";
import { analyzeImage } from "../api";
import { listHistory, pushHistory, HistoryItem } from "../storage";
import { setCurrent } from "../store";

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      setHistory(listHistory());
    }, [])
  );

  const finish = (r: any, narrative?: string | null) => {
    setCurrent(narrative ? { ...r, _narrative: narrative } : r);
    pushHistory({ id: r.id, name: r.name, total: r.total, grade: r.grade, at: Date.now() });
    setHistory(listHistory());
    router.push({ pathname: "/result", params: { id: r.id } });
  };

  const pick = async (fromCamera: boolean) => {
    setError(null);
    try {
      if (fromCamera) {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted && Platform.OS !== "web") {
          setError("没有相机权限。可以在系统设置里打开，或改用「从相册选择」。");
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 0.8,
        base64: true,
      };
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);

      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      if (!asset.base64) {
        setError("没能读到图片数据，请换一张试试。");
        return;
      }

      setBusy(true);
      const out = await analyzeImage(asset.base64, asset.mimeType ?? "image/jpeg");
      finish(out.result, out.narrative);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const runDemo = (s: Sample) => {
    setError(null);
    finish(score(s));
  };

  return (
    <View style={{ flex: 1 }}>
      <Shell>
        <View style={styles.header}>
          <View style={styles.logo}>
            <View style={[styles.bar, { height: 7 }]} />
            <View style={[styles.bar, { height: 15 }]} />
            <View style={[styles.bar, { height: 11 }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>配料表评分</Text>
            <Text style={styles.tagline}>拍配料表，看健康分</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroTitle}>拍一张配料表</Text>
          <Text style={styles.heroDesc}>
            对准包装上的「配料」和「营养成分表」，尽量拍平、拍清楚。识别后给出 0–100 分，并逐条说明扣在哪。
          </Text>

          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            onPress={() => pick(true)}
            disabled={busy}
          >
            <Text style={styles.primaryText}>拍照识别</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
            onPress={() => pick(false)}
            disabled={busy}
          >
            <Text style={styles.ghostText}>从相册选择</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>没能完成识别</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.section}>先试试这几个</Text>
        <View style={styles.chips}>
          {demoSamples.map((s) => (
            <Pressable
              key={s.id}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              onPress={() => runDemo(s)}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={styles.chipSub}>{s.category}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.section}>最近识别</Text>
          {history.length > 0 ? <Text style={styles.count}>{history.length} 条</Text> : null}
        </View>

        {history.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有记录。拍一张，或者点上面的示例。</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {history.map((h, i) => (
              <View key={h.id + h.at} style={[styles.row, i > 0 && styles.rowDivider]}>
                <View style={[styles.gradeBox, { backgroundColor: scoreColor(h.total) }]}>
                  <Text style={styles.gradeText}>{h.grade}</Text>
                </View>
                <Text style={styles.rowName} numberOfLines={1}>
                  {h.name}
                </Text>
                <Text style={[styles.rowScore, { color: scoreColor(h.total) }]}>{h.total}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          分数根据配料表与营养成分表计算，用于同类食品横向比较。仅供参考，不构成医疗或膳食建议。
        </Text>
      </Shell>

      {busy ? (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <ActivityIndicator color={C.accent} size="large" />
            <Text style={styles.overlayTitle}>正在识别配料表…</Text>
            <Text style={styles.overlaySub}>抄录文字 · 解析营养 · 计算分数</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 30, paddingBottom: 22 },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.accent,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 3,
    paddingBottom: 10,
  },
  bar: { width: 4, borderRadius: 2, backgroundColor: "#FFFFFF" },
  brand: { fontSize: 21, fontWeight: "800", color: C.ink, letterSpacing: 0.4 },
  tagline: { fontSize: 12.5, color: C.faint, marginTop: 3 },

  hero: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: "#0B1220",
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  heroTitle: { fontSize: 20, fontWeight: "800", color: C.ink },
  heroDesc: { fontSize: 13.5, color: C.sub, lineHeight: 22, marginTop: 8, marginBottom: 20 },

  primaryBtn: {
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    shadowColor: C.accent,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 0.6 },
  ghostBtn: { paddingVertical: 13, alignItems: "center", marginTop: 4 },
  ghostText: { color: C.sub, fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.75 },

  errorCard: {
    backgroundColor: "#FDF3F2",
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#F7DCD8",
  },
  errorTitle: { color: C.danger, fontWeight: "700", fontSize: 13.5, marginBottom: 6 },
  errorText: { color: "#7A271A", fontSize: 12.5, lineHeight: 19 },

  section: { fontSize: 14.5, fontWeight: "700", color: C.ink, marginTop: 28, marginBottom: 12 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  count: { fontSize: 12, color: C.faint },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    backgroundColor: C.card,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 15,
    width: "48%",
    flexGrow: 1,
    borderWidth: 1,
    borderColor: C.line,
  },
  chipText: { fontSize: 13.5, fontWeight: "600", color: C.ink },
  chipSub: { fontSize: 11, color: C.faint, marginTop: 4 },

  empty: { backgroundColor: C.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.line },
  emptyText: { color: C.faint, fontSize: 13 },

  list: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.line },
  gradeBox: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  gradeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  rowName: { flex: 1, fontSize: 14, color: C.ink, fontWeight: "500" },
  rowScore: { fontSize: 17, fontWeight: "800" },

  footer: { fontSize: 11.5, color: C.faint, lineHeight: 19, marginTop: 32 },

  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(17,24,39,0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 34,
    alignItems: "center",
    gap: 10,
  },
  overlayTitle: { fontSize: 15, fontWeight: "700", color: C.ink, marginTop: 6 },
  overlaySub: { fontSize: 12, color: C.faint },
});
