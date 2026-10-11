import { useState } from 'react'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { PRODUCT_ROOT_NAME, stripUiTint } from '../three/surfacePainter'
import { apiUrl } from '../lib/api'
import { useTextureStudio } from '../state/textureStudio'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

/**
 * 导出与下单。
 * - GLB：把当前含贴图的商品节点用 GLTFExporter 导成二进制 GLB
 * - 截图：renderer.domElement.toDataURL('image/png')
 * - 下单：把 GLB + 截图 + 用户信息 POST 到 /api/order，落到后端 ./orders/<orderId>/
 */
export function ExportPanel() {
  const { three, product, painted, uv, setError, setNotice } = useTextureStudio()
  const [busy, setBusy] = useState<'glb' | 'shot' | 'order' | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [user, setUser] = useState({ name: '', phone: '', address: '', remark: '' })

  /** 拿到当前含贴图的商品节点（整场景导出会把灯光/环境也带进去，所以只导商品） */
  const getProductRoot = () => {
    const scene = three.current.scene
    if (!scene) throw new Error('3D 场景还没准备好')
    return scene.getObjectByName(PRODUCT_ROOT_NAME) ?? scene
  }

  const buildGlb = async () => {
    const root = getProductRoot()
    root.updateMatrixWorld(true)
    // 底座会把「悬停加亮 ×1.2」和「选中高亮（偏黄 + 橙色自发光）」直接写进
    // material.color / material.emissive。那是屏幕上的显示状态，不该出现在商品文件里：
    // 否则导出的 baseColorFactor 会整体偏亮、emissiveFactor 会带一层橙光。
    // 所以导出前洗掉、导完还原（用户看到的画面不受影响）。
    const restoreUiTint = stripUiTint(root)
    const exporter = new GLTFExporter()
    try {
      return await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          root,
          (result) => resolve(result as ArrayBuffer),
          (err) => reject(err instanceof Error ? err : new Error('GLB 导出失败')),
          { binary: true },
        )
      })
    } finally {
      restoreUiTint()
    }
  }

  const captureScreenshot = () => {
    const gl = three.current.gl
    if (!gl) throw new Error('渲染器还没准备好')
    return gl.domElement.toDataURL('image/png')
  }

  const fileName = () => `${product?.id ?? 'wenchuang'}-${painted ? 'custom' : 'plain'}-${Date.now()}`

  const handleExportGlb = async () => {
    setBusy('glb')
    setError(null)
    try {
      const buffer = await buildGlb()
      downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), `${fileName()}.glb`)
      setNotice('GLB 已导出，可直接送 3D 打印或下单')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBusy(null)
    }
  }

  const handleScreenshot = () => {
    setBusy('shot')
    setError(null)
    try {
      const dataUrl = captureScreenshot()
      const base64 = dataUrl.split(',')[1] ?? ''
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      downloadBlob(new Blob([bytes], { type: 'image/png' }), `${fileName()}-预览.png`)
      setNotice('当前视角缩略图已导出')
    } catch (err) {
      setError(err instanceof Error ? err.message : '截图失败')
    } finally {
      setBusy(null)
    }
  }

  const handleOrder = async () => {
    if (!user.name.trim() || !user.phone.trim()) {
      setError('下单前请填写姓名和手机号')
      return
    }
    setBusy('order')
    setError(null)
    try {
      const glbBuffer = await buildGlb()
      const screenshot = captureScreenshot()
      const response = await fetch(apiUrl('/api/order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: product ? { id: product.id, name: product.name, path: product.path } : null,
          texture: painted
            ? {
                source: painted.source,
                prompt: painted.prompt ?? null,
                imageUrl: painted.imageUrl,
                targetMesh: painted.meshName,
                uv,
              }
            : null,
          user,
          screenshot,
          glb: { filename: `${fileName()}.glb`, base64: arrayBufferToBase64(glbBuffer) },
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.error) throw new Error(data?.error || `提交失败（HTTP ${response.status}）`)
      setOrderId(String(data.orderId))
      setNotice(`订单已提交：${data.orderId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="studio-card">
      <div className="studio-card-head">
        <h3>⑤ 导出与下单</h3>
        <span className="studio-card-tag">{product?.name ?? '未选择商品'}</span>
      </div>

      <div className="studio-row">
        <button type="button" className="studio-ghost" onClick={handleExportGlb} disabled={busy !== null}>
          {busy === 'glb' ? '导出中…' : '下载 GLB'}
        </button>
        <button type="button" className="studio-ghost" onClick={handleScreenshot} disabled={busy !== null}>
          {busy === 'shot' ? '截图中…' : '下载截图'}
        </button>
      </div>

      <div className="studio-form">
        <input
          type="text"
          placeholder="收货人姓名 *"
          value={user.name}
          onChange={(event) => setUser((prev) => ({ ...prev, name: event.target.value }))}
        />
        <input
          type="tel"
          placeholder="手机号 *"
          value={user.phone}
          onChange={(event) => setUser((prev) => ({ ...prev, phone: event.target.value }))}
        />
        <input
          type="text"
          placeholder="收货地址"
          value={user.address}
          onChange={(event) => setUser((prev) => ({ ...prev, address: event.target.value }))}
        />
        <textarea
          rows={2}
          placeholder="备注（数量、材质、定制要求等）"
          value={user.remark}
          onChange={(event) => setUser((prev) => ({ ...prev, remark: event.target.value }))}
        />
      </div>

      <button type="button" className="studio-primary" onClick={handleOrder} disabled={busy !== null}>
        {busy === 'order' ? '提交中…' : '提交定制订单'}
      </button>

      {orderId && (
        <div className="studio-success">
          订单号 <strong>{orderId}</strong>，模型与截图已保存到后端 <code>orders/{orderId}/</code>
        </div>
      )}
    </section>
  )
}
