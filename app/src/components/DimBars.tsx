import { StyleSheet, Text, View } from "react-native";
import { C, DIM_LABEL } from "../theme";

const ORDER = ["nutrition", "processing", "additives"];

export function DimBars({ dims }: { dims: Record<string, number> }) {
  return (
    <View>
      {ORDER.map((k, i) => {
        const v = Math.round(dims[k] ?? 0);
        const meta = DIM_LABEL[k];
        return (
          <View key={k} style={[styles.row, i > 0 && styles.rowSpaced]}>
            <View style={styles.head}>
              <Text style={styles.label}>
                {meta.name}
                <Text style={styles.weight}>  {meta.weight}</Text>
              </Text>
              <Text style={[styles.value, { color: v >= 70 ? C.accent : v >= 45 ? C.amber : C.danger }]}>{v}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.max(2, Math.min(100, v))}%`, backgroundColor: meta.color }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {},
  rowSpaced: { marginTop: 18 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  label: { fontSize: 14, color: C.ink, fontWeight: "600" },
  weight: { fontSize: 11.5, color: C.faint, fontWeight: "400" },
  value: { fontSize: 16, fontWeight: "800" },
  track: { height: 8, backgroundColor: "#F0F3F7", borderRadius: 99, overflow: "hidden" },
  fill: { height: 8, borderRadius: 99 },
});
