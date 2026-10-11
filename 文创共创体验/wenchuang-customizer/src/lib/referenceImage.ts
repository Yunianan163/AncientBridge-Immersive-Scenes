/**
 * 把用户选的本地图片压成可以当参考图发给方舟的 data URL。
 *
 * 为什么要压：手机 / 相机原图动辄 4000px、十几 MB，转成 Base64 后请求体还要再涨三分之一，
 * 既可能超出方舟对输入图的体积限制，上传本身也会明显变慢。
 * 方舟按 2K / 4K 出图，参考图长边给到 2048 已经足够表达构图与风格。
 */

/** 长边上限（像素） */
const MAX_SIDE = 2048
/** data URL 超过这个长度就改用 JPEG —— 避免把几十 MB 的 Base64 塞进请求体 */
const PNG_BUDGET = 6_000_000

export interface ReferenceImage {
  /** 可直接塞进 `/api/redraw` 的 `image` 字段 */
  dataUrl: string
  /** 原始文件名，仅用于界面展示 */
  name: string
  /** 压缩后的尺寸，给用户一个「确实处理过了」的反馈 */
  width: number
  height: number
}

export async function fileToReferenceImage(file: File): Promise<ReferenceImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件（png / jpg / webp）')
  }

  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持 canvas，无法处理图片')

    // 铺白底：参考图不需要透明通道，而 JPEG 没有 alpha —— 不铺底，透明区会变成黑色
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    // 先试 PNG（保真）；超预算再退 JPEG
    let dataUrl = canvas.toDataURL('image/png')
    if (dataUrl.length > PNG_BUDGET) dataUrl = canvas.toDataURL('image/jpeg', 0.9)

    return { dataUrl, name: file.name, width, height }
  } finally {
    bitmap.close?.()
  }
}
