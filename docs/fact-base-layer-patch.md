# 全量单章事实底座层（fact-base）增量补丁文档

> 版本：fact-base/1.0  
> 基于：oh-story-claudecode 主分支（2026-10-27 同步）  
> 改动文件：3 个（见下表）

---

## 一、背景与设计目标

`story-long-analyze` 原有的最细粒度产物是 `章节/第N章_摘要.md`（60-160 字概要 + P1~Pn 情节点）。它对 Stage 3~5 够用，但做了有损压缩，丢失了：

- 全量场景序列与视角人物
- 角色的知识边界增量（`knowledge_gained` / `knowledge_lost_or_invalidated`）
- 设定变化分类（`change_kind: first_reveal / update / confirm / contradiction`）
- 精确硬数值与环境要素
- 伏笔生命周期状态
- 角色在情节点中的功能角色（`initiator / target / witness`）

本补丁在 Stage 2 的 `chapter-extractor` 子代理输出批次缓存 MD **之前**，为每章额外生成一份 `_fact_base/第N章_事实底座.yaml`，作为全量无损的原始层。批次缓存 MD 的所有字段均由 YAML 确定性派生，下游 Stage 3~5 可通过 `digest --source fact_base` 直接读取精确字段，无需重新推断。

---

## 二、改动文件一览

| 文件 | 位置 | 改动性质 |
|---|---|---|
| `story_hook_cli.js` | `skills/story-setup/references/templates/hooks/` | 扩展 `analysis-input-guard` 守卫，放行 `_fact_base/*.yaml` 写入 |
| `chapter-extractor.md` | `skills/story-setup/references/templates/agents/` | 新增 YAML 输出协议；maxTurns 20→30；更新交付格式与自检 |
| `manage_analysis_run.py` | `skills/story-long-analyze/scripts/` | 新增 `digest --source fact_base` 子命令及相关函数 |

---

## 三、文件逐项 Patch 说明

### 3.1 `story_hook_cli.js` — `analysis-input-guard` 扩展

**位置**：`analysis-input-guard` 分支，`const absolute = path.resolve(root, target)` 之后、`const reasons = []` 之前。

**插入内容**（13 行）：

```js
// Fast-path：也允许写 {拆文目录}/_fact_base/第{N}章_事实底座.yaml
const factMatch = /^第(\d+)章_事实底座\.yaml$/.exec(path.basename(absolute))
if (factMatch) {
  const factDir = path.dirname(absolute)
  const bookDir0 = path.dirname(factDir)
  const rel0 = path.relative(root, absolute)
  if (
    path.basename(factDir) === "_fact_base" &&
    !rel0.startsWith("..") && !path.isAbsolute(rel0) &&
    ["chapter_index.csv", "_progress.md"].some((n) => fs.existsSync(path.join(bookDir0, n)))
  ) process.exit(0)
  // 路径格式不合法时不走 fast-path，继续走下面的 _analysis_cache 检查（会被拒收并给出提示）
}
```

**逻辑**：文件名匹配 `第{N}章_事实底座.yaml` 且父目录为 `_fact_base`、祖父目录是合法拆文目录（有 `chapter_index.csv` 或 `_progress.md`）、路径在项目内，则放行（`exit(0)`）。不满足任一条件时 fall-through 到原有的 `_analysis_cache` 检查，仍会被正常拒收。

---

### 3.2 `chapter-extractor.md` — 三处改动

#### 3.2.1 Frontmatter

将以下字段替换：

```yaml
# 旧
maxTurns: 20
# maxTurns: 20 — 覆盖自读原文、读交接、写入、四项 Grep 自查与定点 Edit 修正后再回执。
# Write/Edit 只许落到 {拆文目录}/_analysis_cache/输入-{批次ID}.md：守卫在 story_hook_cli.js 的
# analysis-input-guard，经本挂载点只作用于本 agent。改 tools 就同步改 matcher。
# OpenCode 没有这个挂载点：sync-opencode.py 按守卫名把 edit 权限收窄到同一批路径。
```

```yaml
# 新
maxTurns: 30
# maxTurns: 30 — raw-original 每批最多3章各写1份 YAML（3×Write）+1份批次 MD，加读原文、读交接、四项 Grep 自查与定点 Edit 修正。existing-results 不写 YAML，总轮次仍在 30 内。
# Write/Edit 允许两类路径：① {拆文目录}/_analysis_cache/输入-{RAW|REUSE}-{起章}-{止章}.md
# ② {拆文目录}/_fact_base/第{N}章_事实底座.yaml；守卫在 story_hook_cli.js 的 analysis-input-guard，
# 经本挂载点只作用于本 agent。改 tools 就同步改 matcher。
# OpenCode 没有这个挂载点：sync-opencode.py 按守卫名把 edit 权限收窄到上述两类路径。
```

Description 也同步更新，说明 raw-original 模式现在额外写 YAML。

#### 3.2.2 新增「事实底座 YAML」章节

在 `## 交付：写文件、只回回执` **之前**整体插入，内容包含：

- `existing-results` 模式不写 YAML 的说明
- `raw-original` 模式写 YAML 优先的说明
- 完整字段规格（见第四节 Schema 定义）

#### 3.2.3 更新「交付」章节与自检第 9 条

**交付章节**（旧 → 新关键差异）：

```markdown
# 旧
- 把下方模板的**完整输出**用 Write 一次写入调用方给的输出文件。**只写、只改这一个路径**…
- 写完后最终回复只有一行回执：`BATCH_WRITTEN: {批次ID} | {输出文件} | 第N章 X点…`

# 新
**raw-original 写入顺序**（`existing-results` 跳过 YAML 步骤，直接写批次缓存 MD）：

1. 对本批每章，依次用 Write 写 `{拆文目录}/_fact_base/第{N}章_事实底座.yaml`
2. 用 Write 一次写入批次缓存 MD（字段从已写入 YAML 直接派生，无需重新推断）
3. 只写上述指定路径…

- 回执：`BATCH_WRITTEN: {批次ID} | {输出文件} | 第N章 X点… | YAML:第N章,第N+1章,…`
```

**自检第 9 条**：
```markdown
# 旧
9. 完整输出已写入指定文件、回复只有一行回执；没有写其他文件。

# 新
9. `raw-original`：每章的 `_fact_base/第{N}章_事实底座.yaml` 已写入，且批次缓存 MD 已写入。
   `existing-results`：只有批次缓存 MD 写入。回复只有一行回执；没有写其他文件。
```

---

### 3.3 `manage_analysis_run.py` — 三处改动

#### 3.3.1 新增 PyYAML 可选导入

在 `from typing import ...` 之后插入：

```python
try:
    import yaml as _yaml  # PyYAML is optional; fact_base digest degrades gracefully without it
    _YAML_OK = True
except ImportError:
    _YAML_OK = False
```

PyYAML 缺失时 `--source fact_base` 返回 `fact_base_no_yaml` 错误，不影响现有功能。

#### 3.3.2 新增常量与函数（在 `SUMMARY_FIELDS` 之后）

```python
FACT_BASE_FIELDS = (...)        # YAML key paths
FACT_BASE_ALIASES = {           # 中文简称 → YAML dot-path
    "概要": "narrative_structure.chapter_causal_summary.abstract",
    "关键行动": "narrative_structure.chapter_causal_summary.key_action",
    "局面结果": "narrative_structure.chapter_causal_summary.situation_result",
    "章尾钩子": "narrative_structure.chapter_causal_summary.chapter_end_hook",
    "涉及人物": "state_deltas.character_states",
    "信息变化": "state_deltas.info_boundary_updates",
    "状态变化": "state_deltas.character_states",
    "三维节奏": "narrative_structure.three_axis_rhythm",
    "伏笔":    "cross_chapter_continuity.foreshadowings",
    "悬念":    "cross_chapter_continuity.unresolved_suspense",
    "剧情点":  "cross_chapter_continuity.plot_arc_updates",
    "别名":    "cross_chapter_continuity.alias_confirmations",
    "设定变化": "state_deltas.world_state_deltas",
    "硬数值":  "state_deltas.world_state_deltas",   # filtered to hard_numbers only
    "写法样本": "style_samples",
    "情节点":  "plot_sequence",
    "场景":    "narrative_structure.scene_sequence",
}
```

新增四个函数：
- `fact_base_path(root, chapter)` — 返回 YAML 文件路径
- `digest_fact_base(root, window, fields)` — 读 YAML 并格式化输出
- `_dig_nested(obj, dotted)` — dot-notation 嵌套取值
- `_filter_hard_numbers(world_deltas)` — 过滤 `hard_numbers` 非空条目
- `_yaml_value_to_str(value)` — 将 YAML 值序列化为字符串

#### 3.3.3 更新 `digest_command` 与 `build_parser`

**`digest_command` 开头增加 source 分支**：
```python
if getattr(args, "source", None) == "fact_base":
    fields = [item.strip() for item in (args.fields or "").split(",") if item.strip()]
    if not fields:
        raise RunError("digest_empty_request", "pass --fields when using --source fact_base")
    return {"ok": True, "text": digest_fact_base(root, window, fields)}
```

**`build_parser` 中 digest 子命令新增参数**：
```python
# 新增 --source
digest.add_argument("--source", choices=("cache", "fact_base"), default="cache", ...)
# --part 改为非必填（--source=fact_base 时忽略）
digest.add_argument("--part", choices=("observations", "chapters"), ...)  # required 移除
# --fields 说明更新
digest.add_argument("--fields", help="...cache uses summary labels, fact_base uses YAML keys or shorthand aliases")
```

---

## 四、YAML Schema 定义（fact-base/1.0）

```yaml
chapter_fact_base:
  meta:
    chapter_no: int
    title: str
    source_locator: {file: str, line_start: int, line_end: int}
    char_count: int
    schema_version: "fact-base/1.0"

  plot_sequence:          # 与批次 MD 的 P1~Pn 一一对应，按文本披露顺序
    - id: str             # "P1", "P2" …
      type: enum          # 转折点/信息揭示/冲突/解决/铺垫/行动/对话/状态变化
      summary: str        # ≤40字白描，谁做什么结果如何
      agents: [{name: str, role: enum}]
      # role: initiator / target / witness / beneficiary / loser
      location: str | null
      items: list[str]
      time_ref: str | null
      causal:             # 有局面变化时填，纯铺垫/过渡各字段留 null
        goal: str | null
        obstacle: str | null
        action_or_event: str | null
        outcome: str | null
        cost_gain: str | null
      tags: {theme: enum, tone: enum}
      locator: str        # source_locator + 5-15字定位词
      quote: str | null   # ≤400字原文切片，每章≤8条

  state_deltas:
    character_states:
      - name: str
        aliases_this_chapter: list[str]
        location_at_end: str | null
        physical_state_delta: str | null
        mental_state_delta: str | null
        goal_delta: str | null
        knowledge_gained: list[str]
        knowledge_lost_or_invalidated: list[str]
        power_level_delta: str | null   # 原文硬数值，否则 null
        resource_delta: str | null
        evidence_grade: A | B | C
        evidence: str

    relationship_deltas:
      - id: str           # REL-{章号}-{序号}
        subject: str
        object: str
        action_type: str
        surface_state: str
        real_state: str
        trigger_plot_point: str
        subject_gain_loss: str
        object_gain_loss: str
        post_state: str
        evidence_grade: A | B | C
        evidence: str

    world_state_deltas:
      - type: enum        # power_system/geography/faction/rule/item/resource/other
        name: str
        change_kind: enum # first_reveal / update / confirm / contradiction
        old_value: str | null
        new_value: str
        hard_numbers: str | null
        evidence_grade: A | B | C
        evidence: str

    info_boundary_updates:
      - linked_plot_point: str | null
        readers_now_know: str
        readers_still_dont_know: str | null
        character_info_gaps:
          - {character: str, knows: str | null, doesnt_know: str | null}
        reveal_kind: enum # anomaly/clue/explanation/confirmation/misdirection
        evidence: str

  narrative_structure:
    scene_sequence:
      - scene_no: int
        location: str
        time_ref: str | null
        pov_character: str | null
        plot_points_covered: list[str]
        word_ratio_approx: float
        function: enum    # setup/conflict/reveal/transition/climax/denouement

    three_axis_rhythm:
      event_progression:  {score: int, rationale: str}
      reader_emotion:     {types: list[str], intensity: int, trigger: str}
      pacing_density:     {score: int, handling: str}
      axis_divergence:    str | null

    chapter_causal_summary:
      abstract: str       # → 批次 MD **概要**
      key_action: str     # → 批次 MD **关键行动**
      situation_result: str   # → 批次 MD **局面结果**
      chapter_end_hook: {type: str | null, description: str | null}  # → **章尾钩子**

  cross_chapter_continuity:
    foreshadowings:
      - id: str           # FS-{章}-{序}
        status: enum      # planted/reinforced/partially_resolved/resolved/redirected
        content: str
        planted_chapter: int
        evidence: str

    unresolved_suspense:
      - {content: str, open_since_chapter: int, evidence: str}

    plot_arc_updates:
      - arc_id: str
        status: enum      # new/continuing/resolved/transformed
        goal: str
        obstacle: str
        latest_action_or_event: str
        situation_change: str
        cost_gain: str
        evidence: str

    alias_confirmations:
      - canonical_name: str
        alias: str
        evidence_type: enum  # appositive/parenthetical/contextual_reference/rename
        evidence: str

  style_samples:
    - sample_type: enum   # key_reversal / key_dialog / technique_sample
      locator: str
      excerpt: str        # ≤400字原文切片
      craft_note: str | null
```

---

## 五、YAML → 批次 MD 投影规则

| 批次 MD 字段 | YAML 来源 | 投影方式 |
|---|---|---|
| **概要** | `chapter_causal_summary.abstract` | 直接填入 |
| **因果** | `chapter_causal_summary` + 主转折点 `causal` | 格式拼接 |
| **关键行动** | `chapter_causal_summary.key_action` | 直接填入 |
| **局面结果** | `chapter_causal_summary.situation_result` | 直接填入 |
| **涉及人物** | `state_deltas.character_states[*].name` | union 去重 |
| **信息变化** | `state_deltas.info_boundary_updates` | 三段格式组装 |
| **状态变化** | `character_states` + `relationship_deltas` + `world_state_deltas` | 净变化组装 |
| **三维节奏** | `narrative_structure.three_axis_rhythm` | score+rationale 格式化 |
| **章尾钩子** | `chapter_causal_summary.chapter_end_hook` | 直接填入 |
| **证据** | `meta.source_locator` | 直接填入 |
| **P1~Pn** | `plot_sequence[*]` | format 转换，内容不变 |

---

## 六、新产物目录结构

```
{拆文目录}/
  _fact_base/
    第1章_事实底座.yaml   ← 新增，全量无损底座
    第2章_事实底座.yaml
    第3章_事实底座.yaml
    …
  _analysis_cache/
    批次-RAW-4-6.md       ← 不变，由 YAML 编译而来
  章节/
    第N章_摘要.md          ← 不变，由批次缓存投影
```

`_fact_base/` 目录下的文件不参与 `manage_analysis_run.py` 的状态管理（不写入 `_progress.md`），不影响 `commit` / `repair-progress` 的任何校验逻辑。

---

## 七、新 CLI 用法

```bash
# 从 YAML 底座读取精确字段（Stage 3/4 增量用）
python3 manage_analysis_run.py digest \
  --root "拆文库/{书名}" \
  --source fact_base \
  --fields 设定变化,硬数值,伏笔,剧情点 \
  --chapters 1-20

# 读取设定首次出现的所有 first_reveal 条目（Stage 4 增量归并用）
python3 manage_analysis_run.py digest \
  --root "拆文库/{书名}" \
  --source fact_base \
  --fields 设定变化 \
  --chapters 1-100

# 原有用法完全不变（--source cache 为默认值，--part 仍然必填）
python3 manage_analysis_run.py digest \
  --root "拆文库/{书名}" \
  --part chapters \
  --fields 概要,三维节奏
```

**`--fields` 可用简称（`--source fact_base`）**：

| 简称 | 对应 YAML 路径 |
|---|---|
| `概要` | `narrative_structure.chapter_causal_summary.abstract` |
| `关键行动` | `...chapter_causal_summary.key_action` |
| `局面结果` | `...chapter_causal_summary.situation_result` |
| `章尾钩子` | `...chapter_causal_summary.chapter_end_hook` |
| `涉及人物` | `state_deltas.character_states` |
| `信息变化` | `state_deltas.info_boundary_updates` |
| `状态变化` | `state_deltas.character_states` |
| `三维节奏` | `narrative_structure.three_axis_rhythm` |
| `伏笔` | `cross_chapter_continuity.foreshadowings` |
| `悬念` | `cross_chapter_continuity.unresolved_suspense` |
| `剧情点` | `cross_chapter_continuity.plot_arc_updates` |
| `别名` | `cross_chapter_continuity.alias_confirmations` |
| `设定变化` | `state_deltas.world_state_deltas`（完整条目） |
| `硬数值` | `state_deltas.world_state_deltas`（仅 `hard_numbers` 非空） |
| `写法样本` | `style_samples` |
| `情节点` | `plot_sequence` |
| `场景` | `narrative_structure.scene_sequence` |

---

## 八、合并冲突处理指南

拉取上游最新版本后，如果三个文件出现冲突，按以下顺序处理：

### `story_hook_cli.js`

找到 `analysis-input-guard` 分支内 `const absolute = path.resolve(root, target)` 这一行，确认其后紧跟的是 `const reasons = []`（上游原始）还是已有 Fast-path 块（已合入）。

如果是上游原始，在 `const reasons = []` **之前**插入第三节 3.1 的 13 行代码。

### `chapter-extractor.md`

1. 确认 `maxTurns` 是否已更新为 30，若不是则改为 30 并更新注释。
2. 在 `## 交付：写文件、只回回执` 之前整段插入「事实底座 YAML」章节（见第三节 3.2.2，完整内容在当前文件中）。
3. 更新「交付」章节开头段落和回执格式（见第三节 3.2.3）。
4. 更新自检第 9 条（见第三节 3.2.3）。

### `manage_analysis_run.py`

1. 在 `from typing import ...` 之后插入 PyYAML 导入块（见第三节 3.3.1）。
2. 在 `SUMMARY_FIELDS` 定义之后、`def parse_chapter_window` 之前插入 `FACT_BASE_FIELDS`、`FACT_BASE_ALIASES` 常量及五个新函数（见第三节 3.3.2）。
3. 在 `digest_command` 函数开头的 `window = parse_chapter_window(args.chapters)` 之后插入 `--source fact_base` 分支（见第三节 3.3.3）。
4. 在 `build_parser` 的 digest 子命令注册处：新增 `--source` 参数，将 `--part` 改为非必填，更新 `--fields` 说明（见第三节 3.3.3）。

---

## 九、向后兼容性

- 现有批次缓存（`_analysis_cache/批次-*.md`）和逐章摘要（`章节/第N章_摘要.md`）**完全不变**，不需要重新提取。
- `digest --source cache`（默认）行为与改动前完全一致，`--part` 仍然必须提供。
- `_fact_base/` 目录是可选的附产物，不存在时所有现有命令正常运行，只有 `digest --source fact_base` 会返回 `fact_base_empty` 错误。
- `existing-results` 模式的批次提取流程不变，不生成 YAML。
