/**
 * 把 Node 侧的评分引擎同步进 Expo App。
 *
 * 为什么用脚本而不是复制粘贴：引擎只有一份源文件（src/*.mjs），
 * App 里的那份是生成的产物。改引擎 → 跑一次 npm run sync → App 立刻同步，
 * 不会出现"两边算法不一致"这种最难查的 bug。
 *
 * 用法： node scripts/sync-engine.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = "app/src/engine";
mkdirSync(OUT, { recursive: true });

const MODULES = ["knowledge", "estimate", "score"];

for (const name of MODULES) {
  let code = readFileSync(`src/${name}.mjs`, "utf8");

  // .mjs 扩展名在 Metro 里不认，统一改成 .js
  code = code.replace(/(from\s+"\.\/[a-z]+)\.mjs"/g, '$1.js"');

  // 引擎层不允许碰 node 内置模块，命中即报错
  if (/from\s+"node:/.test(code)) {
    throw new Error(`${name}.mjs 引用了 node 内置模块，无法在 App 里运行`);
  }

  const banner = `// ⚠️ 自动生成，请勿直接修改。源文件：src/${name}.mjs（改完跑 npm run sync）\n`;
  writeFileSync(`${OUT}/${name}.js`, banner + code);
  console.log(`  src/${name}.mjs  →  ${OUT}/${name}.js`);
}

// 配置和知识库原样复制（它们是"规格"，两种实现共用）
for (const [from, to] of [
  ["config/params.json", `${OUT}/params.json`],
  ["data/knowledge.json", `${OUT}/knowledge.json`],
  ["data/samples.json", `${OUT}/samples.json`],
]) {
  writeFileSync(to, readFileSync(from));
  console.log(`  ${from}  →  ${to}`);
}

console.log("\n同步完成。");
