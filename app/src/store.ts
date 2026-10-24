// 极简内存状态：首页识别完 → 结果页读取。
// MVP 阶段够用；正式版应改为路由参数 + 持久化。
let current: any = null;

export function setCurrent(r: any) {
  current = r;
}

export function getCurrent() {
  return current;
}
