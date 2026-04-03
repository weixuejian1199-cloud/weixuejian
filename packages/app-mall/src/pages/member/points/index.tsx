import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import './index.scss'

type TabType = 'all' | 'income' | 'expense'

interface PointRecord {
  id: number
  title: string
  desc: string
  points: number
  date: string
  time: string
}

const MOCK_RECORDS: PointRecord[] = [
  { id: 1, title: '每日签到', desc: '连续签到第4天', points: 30, date: '2026-03-31', time: '08:32' },
  { id: 2, title: '分享好物', desc: '分享商品给好友', points: 20, date: '2026-03-31', time: '10:15' },
  { id: 3, title: '积分抵现', desc: '订单 #20260330012', points: -200, date: '2026-03-30', time: '21:08' },
  { id: 4, title: '每日签到', desc: '连续签到第3天', points: 20, date: '2026-03-30', time: '09:12' },
  { id: 5, title: '商品评价', desc: '评价商品获得积分', points: 15, date: '2026-03-30', time: '14:30' },
  { id: 6, title: '积分换购', desc: '兑换优惠券', points: -500, date: '2026-03-29', time: '16:45' },
  { id: 7, title: '每日签到', desc: '连续签到第2天', points: 15, date: '2026-03-29', time: '07:55' },
  { id: 8, title: '浏览任务', desc: '浏览3个商品', points: 10, date: '2026-03-29', time: '11:20' },
]

const TABS: { key: TabType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'income', label: '收入' },
  { key: 'expense', label: '支出' },
]

function groupByDate(records: PointRecord[]) {
  const map = new Map<string, PointRecord[]>()
  records.forEach((r) => {
    const group = map.get(r.date) || []
    group.push(r)
    map.set(r.date, group)
  })
  return Array.from(map.entries())
}

function formatDate(dateStr: string) {
  const today = '2026-03-31'
  const yesterday = '2026-03-30'
  if (dateStr === today) return '今天'
  if (dateStr === yesterday) return '昨天'
  return dateStr.slice(5).replace('-', '月') + '日'
}

export default function PointsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('all')

  const filtered = MOCK_RECORDS.filter((r) => {
    if (activeTab === 'income') return r.points > 0
    if (activeTab === 'expense') return r.points < 0
    return true
  })

  const grouped = groupByDate(filtered)

  return (
    <View className='points'>
      {/* Points Summary */}
      <View className='points__summary'>
        <Text className='points__summary-label'>当前积分</Text>
        <Text className='points__summary-value'>2,680</Text>
        <Text className='points__summary-expire'>120积分将于4月30日过期</Text>
      </View>

      {/* Tabs */}
      <View className='points__tabs'>
        {TABS.map((tab) => (
          <View
            key={tab.key}
            className={`points__tab ${activeTab === tab.key ? 'points__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <Text className='points__tab-text'>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* Records */}
      <View className='points__list'>
        {grouped.map(([date, records]) => (
          <View key={date} className='points__group'>
            <Text className='points__group-date'>{formatDate(date)}</Text>
            {records.map((record) => (
              <View key={record.id} className='points__record'>
                <View className='points__record-left'>
                  <Text className='points__record-title'>{record.title}</Text>
                  <Text className='points__record-desc'>{record.desc}</Text>
                </View>
                <View className='points__record-right'>
                  <Text
                    className={`points__record-amount ${
                      record.points > 0
                        ? 'points__record-amount--income'
                        : 'points__record-amount--expense'
                    }`}
                  >
                    {record.points > 0 ? '+' : ''}{record.points}
                  </Text>
                  <Text className='points__record-time'>{record.time}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}
