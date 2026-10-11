/**
 * 改造提示词生成器
 *
 * 干什么：用户选定一张图，但它跟目标器物不太合 —— 与其硬贴一张会被拉花 / 糊成一团的图，
 *        不如把「该怎么重画」写成一段中文提示词，用户拿去 AI 生图重新出一张。
 *
 * 拼装结构（需求文档定的）：[改造指令] + [目标模型特征] + [原图特征]
 *   · 改造指令：按图片与目标模型的差距，从模板库里挑对应项，可多选拼接；
 *   · 目标模型特征：按 decorationNorm 附加一句风格描述；
 *   · 原图特征：语义分析可用时用自然语言，不可用时退回规则特征（横幅构图、密度 0.62、8 色）。
 *
 * 一条都没命中时输出通用模板并标注「通用建议」，绝不返回空串。
 *
 * ⚠️ 模板文案全部集中在 PROMPT_TEMPLATES，改措辞只改这里。
 */

import type { ImageFeatures, ModelScore } from './modelCompat'

export const PROMPT_TEMPLATES = {
  /** 六条改造指令 —— 与需求文档的表格一一对应 */
  commands: {
    ratio: (orientation: '竖幅' | '横幅', ratio: string) =>
      `将画面主体重组为${orientation}构图，宽高比调整为 ${ratio}:1`,
    radial: () => '改为以画面中心为焦点的放射状构图',
    seam: () => '将图案扩展为无缝平铺纹样，横向首尾连续衔接',
    density: () => '提取画面主色，简化为大面积纯色底 + 单一简洁纹样',
    color: (max: number) => `减少色彩数量至 ${max} 色以内，保持主色调不变`,
    blank: (top: string, bottom: string) =>
      `画面上下分别留出约 ${top} / ${bottom} 的纯色过渡区域，主体置于中段`,
  },

  /** 目标模型风格段 —— 按 decorationNorm 三档 */
  norm: {
    minimal: (name: string) => `极简风格陶瓷装饰，大面积留白，适合素雅器物（目标：${name}）`,
    moderate: (name: string) => `主体图案 + 留白过渡的中式器物装饰（目标：${name}）`,
    rich: (name: string) => `满版丰富图案、色彩饱满的装饰（目标：${name}）`,
  } as Record<string, (name: string) => string>,

  /** 原图特征段 */
  originalSemantic: (styleDesc: string) => `原图为：${styleDesc}`,
  originalRules: (orientation: string, density: string, colors: string) =>
    `原图为：${orientation}构图、密度 ${density}、${colors} 色`,
  /** 语义不可用时的说明尾巴 —— 让用户知道这几个数是本地像素统计出来的，不是看懂图了 */
  originalRulesNote: '（语义分析未启用，以上为本地像素统计）',

  /** 通用兜底 */
  generic: (name: string, note: string) => `将图片调整为适合「${name}」贴图的构图，注意${note}。`,
  genericTag: '通用建议',
  genericNoteBlank: (top: string, bottom: string) => `上下留白（约 ${top} / ${bottom}）`,
  genericNoteSeam: '边缘左右连续',
  genericNoteSeamless: '图案首尾可无缝衔接',
}

/** 一段生成好的提示词 */
export interface PromptResult {
  /** 可直接复制 / 粘贴进 AI 生图输入框的完整文本 */
  text: string
  /** 命中的改造指令条数（0 = 走了通用模板） */
  commandCount: number
  /** 是否走了通用模板 */
  generic: boolean
  /** 目标器物名 */
  targetName: string
  /** 命中的差距标签，UI 用来做小徽章（如「密度超标」「边缘不连续」） */
  tags: string[]
}

const num2 = (value: number) => value.toFixed(2)
const num1 = (value: number) => (Math.round(value * 10) / 10).toFixed(1)

/**
 * 按差距挑改造指令（可多选，顺序 = 从构图到细节，拼起来读着顺）。
 * 直接吃一整条评分结果 —— gaps 和 safeZone 都在里面，不用在外面拼。
 */
function pickCommands(score: ModelScore, features: ImageFeatures): { lines: string[]; tags: string[] } {
  const lines: string[] = []
  const tags: string[] = []
  const { gaps } = score

  if (gaps.ratio.mismatch) {
    // 图片比目标更宽 → 要竖向收拢（竖幅）；更窄 → 横向展开（横幅）
    const orientation = features.aspectRatio > gaps.ratio.targetRatio ? '竖幅' : '横幅'
    lines.push(PROMPT_TEMPLATES.commands.ratio(orientation, num1(gaps.ratio.targetRatio)))
    tags.push('宽高比不符')
  }
  if (gaps.radialRecompose) {
    lines.push(PROMPT_TEMPLATES.commands.radial())
    tags.push('构图不适合团扇')
  }
  if (gaps.seam.needed) {
    lines.push(PROMPT_TEMPLATES.commands.seam())
    tags.push('边缘不连续')
  }
  if (gaps.density.over) {
    lines.push(PROMPT_TEMPLATES.commands.density())
    tags.push('密度超标')
  }
  if (gaps.color.over) {
    lines.push(PROMPT_TEMPLATES.commands.color(gaps.color.max))
    tags.push('色数超标')
  }
  if (gaps.blank.short) {
    lines.push(PROMPT_TEMPLATES.commands.blank(num2(score.safeZone.top), num2(score.safeZone.bottom)))
    tags.push('留白不足')
  }

  return { lines, tags }
}

/** 模型特征段 —— 按 decorationNorm 三档，拿不到就退回 moderate */
function normSentence(score: ModelScore): string {
  const build = PROMPT_TEMPLATES.norm[score.decorationNorm] ?? PROMPT_TEMPLATES.norm.moderate
  return build(score.presetName)
}

/** 原图特征段 —— 语义可用时用自然语言，否则用规则特征 */
function originalSentence(features: ImageFeatures): string {
  if (features.styleDesc) return PROMPT_TEMPLATES.originalSemantic(features.styleDesc)
  const orientation = features.aspectRatio >= 1.2 ? '横幅' : features.aspectRatio <= 0.85 ? '竖幅' : '方幅'
  return (
    PROMPT_TEMPLATES.originalRules(orientation, num2(features.patternDensity), String(features.colorCount)) +
    PROMPT_TEMPLATES.originalRulesNote
  )
}

/** 句子收尾：模板里没带句号的统一补上，避免拼出来「。。」或连成一坨 */
const endSentence = (text: string) => (/[。！？.]$/.test(text) ? text : `${text}。`)

/**
 * 生成改造提示词。
 * 参数就是推荐面板里那一条评分结果 —— 它已经带齐 gaps 与 decorationNorm。
 */
export function generatePrompt(score: ModelScore, features: ImageFeatures): PromptResult {
  const { lines, tags } = pickCommands(score, features)
  const generic = lines.length === 0
  const parts: string[] = []

  if (generic) {
    const need = score.safeZone.top + score.safeZone.bottom
    const note =
      score.uvType === 'cylinder'
        ? PROMPT_TEMPLATES.genericNoteSeamless
        : need > 0.1
          ? PROMPT_TEMPLATES.genericNoteBlank(num2(score.safeZone.top), num2(score.safeZone.bottom))
          : PROMPT_TEMPLATES.genericNoteSeam
    parts.push(PROMPT_TEMPLATES.generic(score.presetName, note))
  } else {
    parts.push(...lines.map(endSentence))
  }

  parts.push(endSentence(normSentence(score)))
  parts.push(endSentence(originalSentence(features)))

  return {
    text: parts.join(''),
    commandCount: lines.length,
    generic,
    targetName: score.presetName,
    tags,
  }
}

/** 给 UI 用的「这段提示词是怎么拼出来的」一行摘要 */
export function promptSummary(result: PromptResult): string {
  if (result.generic) {
    return `${PROMPT_TEMPLATES.genericTag} · 没有命中具体差距，按「${result.targetName}」的通用要求写`
  }
  return `命中 ${result.commandCount} 条改造指令 · 目标「${result.targetName}」`
}

/** 提示词上方那句「为什么要改」 */
export function promptIntro(score: ModelScore, result: PromptResult): string {
  if (result.generic) {
    return `这张图贴到「${score.presetName}」问题不大（适配度 ${score.score}），以下是通用建议。`
  }
  return `这张图贴到「${score.presetName}」适配度只有 ${score.score}，主要卡在：${score.topReason}`
}

// ---------------------------------------------------------------- 开发期调试钩子
/**
 * 同 `modelCompat.ts` 末尾那套：只在 dev 下挂，生产构建会被摇掉。
 * 端到端脚本用它直接验「某张图 + 某个模型」拼出来的提示词，不用真去点一遍 UI。
 */
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__prompt = {
    PROMPT_TEMPLATES,
    generatePrompt,
    promptSummary,
    promptIntro,
  }
}
