import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { scoreColor, scoreTint } from "../theme";

const SIZE = 176;
const STROKE = 13;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function ScoreRing({ total, grade }: { total: number; grade: string }) {
  const color = scoreColor(total);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [total]);

  const dash = CIRC * (total / 100);

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={scoreTint(total)} strokeWidth={STROKE} fill="none" />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={color}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={`${dash} ${CIRC - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={[styles.num, { color }]}>{total}</Text>
        <Text style={styles.outOf}>/ 100</Text>
      </View>
      <View style={[styles.badge, { backgroundColor: color }]}>
        <Text style={styles.badgeText}>{grade}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  num: { fontSize: 52, fontWeight: "800", letterSpacing: -2, lineHeight: 58 },
  outOf: { fontSize: 12, color: "#93A1B3", marginTop: -2 },
  badge: {
    position: "absolute",
    right: 2,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
  },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
