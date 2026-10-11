import { useEffect, useState } from 'react'
import { PRODUCT_ROOT_NAME } from '../three/surfacePainter'
import { inspectRegions, isPaintable } from '../three/regions'
import type { RegionReport } from '../three/regions'
import { useTextureStudio } from '../state/textureStudio'
import type { TextureSource } from '../state/textureStudio'

/**
 * 「可贴图部位」选择条。
 *
 * 两个作用：
 *   1) 不用在 3D 模型上费劲找准零件，直接点部位名就能贴；
 *   2) 把模型里的实际零件名和配置表对照出来——名字对不上时立刻能看见，
 *      这同时也是「该给配置表填什么名字」的最快信息来源。
 *
 * 出现时机有两个：
 *   - 刚备好一张图（awaiting-pick）：点部位名就能贴；
 *   - 已经贴过一处（applied）：还能用同一张图接着贴别的部位，
 *     所以这条不会在贴完后消失。
 */
interface RegionPickerProps {
  /** 只负责本来源（AI 生图 / 本地上传）的贴图流程，避免两个面板重复出现同一排按钮 */
  source: TextureSource
}

export function RegionPicker({ source }: RegionPickerProps) {
  const { product, three, status, pending, painted, paintRegion, busy } = useTextureStudio()
  const [report, setReport] = useState<RegionReport | null>(null)

  // 三种情况都能贴：
  //   正在等点击（图来自本面板）；已经贴过一处（已贴的也来自本面板）
  // applied 状态下 3D 上的点击不生效，避免用户转着看模型时被误贴；要贴就点部位名。
  const canPick =
    status === 'awaiting-pick'
      ? pending?.source === source
      : status === 'applied' && painted?.source === source

  useEffect(() => {
    if (!canPick) {
      setReport(null)
      return undefined
    }
    // 走到这一步时模型通常已经就位，这里留一点点余量再读场景
    const timer = window.setTimeout(() => {
      const root = three.current.scene?.getObjectByName(PRODUCT_ROOT_NAME)
      setReport(root ? inspectRegions(root, product?.regions) : null)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [canPick, product, three])

  if (!canPick) return null

  const regions = product?.regions ?? []
  if (regions.length === 0) {
    return <p className="studio-region-note">该商品的模型还没有按部位拆分，直接点商品表面即可贴图。</p>
  }

  const paintable = report ? report.matched.filter((hit) => isPaintable(hit.region)) : []
  const locked = report ? report.matched.filter((hit) => !isPaintable(hit.region)) : []

  return (
    <div className="studio-regions">
      <div className="studio-region-head">
        <span>可贴图部位</span>
        <span className="studio-region-tip">
          {status === 'awaiting-pick' ? '点名字直接贴，或在商品上点' : '用当前这张图继续贴到别的部位'}
        </span>
      </div>

      {report === null ? (
        <p className="studio-region-note">正在读取模型部位…</p>
      ) : (
        <>
          <div className="studio-region-chips">
            {paintable.map((hit) => (
              <button
                key={hit.region.id}
                type="button"
                className="studio-region-chip"
                disabled={busy}
                title={`模型里匹配到「${hit.key}」，共 ${hit.meshes.length} 个零件`}
                onClick={() => void paintRegion(hit.region.id)}
              >
                {hit.region.name}
              </button>
            ))}
            {locked.map((hit) => (
              <span key={hit.region.id} className="studio-region-chip is-locked" title="保留部位，不支持贴图">
                {hit.region.name}
              </span>
            ))}
          </div>

          {report.missing.length > 0 && (
            <p className="studio-region-warn">
              模型里没找到：
              {report.missing.map((region) => `${region.name}（要找 ${region.match.join(' / ')}）`).join('、')}
              。点这些位置会退化成「只贴所选表面」，改名字后重跑 `npm run models:verify` 可复核。
            </p>
          )}

          {report.unassignedParts.length > 0 && (
            <details className="studio-region-parts">
              <summary>模型里还有 {report.unassignedParts.length} 个零件没进命名表</summary>
              <code>{report.unassignedParts.join('\n')}</code>
            </details>
          )}
        </>
      )}
    </div>
  )
}
