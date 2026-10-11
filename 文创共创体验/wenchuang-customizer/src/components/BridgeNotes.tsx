import { useState } from 'react'

/**
 * 「桥志」—— 这个定制器讲的到底是哪两座桥。
 *
 * 内容都能和史料对上（朝代、年代、出资人、尺寸、题名、传说、文保级别），
 * 不写没有出处的细节。默认折起来，不抢定制流程的注意力。
 *
 * 风格上用**楷体标题 + 朱砂签条**，与工作台其它卡片一致。
 */

interface BridgeEntry {
  id: string
  place: string
  name: string
  era: string
  lines: string[]
}

const BRIDGES: BridgeEntry[] = [
  {
    id: 'shuangqiao',
    place: '苏州 · 昆山周庄',
    name: '双桥（钥匙桥）',
    era: '明萬曆',
    lines: [
      '世德桥为石拱桥，东西向横跨南北市河；永安桥为石梁桥，南北向平架于银子浜口。两桥东北堍纵横相接，一圆一方、一横一竖，桥洞交叠形似旧时钥匙，故俗称「钥匙桥」。',
      '始建于明万历年间（1573—1619）：世德桥由里人徐松泉、徐竹溪出资，永安桥由里人徐正吾出资。清乾隆三十年（1765）两桥俱重修，道光二十三年（1843）里人捐资重建。',
      '世德桥长 16 米、宽 3 米、跨径 5.9 米；永安桥长 13.3 米、宽 2.4 米、跨度 3.5 米。桥栏皆以麻条石垒砌。',
      '1984 年，旅美画家陈逸飞以双桥为蓝本创作油画《故乡的回忆》，周庄由此名扬海内。2006 年列为江苏省文物保护单位。',
    ],
  },
  {
    id: 'gejingqiao',
    place: '贵州 · 黔南福泉',
    name: '葛镜桥（豆腐桥）',
    era: '明萬曆',
    lines: [
      '横跨麻哈江（洒金谷段犀江），二墩三孔石拱桥，长 52.7 米、宽 8.5 米、高 23 米。桥在绝壁之上起拱，借江心一礁石下脚，是变截面圆弧尖拱的典型代表。',
      '平越（今福泉）人葛镜倾尽家资，前后三十余年、三毁三建，万历四十六年（1618）终于成桥，次年葛镜辞世。初名「太平桥」。',
      '云贵总督张鹤鸣改题今名并撰《葛镜桥碑记》；明神宗御赐「义垂千古」匾额。民间因「张三丰点豆腐为石」的传说，俗称「豆腐桥」。',
      '2006 年由国务院公布为第六批全国重点文物保护单位。茅以升誉之为「西南桥梁之冠」，留下「北有赵州桥，南有葛镜桥」之说。',
    ],
  },
]

export function BridgeNotes() {
  const [open, setOpen] = useState(false)

  return (
    <section className="studio-card bridge-notes">
      <div className="studio-card-head">
        <h3>桥志</h3>
        <button
          type="button"
          className="bridge-notes-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? '收起' : '展开'}
        </button>
      </div>

      <p className="bridge-notes-lead">本定制器的纹样与配色取自两座明代古桥：</p>

      <div className="bridge-notes-list">
        {BRIDGES.map((bridge) => (
          <div className="bridge-notes-item" key={bridge.id}>
            <div className="bridge-notes-title">
              <span className="bridge-notes-name">{bridge.name}</span>
              <span className="bridge-notes-era">{bridge.era}</span>
            </div>
            <div className="bridge-notes-place">{bridge.place}</div>
            {open && (
              <div className="bridge-notes-body">
                {bridge.lines.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
