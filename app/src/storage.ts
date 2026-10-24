import { Platform } from "react-native";

/**
 * 历史记录。MVP 用 localStorage（web）/ 内存（native）。
 * 正式版换成 expo-sqlite 或 AsyncStorage。
 */
const KEY = "shifen.history.v1";
const RESULTS_KEY = "shifen.results.v1";
const memory: any[] = [];
const resultMemory: any[] = [];

function readList(key: string, fallback: any[]): any[] {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {
      return [];
    }
  }
  return fallback;
}

function writeList(key: string, list: any[], fallback: any[]) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(key, JSON.stringify(list));
  } else {
    fallback.length = 0;
    fallback.push(...list);
  }
}

const readRaw = () => readList(KEY, memory);
const writeRaw = (list: any[]) => writeList(KEY, list, memory);
const readResults = () => readList(RESULTS_KEY, resultMemory);
const writeResults = (list: any[]) => writeList(RESULTS_KEY, list, resultMemory);

export type HistoryItem = {
  id: string;
  name: string;
  total: number;
  grade: string;
  at: number;
};

export function listHistory(): HistoryItem[] {
  return readRaw().sort((a, b) => b.at - a.at).slice(0, 20);
}

export function pushHistory(item: HistoryItem) {
  const list = readRaw().filter((x) => x.id !== item.id);
  list.push(item);
  writeRaw(list.slice(-50));
}

export function clearHistory() {
  writeRaw([]);
}

/* ---------- 扫描结果缓存 ----------
 * 历史记录只存摘要，点进去要能还原完整结果；
 * 刷新页面也不能把刚扫的东西弄丢。只留最近 20 条。
 */
export function saveResult(result: any) {
  if (!result?.id) return;
  const list = readResults().filter((x: any) => x.id !== result.id);
  list.push({ id: result.id, at: Date.now(), result });
  writeResults(list.slice(-20));
}

export function getResult(id: string | undefined): any | null {
  if (!id) return null;
  return readResults().find((x: any) => x.id === id)?.result ?? null;
}
