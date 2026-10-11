/**
 * GLB 二进制的最小读写工具 —— 给「要在 Node 里用 three 的 GLTFLoader 解析 GLB」
 * 的脚本共用（`verify-models` / `emit-regions`）。
 *
 * 为什么需要它：
 *   ⚠️ **自带内嵌贴图的 GLB 在 Node 里会被 GLTFLoader 直接解析失败**：
 *   GLTFLoader 是给浏览器写的，读到内嵌图片那一步会碰全局 `self`
 *   （`const URL = self.URL || self.webkitURL`，见 GLTFLoader.js 的 `loadImageSource`），
 *   Node 里没有 `self`，于是抛 `ReferenceError: self is not defined` ——
 *   **看起来像「模型损坏」，其实是环境问题**（同一份文件在网页里加载得好好的）。
 *
 *   而这些脚本要看的东西（零件名 / UV / 部位匹配）跟贴图一点关系都没有，
 *   所以把 `images` / `textures` / `samplers` 以及**所有以 `Texture` 结尾的键**
 *   （`baseColorTexture`、`normalTexture`、`KHR_materials_clearcoat.clearcoatTexture`……）
 *   一起摘掉，重新拼一个「只有几何」的 GLB 再交给 GLTFLoader。
 *   用「键名以 `Texture` 结尾」这个**通用规则**而不是逐个枚举，
 *   是因为扩展里也可能挂贴图引用，枚举必漏。
 */

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

/** 拆出 GLB 的 JSON 块和 BIN 块；不是合法 GLB 就返回 null */
export function readGlbJson(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) return null
  const jsonLength = buffer.readUInt32LE(12)
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
  let offset = 20 + jsonLength
  let bin = Buffer.alloc(0)
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    if (type === CHUNK_BIN) bin = buffer.subarray(offset + 8, offset + 8 + length)
    offset += 8 + length
  }
  return { json, bin }
}

/** 把 JSON + BIN 拼回一个标准 GLB（两个块都按 4 字节对齐） */
export function writeGlb(json, bin) {
  const pad4 = (n) => (4 - (n % 4)) % 4
  const jsonRaw = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc(pad4(jsonRaw.length), 0x20)])
  const binChunk = Buffer.concat([bin, Buffer.alloc(pad4(bin.length))])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(GLB_MAGIC, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.length, 0)
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binChunk.length, 0)
  binHeader.writeUInt32LE(CHUNK_BIN, 4)
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk])
}

/** 返回一份「只有几何」的 GLB（Buffer）。解析不了就返回 null，让上层原样去解析、由它报错 */
export function geometryOnlyGlb(buffer) {
  try {
    const parsed = readGlbJson(buffer)
    if (!parsed) return null
    const drop = (node) => {
      if (!node || typeof node !== 'object') return
      for (const key of Object.keys(node)) {
        if (key === 'images' || key === 'textures' || key === 'samplers' || /Texture$/.test(key)) {
          delete node[key]
          continue
        }
        drop(node[key])
      }
    }
    drop(parsed.json)
    return writeGlb(parsed.json, parsed.bin)
  } catch {
    return null
  }
}
