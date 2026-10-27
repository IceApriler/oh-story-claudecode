#!/usr/bin/env bash
# update-and-deploy.sh
#
# 用法：
#   cd /path/to/oh-story-claudecode
#   bash scripts/update-and-deploy.sh [WORKSPACE_PATH]
#
#   WORKSPACE_PATH  写作工作区路径，默认读环境变量 OH_STORY_WORKSPACE，
#                   再没有则报错提示。
#
# 做的事：
#   1. git fetch origin
#   2. git rebase origin/main（无冲突时全自动；有冲突时自动打 patch 后继续）
#   3. 验证 patch 是否在位（--check）
#   4. 提示在工作区跑 /story-setup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 确定写作工作区路径 ───────────────────────────────────────────────────────
WORKSPACE="${1:-${OH_STORY_WORKSPACE:-}}"
if [[ -z "$WORKSPACE" ]]; then
  echo "❌ 请传入写作工作区路径，或设置环境变量 OH_STORY_WORKSPACE"
  echo "   例：bash scripts/update-and-deploy.sh ~/Myfile/www/github2026/oh-story-workspace"
  exit 1
fi
WORKSPACE="$(cd "$WORKSPACE" && pwd)"

echo "📦 源项目：$REPO_DIR"
echo "📝 工作区：$WORKSPACE"
echo ""

cd "$REPO_DIR"

# ── 确认在 feat/fact-base 分支 ──────────────────────────────────────────────
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "feat/fact-base" ]]; then
  echo "⚠️  当前分支是 $BRANCH，切换到 feat/fact-base …"
  git checkout feat/fact-base
fi

# ── Step 1：fetch ────────────────────────────────────────────────────────────
echo "🔄 正在拉取上游更新 …"
git fetch origin

# 检查是否有新提交
UPSTREAM_NEW=$(git rev-list HEAD..origin/main --count)
if [[ "$UPSTREAM_NEW" == "0" ]]; then
  echo "✅ 上游无新提交，跳过 rebase。"
else
  echo "   上游有 $UPSTREAM_NEW 个新提交，开始 rebase …"

  # ── Step 2：rebase ──────────────────────────────────────────────────────────
  if git rebase origin/main; then
    echo "✅ rebase 成功（无冲突）"
  else
    echo ""
    echo "⚠️  rebase 遇到冲突，尝试自动打 patch 后继续 …"

    # 对有冲突的三个文件：先用上游版本，再打 patch
    PATCH_FILES=(
      "skills/story-setup/references/templates/hooks/story_hook_cli.js"
      "skills/story-setup/references/templates/agents/chapter-extractor.md"
      "skills/story-long-analyze/scripts/manage_analysis_run.py"
    )

    for f in "${PATCH_FILES[@]}"; do
      if git status --short | grep -q "^UU $f\|^AA $f\|^DD $f\|^.U $f\|^U. $f"; then
        echo "   冲突文件：$f，取上游版本后重新打 patch …"
        git checkout origin/main -- "$f"
      fi
    done

    echo "   运行 apply-fact-base-patch.js …"
    if node "$SCRIPT_DIR/apply-fact-base-patch.js"; then
      git add "${PATCH_FILES[@]}"
      if git rebase --continue; then
        echo "✅ rebase 完成（自动解决冲突）"
      else
        echo "❌ rebase --continue 失败，可能还有其他冲突文件需要手动处理。"
        echo "   解决后手动运行：git rebase --continue"
        exit 1
      fi
    else
      echo "❌ patch 脚本报告锚点未找到（上游改动了关键结构）。"
      echo "   请参考 docs/fact-base-layer-patch.md 第八节手动合并，然后："
      echo "   git add <修改的文件> && git rebase --continue"
      exit 1
    fi
  fi
fi

# ── Step 3：验证 patch 在位 ──────────────────────────────────────────────────
echo ""
echo "🔍 验证 fact-base patch 完整性 …"
if node "$SCRIPT_DIR/apply-fact-base-patch.js" --check; then
  echo "✅ 所有 patch 均已在位。"
else
  echo "⚠️  部分 patch 缺失，重新打入 …"
  node "$SCRIPT_DIR/apply-fact-base-patch.js"
  PATCH_FILES=(
    "skills/story-setup/references/templates/hooks/story_hook_cli.js"
    "skills/story-setup/references/templates/agents/chapter-extractor.md"
    "skills/story-long-analyze/scripts/manage_analysis_run.py"
  )
  git add "${PATCH_FILES[@]}"
  git commit -m "chore: re-apply fact-base patch after upstream rebase

Co-Authored-By: Claude <noreply@anthropic.com>"
  echo "✅ patch 重新打入并提交。"
fi

# ── Step 4：提示工作区部署 ───────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════"
echo "✅ oh-story-claudecode 已更新到最新（feat/fact-base）"
echo ""
echo "下一步：在写作工作区重新部署 skill"
echo ""
echo "  cd \"$WORKSPACE\""
echo "  # 在 Claude Code 会话中运行："
echo "  /story-setup"
echo ""
echo "════════════════════════════════════════════════"
