# 配料表评分

拍一张食品配料表 → 得到一个 **0–100 的健康评分**（分数越高越健康）+ 可解释的扣分理由 + 食用建议。

有两条使用路径：

- **引擎 / 命令行**：Windows 上直接跑，不需要 Mac、不需要 API Key。
- **Expo App**：`app/` 里是 React Native 版界面，浏览器和 iOS 都能跑。

---

## 设计上的三个硬约束

1. **分数必须可复现**：同一张标签永远同一个分数。打分是纯规则，大模型**不参与打分**，只负责把图片/文字整理成结构化数据。
2. **不给"能不能吃"的结论**：只输出分数 + 事实 + 扣分理由 + 份量与搭配建议，把决策权交给用户。这既是产品定位，也是 App Store 审核最安全的写法。
3. **中国标签的糖和饱和脂肪必须估算**：国标只强制标"1+4"（能量/蛋白/脂肪/碳水/钠），糖和饱和脂肪几乎不标。引擎会从配料表推断，并把"这是估算"明确标出来。

---

## 目录

```
config/params.json        所有权重、阈值、锚点（调参只改这个文件）
data/knowledge.json       添加剂库、反式脂肪来源、游离糖、过敏原、NOVA 标志物
data/samples.json         22 个调参样本（示意性数值，非官方检测数据）
src/knowledge.mjs         配料解析 + 知识库匹配
src/estimate.mjs          缺失营养素估算（糖 / 饱和脂肪 / 膳食纤维）
src/score.mjs             Nutri-Score + 三维打分 + 总分 + 食用建议 + 能量换算
src/cli.mjs               跑批 → 控制台表格 + out/report.md + out/report.html
src/extract/zhipu.mjs     智谱抽取层（glm-4.6v 抄录 + glm-4.7-flash 结构化）
src/extract/gemini.mjs    Gemini 抽取层（备用）
src/extract/index.mjs     按 AI_PROVIDER 选供应商
server/proxy.mjs          极薄中转服务，保管 API Key
app/                      Expo App（浏览器 + iOS）
```

## 跑起来

```bash
node src/cli.mjs          # 跑全部样本，出分数表
```

浏览器打开 `out/report.html` 看可视化版本。

### App

```bash
npm run proxy             # 中转服务 http://localhost:8787（持 key）
cd app && npx expo start --web
```

改了 `src/*.mjs` 或 `config/params.json` 之后，记得同步进 App：

```bash
node scripts/sync-engine.mjs
```

## 接大模型

```bash
cp .env.example .env      # 填 ZHIPU_API_KEY
npm run proxy
```

```bash
curl -X POST localhost:8787/api/analyze \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"配料：小麦粉、白砂糖、植物油、食用盐\\n营养成分表：能量2000kJ 蛋白质7g 脂肪20g 碳水化合物65g 钠300mg\"}"
```

`AI_PROVIDER` 可选 `zhipu`（默认）或 `gemini`。智谱是两段式：`glm-4.6v` 先把图片抄成文字，`glm-4.7-flash` 再把文字整理成 JSON——因为 `glm-4.7-flash` 不接受图片输入。

一次扫描只调 1 次模型：`glm-4.6v` 直接读图输出结构化 JSON；如果输出不合法，自动退回「抄录 + 结构化」两段式。转述默认关闭（`AI_NARRATIVE=1` 才开）。App 上传前把图片长边压到 1280px：3000×4000 的原图要 35 秒，压完约 6 秒；同一张图重复识别直接命中缓存。

**Key 绝对不能打包进 App。** 正确链路是：

```
App  →  你的中转服务（持 key、限流）
     →  大模型（只做 OCR 与结构化）
     →  结构化 JSON
     →  App 本地跑打分引擎（离线、可复现、0 成本）
```

---

## 打分模型

```
总分 = 0.60×营养 + 0.20×加工程度 + 0.20×添加剂
     − 短板惩罚（Σ 权重×max(0, 65 − 各维度分) × 0.5，最多扣 12 分）
     再与"营养等级天花板"取小            ← 营养是 E 的产品，配料表再干净也上不去
```

三个维度：

| 维度 | 方法 | 数据来源 |
|---|---|---|
| 营养 60% | Nutri-Score 2021 算法（固体/饮料两套阈值）→ 分段映射到 0–100 | 营养成分表 + 糖/饱和脂肪估算 |
| 加工程度 20% | NOVA 1–4 → 100 / 88 / 65 / 35 | 配料表里的超加工标志成分 |
| 添加剂 20% | 每种添加剂按 low/medium/high 扣 6/14/30 分，**同功能类别最多累计 2 个** | 添加剂知识库 |

原先还有第四个"隐形风险"维度，现在取消了——它和另外三维高度重叠，单独列出来只会让用户困惑。它检测的信号没有丢，改成直接扣在对应维度上：

| 信号 | 扣分 | 扣在哪 |
|---|---|---|
| 含反式脂肪来源（植脂末、代可可脂…） | −10 | 营养 |
| 含游离糖来源 | −8 | 营养 |
| 含糖饮料（液体糖更易过量） | −7 | 营养 |
| 多种含钠配料叠加 | −12 | 添加剂 |

短板惩罚封顶是必要的：不封顶的话，三维都差的产品会被重复扣分，最后全挤在 0 分，失去区分度。

完整规则见 `spec/scoring-spec.md`。

## 食用建议与能量摄入

分数下面会给三条建议（一次吃多少 / 怎么搭配 / 什么时候吃），由 `src/score.mjs` 的 `buildAdvice()` 按规则生成，措辞只描述份量和搭配，不做健康结论。

能量摄入把"每 100g"换算成"吃一次大概多少"：份量按品类查 `params.servingSize`（饮料 250ml、饼干 30g…），每日参考值 2000 kcal / 8400 kJ。

## 调参

改 `config/params.json`，不碰代码。最影响结果的几个旋钮：

| 旋钮 | 位置 | 调大的效果 |
|---|---|---|
| `presets.*.weights` | 三维权重 | 让某一维度主导 |
| `presets.*.lowThreshold` | 短板惩罚起点（默认 65） | 更多维度触发惩罚 |
| `presets.*.penaltyStrength` | 短板惩罚强度（默认 0.5） | 同上，线性放大 |
| `presets.*.maxPenalty` | 短板惩罚上限（默认 12） | 低分产品掉得更狠 |
| `nutritionMapping.anchors` | Nutri-Score → 营养分 | 直接压缩/拉伸营养档位 |

内置三套预设（`balanced` / `nutritionHeavy` / `labelSensitive`），CLI 每次都会把三套分数并排打出来，方便看权重敏感度。

## 已知问题

- `data/samples.json` 是示意性数值，不是官方检测数据，别拿它当校准依据。
- 同一张图偶尔会被模型识别成别的产品（图片本身相同），属于模型侧不稳定，尚未完全定位。
- 智谱免费额度下连续调用会返回 429 / code 1302，一次扫描要 2 次模型调用（转述默认关闭）。
