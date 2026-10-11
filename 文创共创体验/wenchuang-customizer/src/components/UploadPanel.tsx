import { useRef, useState } from 'react'
import { surfaceLabel, useTextureStudio } from '../state/textureStudio'
import { RegionPicker } from './RegionPicker'

/**
 * 上传本地图片贴图。
 * 用 URL.createObjectURL(file) 拿本地 URL，之后走和 AI 生图完全相同的一套「点击选面贴图」流程。
 */
export function UploadPanel() {
  // 错误提示统一在 AiPanel 卡片里展示（同一个共享 error 槽位，避免两处重复弹出）
  const { arm, cancel, status, pending, setError, setNotice, painted } = useTextureStudio()
  const inputRef = useRef<HTMLInputElement>(null)
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const waitingForPick = status === 'awaiting-pick' && pending?.source === 'upload'

  const handleFile = (file: File | null | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件（png / jpg / webp）')
      return
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setLocalUrl(url)
    arm(url, 'upload', file.name)
    setNotice(`已载入 ${file.name}，请在商品上点一下要贴的面`)
  }

  return (
    <section className="studio-card">
      <div className="studio-card-head">
        <h3>② 上传图片</h3>
        <span className="studio-card-tag">本地文件</span>
      </div>

      <label
        className="studio-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          handleFile(event.dataTransfer.files?.[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={(event) => {
            handleFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <span>点击选择图片，或把图片拖进来</span>
      </label>

      {localUrl && (
        <div className="studio-preview">
          <img src={localUrl} alt="待贴的本地图片" />
          {painted?.source === 'upload' && status === 'applied' && (
            <span className="studio-preview-badge">已贴到 {surfaceLabel(painted)}</span>
          )}
        </div>
      )}

      {waitingForPick && (
        <div className="studio-hint">
          <span className="studio-hint-dot" />
          <span>请点击商品要贴图的面</span>
          <button type="button" className="studio-hint-cancel" onClick={cancel}>
            取消
          </button>
        </div>
      )}

      <RegionPicker source="upload" />
    </section>
  )
}
