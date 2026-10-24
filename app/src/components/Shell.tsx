import { ReactNode } from "react";
import { ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { C } from "../theme";

/** 页面容器：手机上全宽，桌面浏览器上收成一列 480px，避免拉得难看 */
export function Shell({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.column, style]}>{children}</View>
    </ScrollView>
  );
}

/** 非滚动的固定页脚/按钮区 */
export function ShellFixed({ children }: { children: ReactNode }) {
  return (
    <View style={styles.fixedOuter}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 48 },
  column: { width: "100%", maxWidth: 480, alignSelf: "center", paddingHorizontal: 20 },
  fixedOuter: {
    backgroundColor: C.bg,
    paddingTop: 10,
    paddingBottom: 24,
  },
});
