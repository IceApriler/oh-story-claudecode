#!/usr/bin/env bash
# update-workspace.sh
# 上游更新后，重新合入 fact-base patch 并部署到写作工作区。
#
# 用法：
#   bash scripts/update-workspace.sh [工作区路径]
#
#   工作区路径 可选，默认为脚本同级目录（oh-story-claudecode）
#   旁边的写作工作区，优先读 STORY_WORKSPACE 环境变量。
#
# 完整流程：
#   1. git fetch + rebase origin/main
#   2. 检查 patch 是否仍完整，缺失则重新 apply
#   3. 提示在写作工作区执行 /story-setup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 写作工作区路径 ────────────────────────────────────────────────────────────
WORKSPACE="${1:-${STORY_WORKSPACE:-}}"
if [[ -z "$WORKSPACE" ]]; then
  # 尝试自动发现：同一父目录下含 .story-deployed 的目录
  PARENT="$(dirname "$REPO_DIR")"
  FOUND=""
  for d in "$PARENT"/*/; do
    if [[ -f "$d/.story-deployed" ]]; then
      FOUND="$d"
      break
    fi
  done
  if [[ -n "$FOUND" ]]; then
    WORKSPACE="${FOUND%/}"
    echo "ℹ️  自动发现写作工作区：$WORKSPACE"
  else
    echo "⚠️  未找到写作工作区，跳过部署提示。"
    echo "    可手动指定：bash scripts/update-workspace.sh /path/to/workspace"
    echo "    或设置环境变量：export STORY_WORKSPACE=/path/to/workspace"
  fi
fi

cd "$REPO_DIR"

# ── Step 1：拉取上游更新并 rebase ─────────────────────────────────────────────
echo ""
echo "── Step 1：git fetch + rebase ──────────────────────────────────────────"
git fetch origin

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "feat/fact-base" ]]; then
  echo "⚠️  当前分支是 $BRANCH，不是 feat/fact-base。"
  echo "    请先切换：git checkout feat/fact-base"
  exit 1
fi

BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
if [[ "$BEHIND" -eq 0 ]]; then
  echo "✅ 已是最新，无需 rebase。"
else
  echo "📥 上游有 $BEHIND 个新提交，执行 rebase..."
  if ! git rebase origin/main; then
    echo ""
    echo "❌ rebase 冲突，自动尝试重新打 patch..."
    # 对冲突的三个文件用上游版本覆盖，再重新 apply patch
    git checkout origin/main -- \
      skills/story-setup/references/templates/hooks/story_hook_cli.js \
      skills/story-setup/references/templates/agents/chapter-extractor.md \
      skills/story-long-analyze/scripts/manage_analysis_run.py 2>/dev/null || true

    node "$SCRIPT_DIR/apply-fact-base-patch.js"

    git add \
      skills/story-setup/references/templates/hooks/story_hook_cli.js \
      skills/story-setup/references/templates/agents/chapter-extractor.md \
      skills/story-long-analyze/scripts/manage_analysis_run.py

    git rebase --continue
    echo "✅ rebase 完成（patch 已重新合入）。"
  else
    echo "✅ rebase 成功。"
  fi
fi

# ── Step 2：确认 patch 完整 ────────────────────────────────────────────────────
echo ""
echo "── Step 2：验证 patch 完整性 ───────────────────────────────────────────"
if node "$SCRIPT_DIR/apply-fact-base-patch.js" --check; then
  echo "✅ 所有改动已包含。"
else
  echo "⚠️  部分改动缺失，重新 apply..."
  node "$SCRIPT_DIR/apply-fact-base-patch.js"
  git add \
    skills/story-setup/references/templates/hooks/story_hook_cli.js \
    skills/story-setup/references/templates/agents/chapter-extractor.md \
    skills/story-long-analyze/scripts/manage_analysis_run.py
  git commit -m "feat: re-apply fact-base patch after upstream merge"
  echo "✅ patch 已补入并提交。"
fi

# ── Step 3：部署到写作工作区 ──────────────────────────────────────────────────
echo ""
echo "── Step 3：部署到写作工作区 ────────────────────────────────────────────"
if [[ -n "$WORKSPACE" && -d "$WORKSPACE" ]]; then
  echo "📦 写作工作区：$WORKSPACE"
  echo ""
  echo "现在请在写作工作区执行 /story-setup 完成部署。"
  echo ""
  echo "快速操作（在新终端里执行）："
  echo "  cd \"$WORKSPACE\" && claude"
  echo "  # 然后在 Claude Code 里输入：/story-setup"
else
  echo "（写作工作区未指定，跳过）"
fi

echo ""
echo "✅ 全部完成。"
