import { Platform } from "react-native";

/**
 * 历史记录。MVP 用 localStorage（web）/ 内存（native）。
 * 正式版换成 expo-sqlite 或 AsyncStorage。
 */
const KEY = "shifen.history.v1";
const memory: any[] = [];

function readRaw(): any[] {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {
      return [];
    }
  }
  return memory;
}

function writeRaw(list: any[]) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(KEY, JSON.stringify(list));
  } else {
    memory.length = 0;
    memory.push(...list);
  }
}

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
