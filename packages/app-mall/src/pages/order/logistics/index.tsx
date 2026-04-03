import { View, Text } from '@tarojs/components'
import './index.scss'

// ─── Mock Data ──────────────────────────────
const mockLogistics = {
  company: '顺丰速运',
  trackingNo: 'SF1234567890123',
  phone: '95338',
}

const mockTimeline = [
  { id: 1, status: '派送中', desc: '快递员（张师傅 138****1234）正在派送中，请保持电话畅通', time: '2026-03-31 14:30', active: true },
  { id: 2, status: '到达站点', desc: '快件已到达【上海浦东新区陆家嘴营业部】', time: '2026-03-31 09:15', active: false },
  { id: 3, status: '运输中', desc: '快件已从【上海转运中心】发出，下一站【上海浦东新区陆家嘴营业部】', time: '2026-03-31 06:20', active: false },
  { id: 4, status: '运输中', desc: '快件已到达【上海转运中心】', time: '2026-03-30 22:45', active: false },
  { id: 5, status: '已发货', desc: '快件已从【杭州转运中心】发出', time: '2026-03-30 18:30', active: false },
  { id: 6, status: '已揽收', desc: '顺丰速运已揽收，揽收网点：杭州余杭区营业部', time: '2026-03-30 16:00', active: false },
]

// ─── Logistics Page Component ───────────────
export default function Logistics() {

  // ─── Express Info ─────────────────────────
  const renderExpressInfo = () => (
    <View className='logistics__express'>
      <View className='express__row'>
        <Text className='express__label'>快递公司</Text>
        <Text className='express__value'>{mockLogistics.company}</Text>
      </View>
      <View className='express__row'>
        <Text className='express__label'>运单号码</Text>
        <View className='express__copy-row'>
          <Text className='express__value'>{mockLogistics.trackingNo}</Text>
          <View className='express__copy-btn'>
            <Text className='express__copy-text'>复制</Text>
          </View>
        </View>
      </View>
      <View className='express__row'>
        <Text className='express__label'>客服电话</Text>
        <Text className='express__value express__value--link'>{mockLogistics.phone}</Text>
      </View>
    </View>
  )

  // ─── Timeline ─────────────────────────────
  const renderTimeline = () => (
    <View className='logistics__timeline'>
      {mockTimeline.map((item, index) => (
        <View key={item.id} className={`timeline-node ${item.active ? 'timeline-node--active' : ''}`}>
          <View className='timeline-node__left'>
            <View className={`timeline-node__dot ${item.active ? 'timeline-node__dot--active' : ''}`}>
              {item.active && <View className='timeline-node__pulse' />}
            </View>
            {index < mockTimeline.length - 1 && (
              <View className={`timeline-node__line ${item.active ? 'timeline-node__line--active' : ''}`} />
            )}
          </View>
          <View className='timeline-node__content'>
            <Text className={`timeline-node__status ${item.active ? 'timeline-node__status--active' : ''}`}>{item.status}</Text>
            <Text className={`timeline-node__desc ${item.active ? 'timeline-node__desc--active' : ''}`}>{item.desc}</Text>
            <Text className='timeline-node__time'>{item.time}</Text>
          </View>
        </View>
      ))}
    </View>
  )

  return (
    <View className='logistics'>
      {renderExpressInfo()}
      {renderTimeline()}
    </View>
  )
}
