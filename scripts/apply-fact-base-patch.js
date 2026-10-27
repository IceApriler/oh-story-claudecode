\
#!/usr/bin/env node
/**
 * apply-fact-base-patch.js
 * 把 fact-base/1.0 增量改动幂等地打入三个源文件。
 * rebase 冲突后用上游版本覆盖这三个文件时，跑此脚本重新合入。
 *
 * 用法：
 *   node scripts/apply-fact-base-patch.js [--dry-run] [--check]
 *   --dry-run   只打印会做什么，不写文件
 *   --check     检查三个文件是否已包含改动；exit 0=全包含, 1=有缺失
 */
"use strict"
const fs = require("node:fs")
const path = require("node:path")
const ROOT = path.resolve(__dirname, "..")
const DRY_RUN = process.argv.includes("--dry-run")
const CHECK   = process.argv.includes("--check")

const PATCHES = [
  // ── 文件1 ─────────────────────────────────────────────────────────────────
  {
    file: "skills/story-setup/references/templates/hooks/story_hook_cli.js",
    sentinel: "Fast-path：也允许写 {拆文目录}/_fact_base/第{N}章_事实底座.yaml",
    old: "  const absolute = path.resolve(root, target)\n  const reasons = []",
    new: "  const absolute = path.resolve(root, target)\n"
       + "  // Fast-path：也允许写 {拆文目录}/_fact_base/第{N}章_事实底座.yaml\n"
       + "  const factMatch = /^第(\\d+)章_事实底座\\.yaml$/.exec(path.basename(absolute))\n"
       + "  if (factMatch) {\n"
       + "    const factDir = path.dirname(absolute)\n"
       + "    const bookDir0 = path.dirname(factDir)\n"
       + "    const rel0 = path.relative(root, absolute)\n"
       + "    if (\n"
       + "      path.basename(factDir) === \"_fact_base\" &&\n"
       + "      !rel0.startsWith(\"..\") && !path.isAbsolute(rel0) &&\n"
       + "      [\"chapter_index.csv\", \"_progress.md\"].some((n) => fs.existsSync(path.join(bookDir0, n)))\n"
       + "    ) process.exit(0)\n"
       + "  }\n"
       + "  const reasons = []",
  },
  // ── 文件2 patch A：description ────────────────────────────────────────────
  {
    file: "skills/story-setup/references/templates/agents/chapter-extractor.md",
    sentinel: "raw-original 模式按章写 _fact_base/第N章_事实底座.yaml",
    old: "description: |\n"
       + "  连续章节块与已有成果归一专家。新内容模式一次读取一个不重叠的连续章节块，提取轻量章节事实和跨章剧情点；已有成果模式只读取旧拆文结果做二次提取，严禁回读原文或覆盖用户文件。\n"
       + "  被 story-long-analyze Stage 2 按运行计划调用；只读原文与旧成果，只写、只改调用方指定的一份批次输入文件，不碰其他文件，不做跨书比较或创作评价。",
    new: "description: |\n"
       + "  连续章节块与已有成果归一专家。新内容模式一次读取原文，提取全量单章事实底座 YAML 与批次缓存 MD；已有成果模式只读取旧拆文结果做二次提取，严禁回读原文或覆盖用户文件。\n"
       + "  被 story-long-analyze Stage 2 按运行计划调用；raw-original 模式按章写 _fact_base/第N章_事实底座.yaml（全量无损底座）再写批次缓存 MD；existing-results 模式只写批次缓存 MD，不写 YAML；不做跨书比较或创作评价。",
  },
  // ── 文件2 patch B：maxTurns ───────────────────────────────────────────────
  {
    file: "skills/story-setup/references/templates/agents/chapter-extractor.md",
    sentinel: "maxTurns: 30",
    old: "maxTurns: 20\n"
       + "# maxTurns: 20 — 覆盖自读原文、读交接、写入、四项 Grep 自查与定点 Edit 修正后再回执。\n"
       + "# Write/Edit 只许落到 {拆文目录}/_analysis_cache/输入-{批次ID}.md：守卫在 story_hook_cli.js 的\n"
       + "# analysis-input-guard，经本挂载点只作用于本 agent。改 tools 就同步改 matcher。\n"
       + "# OpenCode 没有这个挂载点：sync-opencode.py 按守卫名把 edit 权限收窄到同一批路径。",
    new: "maxTurns: 30\n"
       + "# maxTurns: 30 — raw-original 每批最多3章各写1份 YAML（3×Write）+1份批次 MD，加读原文、读交接、四项 Grep 自查与定点 Edit 修正。existing-results 不写 YAML，总轮次仍在 30 内。\n"
       + "# Write/Edit 允许两类路径：① {拆文目录}/_analysis_cache/输入-{RAW|REUSE}-{起章}-{止章}.md\n"
       + "# ② {拆文目录}/_fact_base/第{N}章_事实底座.yaml；守卫在 story_hook_cli.js 的 analysis-input-guard，\n"
       + "# 经本挂载点只作用于本 agent。改 tools 就同步改 matcher。\n"
       + "# OpenCode 没有这个挂载点：sync-opencode.py 按守卫名把 edit 权限收窄到上述两类路径。",
  },
  // ── 文件2 patch C：插入事实底座 YAML 章节 + 更新交付章节 ────────────────────
  {
    file: "skills/story-setup/references/templates/agents/chapter-extractor.md",
    sentinel: "## 事实底座 YAML（raw-original 专属）",
    old: "## 交付：写文件、只回回执\n\n"
       + "- 把下方模板的**完整输出**用 Write 一次写入调用方给的输出文件。**只写、只改这一个路径**，不碰其他任何文件；不要在回复里重复输出内容。\n"
       + "- 写完后最终回复只有一行回执：`BATCH_WRITTEN: {批次ID} | {输出文件} | 第N章 X点, 第N+1章 Y点, …`（`REUSE` 无章节块时写 `无章节块`）。",
    new: "## 事实底座 YAML（raw-original 专属）\n\n"
       + "`existing-results` 模式不写 YAML，直接写批次缓存 MD。\n\n"
       + "`raw-original` 模式在写批次缓存 MD **之前**，为本批每章分别写一份 `{拆文目录}/_fact_base/第{N}章_事实底座.yaml`。YAML 是全量无损底座，批次缓存 MD 的所有字段均由 YAML 确定性派生，不需要额外推断。详细字段规格见 docs/fact-base-layer-patch.md 第四节。\n\n"
       + "## 交付：写文件、只回回执\n\n"
       + "**raw-original 写入顺序**（`existing-results` 跳过 YAML 步骤，直接写批次缓存 MD）：\n\n"
       + "1. 对本批每章，依次用 Write 写 `{拆文目录}/_fact_base/第{N}章_事实底座.yaml`。\n"
       + "2. 用 Write 一次写入批次缓存 MD `{拆文目录}/_analysis_cache/输入-{批次ID}.md`。\n"
       + "3. **只写上述指定路径**，不碰其他任何文件；不要在回复里重复输出内容。\n\n"
       + "- 写完后最终回执：`BATCH_WRITTEN: {批次ID} | {输出文件} | 第N章 X点, 第N+1章 Y点, … | YAML:第N章,第N+1章,…`（`REUSE` 无章节块时写 `无章节块 | YAML:无`）。",
  },
  // ── 文件2 patch D：self-check 9 ──────────────────────────────────────────
  {
    file: "skills/story-setup/references/templates/agents/chapter-extractor.md",
    sentinel: "_fact_base/第{N}章_事实底座.yaml` 已写入，且批次缓存 MD 已写入",
    old: "9. 完整输出已写入指定文件、回复只有一行回执；没有写其他文件。",
    new: "9. `raw-original`：每章的 `_fact_base/第{N}章_事实底座.yaml` 已写入，且批次缓存 MD 已写入。`existing-results`：只有批次缓存 MD 写入。回复只有一行回执；没有写其他文件。",
  },
  // ── 文件3 patch A：PyYAML import ─────────────────────────────────────────
  {
    file: "skills/story-long-analyze/scripts/manage_analysis_run.py",
    sentinel: "PyYAML is optional; fact_base digest degrades gracefully without it",
    old: "from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple",
    new: "from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple\n\n"
       + "try:\n"
       + "    import yaml as _yaml  # PyYAML is optional; fact_base digest degrades gracefully without it\n"
       + "    _YAML_OK = True\n"
       + "except ImportError:\n"
       + "    _YAML_OK = False",
  },
  // ── 文件3 patch B：FACT_BASE constants + helper functions ─────────────────
  {
    file: "skills/story-long-analyze/scripts/manage_analysis_run.py",
    sentinel: "FACT_BASE_FIELDS",
    old: "# Labels as projected by render_summary (legacy summaries use the same labels).\n"
       + "SUMMARY_FIELDS = (\"概要\", \"关键事件\", \"因果\", \"局面结果\", \"涉及\", \"信息变化\", \"状态变化\",\n"
       + "                  \"三维节奏\", \"章尾钩子\", \"证据\")\n\n\n"
       + "def parse_chapter_window(value: Optional[str]) -> Optional[Tuple[int, int]]:",
    new: "# Labels as projected by render_summary (legacy summaries use the same labels).\n"
       + "SUMMARY_FIELDS = (\"概要\", \"关键事件\", \"因果\", \"局面结果\", \"涉及\", \"信息变化\", \"状态变化\",\n"
       + "                  \"三维节奏\", \"章尾钩子\", \"证据\")\n\n"
       + "FACT_BASE_FIELDS = (\n"
       + "    \"meta\", \"plot_sequence\", \"state_deltas.character_states\",\n"
       + "    \"state_deltas.relationship_deltas\", \"state_deltas.world_state_deltas\",\n"
       + "    \"state_deltas.info_boundary_updates\", \"narrative_structure.scene_sequence\",\n"
       + "    \"narrative_structure.three_axis_rhythm\", \"narrative_structure.chapter_causal_summary\",\n"
       + "    \"cross_chapter_continuity.foreshadowings\", \"cross_chapter_continuity.unresolved_suspense\",\n"
       + "    \"cross_chapter_continuity.plot_arc_updates\", \"cross_chapter_continuity.alias_confirmations\",\n"
       + "    \"style_samples\",\n"
       + ")\n"
       + "FACT_BASE_ALIASES = {\n"
       + "    \"概要\": \"narrative_structure.chapter_causal_summary.abstract\",\n"
       + "    \"关键行动\": \"narrative_structure.chapter_causal_summary.key_action\",\n"
       + "    \"局面结果\": \"narrative_structure.chapter_causal_summary.situation_result\",\n"
       + "    \"章尾钩子\": \"narrative_structure.chapter_causal_summary.chapter_end_hook\",\n"
       + "    \"涉及人物\": \"state_deltas.character_states\",\n"
       + "    \"信息变化\": \"state_deltas.info_boundary_updates\",\n"
       + "    \"状态变化\": \"state_deltas.character_states\",\n"
       + "    \"三维节奏\": \"narrative_structure.three_axis_rhythm\",\n"
       + "    \"伏笔\": \"cross_chapter_continuity.foreshadowings\",\n"
       + "    \"悬念\": \"cross_chapter_continuity.unresolved_suspense\",\n"
       + "    \"剧情点\": \"cross_chapter_continuity.plot_arc_updates\",\n"
       + "    \"别名\": \"cross_chapter_continuity.alias_confirmations\",\n"
       + "    \"设定变化\": \"state_deltas.world_state_deltas\",\n"
       + "    \"硬数值\": \"state_deltas.world_state_deltas\",\n"
       + "    \"写法样本\": \"style_samples\",\n"
       + "    \"情节点\": \"plot_sequence\",\n"
       + "    \"场景\": \"narrative_structure.scene_sequence\",\n"
       + "}\n\n\n"
       + "def fact_base_path(root, chapter):\n"
       + "    return root / \"_fact_base\" / (\"\u7b2c%d\u7ae0_\u4e8b\u5b9e\u5e95\u5ea7.yaml\" % chapter)\n\n\n"
       + "def digest_fact_base(root, window, fields):\n"
       + "    if not _YAML_OK:\n"
       + "        raise RunError(\"fact_base_no_yaml\", \"PyYAML not installed; pip install pyyaml\")\n"
       + "    import re as _re\n"
       + "    available = sorted(\n"
       + "        int(m.group(1)) for p in (root / \"_fact_base\").glob(\"\u7b2c*\u7ae0_\u4e8b\u5b9e\u5e95\u5ea7.yaml\")\n"
       + "        for m in [_re.fullmatch(r\"\u7b2c(\\d+)\u7ae0_\u4e8b\u5b9e\u5e95\u5ea7\", p.stem)] if m\n"
       + "    )\n"
       + "    if not available:\n"
       + "        raise RunError(\"fact_base_empty\", \"no _fact_base/*.yaml files found\")\n"
       + "    parts = []\n"
       + "    for chapter in available:\n"
       + "        if window and not window[0] <= chapter <= window[1]:\n"
       + "            continue\n"
       + "        data = _yaml.safe_load(fact_base_path(root, chapter).read_text(encoding=\"utf-8-sig\"))\n"
       + "        if not isinstance(data, dict):\n"
       + "            continue\n"
       + "        cfb = data.get(\"chapter_fact_base\", data)\n"
       + "        lines = [\"\u7b2c%d\u7ae0\" % chapter]\n"
       + "        for field in fields:\n"
       + "            full = FACT_BASE_ALIASES.get(field, field)\n"
       + "            value = _dig_nested(cfb, full)\n"
       + "            if field == \"\u786c\u6570\u503c\":\n"
       + "                value = _filter_hard_numbers(value)\n"
       + "            lines.append(\"- %s\uff1a%s\" % (field, _yaml_value_to_str(value)))\n"
       + "        parts.append(\"\\n\".join(lines))\n"
       + "    if not parts:\n"
       + "        raise RunError(\"digest_nothing_found\", \"no fact_base files in range\")\n"
       + "    return \"\\n\\n\".join(parts) + \"\\n\"\n\n\n"
       + "def _dig_nested(obj, dotted):\n"
       + "    cur = obj\n"
       + "    for key in dotted.split(\".\"):\n"
       + "        if isinstance(cur, dict) and key in cur:\n"
       + "            cur = cur[key]\n"
       + "        elif isinstance(cur, list) and key.isdigit() and int(key) < len(cur):\n"
       + "            cur = cur[int(key)]\n"
       + "        else:\n"
       + "            return None\n"
       + "    return cur\n\n\n"
       + "def _filter_hard_numbers(world_deltas):\n"
       + "    if not isinstance(world_deltas, list):\n"
       + "        return world_deltas\n"
       + "    return [{\"name\": i.get(\"name\"), \"hard_numbers\": i.get(\"hard_numbers\"),\n"
       + "             \"change_kind\": i.get(\"change_kind\"), \"evidence\": i.get(\"evidence\")}\n"
       + "            for i in world_deltas if isinstance(i, dict) and i.get(\"hard_numbers\") not in (None, \"\")]\n\n\n"
       + "def _yaml_value_to_str(value):\n"
       + "    if value is None:\n"
       + "        return \"\u672a\u63d0\u4f9b\"\n"
       + "    if isinstance(value, str):\n"
       + "        return value\n"
       + "    try:\n"
       + "        return _yaml.safe_dump(value, allow_unicode=True, default_flow_style=False).strip()\n"
       + "    except Exception:\n"
       + "        return str(value)\n\n\n"
       + "def parse_chapter_window(value: Optional[str]) -> Optional[Tuple[int, int]]:",
  },
  // ── 文件3 patch C：digest_command source branch ───────────────────────────
  {
    file: "skills/story-long-analyze/scripts/manage_analysis_run.py",
    sentinel: "--source fact_base: read from _fact_base/*.yaml instead of summaries/caches",
    old: "def digest_command(args: argparse.Namespace) -> Dict[str, Any]:\n"
       + "    root = require_root(args.root)\n"
       + "    window = parse_chapter_window(args.chapters)\n"
       + "    parts = []  # type: List[str]\n"
       + "    if args.part == \"observations\":",
    new: "def digest_command(args: argparse.Namespace) -> Dict[str, Any]:\n"
       + "    root = require_root(args.root)\n"
       + "    window = parse_chapter_window(args.chapters)\n"
       + "    # --source fact_base: read from _fact_base/*.yaml instead of summaries/caches\n"
       + "    if getattr(args, \"source\", None) == \"fact_base\":\n"
       + "        fields = [item.strip() for item in (args.fields or \"\").split(\",\") if item.strip()]\n"
       + "        if not fields:\n"
       + "            raise RunError(\"digest_empty_request\", \"pass --fields when using --source fact_base\")\n"
       + "        return {\"ok\": True, \"text\": digest_fact_base(root, window, fields)}\n"
       + "    parts = []  # type: List[str]\n"
       + "    if args.part == \"observations\":",
  },
  // ── 文件3 patch D：build_parser digest args ───────────────────────────────
  {
    file: "skills/story-long-analyze/scripts/manage_analysis_run.py",
    sentinel: "digest.add_argument(\"--source\"",
    old: "    digest = sub.add_parser(\"digest\", help=\"print Stage 3-5 reading material without whole-cache reads\")\n"
       + "    digest.add_argument(\"--root\", required=True, type=Path)\n"
       + "    digest.add_argument(\"--part\", required=True, choices=(\"observations\", \"chapters\"))\n"
       + "    digest.add_argument(\"--chapters\", help=\"chapter window such as 1-40\")\n"
       + "    digest.add_argument(\"--fields\", help=\"comma-separated summary fields, e.g. \u4e09\u7ef4\u8282\u594f,\u6d89\u53ca,\u72b6\u6001\u53d8\u5316\")\n"
       + "    digest.add_argument(\"--points\", choices=(\"none\", \"brief\", \"full\"), default=\"none\")\n"
       + "    digest.set_defaults(handler=digest_command)",
    new: "    digest = sub.add_parser(\"digest\", help=\"print Stage 3-5 reading material without whole-cache reads\")\n"
       + "    digest.add_argument(\"--root\", required=True, type=Path)\n"
       + "    digest.add_argument(\"--source\", choices=(\"cache\", \"fact_base\"), default=\"cache\",\n"
       + "                        help=\"cache (default) reads summaries/caches; fact_base reads _fact_base/*.yaml\")\n"
       + "    digest.add_argument(\"--part\", choices=(\"observations\", \"chapters\"),\n"
       + "                        help=\"required when --source=cache; ignored when --source=fact_base\")\n"
       + "    digest.add_argument(\"--chapters\", help=\"chapter window such as 1-40\")\n"
       + "    digest.add_argument(\"--fields\", help=\"comma-separated field names; cache uses summary labels, \"\n"
       + "                                         \"fact_base uses YAML keys or shorthand aliases\")\n"
       + "    digest.add_argument(\"--points\", choices=(\"none\", \"brief\", \"full\"), default=\"none\")\n"
       + "    digest.set_defaults(handler=digest_command)",
  },
]

// ─── 执行引擎 ─────────────────────────────────────────────────────────────────

let allPresent = true
let anyApplied = false

for (const patch of PATCHES) {
  const absPath = path.join(ROOT, patch.file)
  let content
  try { content = fs.readFileSync(absPath, "utf8") }
  catch (e) { console.error(`❌ 读取失败：${patch.file}\n   ${e.message}`); process.exit(2) }

  const already = content.includes(patch.sentinel)

  if (CHECK) {
    const label = patch.file.split("/").pop()
    const hint  = patch.sentinel.slice(0, 40)
    console.log(already ? `✅ 已包含  ${label}  (${hint}…)` : `⚠️  缺失    ${label}  (${hint}…)`)
    if (!already) allPresent = false
    continue
  }

  if (already) {
    console.log(`⏭  已跳过  ${patch.file.split("/").pop()}  (${patch.sentinel.slice(0, 40)}…)`)
    continue
  }

  if (!content.includes(patch.old)) {
    console.error(
      `❌ 锚点未找到：${patch.file}\n` +
      `   期望锚点前60字：${JSON.stringify(patch.old.slice(0, 60))}\n` +
      `   上游可能已改动此处，请手动查看 docs/fact-base-layer-patch.md 第八节。`
    )
    process.exit(1)
  }

  const patched = content.replace(patch.old, patch.new)
  if (DRY_RUN) {
    console.log(`🔍 dry-run  ${patch.file.split("/").pop()}  (${patch.sentinel.slice(0, 40)}…)`)
  } else {
    fs.writeFileSync(absPath, patched, "utf8")
    console.log(`✅ 已打入   ${patch.file.split("/").pop()}  (${patch.sentinel.slice(0, 40)}…)`)
    anyApplied = true
  }
}

if (CHECK) process.exit(allPresent ? 0 : 1)

if (!DRY_RUN && anyApplied) {
  console.log("\n全部 patch 已应用。")
  console.log("下一步：git add 三个文件，然后继续 rebase 或直接提交。")
}
