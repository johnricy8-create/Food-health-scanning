import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { C } from "../theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: C.bg },
          animation: "slide_from_right",
        }}
      >
        {/* 这两个 title 同时决定浏览器标签页的标题 */}
        <Stack.Screen name="index" options={{ title: "配料表评分" }} />
        <Stack.Screen name="result" options={{ title: "评分结果 · 配料表评分" }} />
      </Stack>
    </>
  );
}
