import { View, Text, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import './index.scss'

const TABS = ['全部', '直推', '间推', '提现']

const MOCK_SUMMARY = {
  withdrawable: 580,
  total: 1280,
  withdrawn: 480,
  frozen: 120,
}

interface EarningItem {
  id: string
  type: 'direct' | 'indirect' | 'withdraw'
  title: string
  desc: string
  amount: number
  date: string
}

const MOCK_EARNINGS: EarningItem[] = [
  { id: '1', type: 'direct', title: '直推佣金', desc: '用户小美下单 · CEBRENIS精华水', amount: 14.95, date: '2026-03-31' },
  { id: '2', type: 'direct', title: '直推佣金', desc: '用户阿花下单 · 一条根按摩膏', amount: 1.50, date: '2026-03-31' },
  { id: '3', type: 'indirect', title: '间推佣金', desc: '用户小丽下单 · 保湿面膜套装', amount: 3.80, date: '2026-03-30' },
  { id: '4', type: 'withdraw', title: '提现到微信', desc: '扣除手续费 ¥3.60', amount: -180.00, date: '2026-03-30' },
  { id: '5', type: 'direct', title: '直推佣金', desc: '用户小雪下单 · 防晒喷雾', amount: 6.95, date: '2026-03-29' },
  { id: '6', type: 'indirect', title: '间推佣金', desc: '用户小红下单 · 洗衣液家庭装', amount: 1.20, date: '2026-03-29' },
  { id: '7', type: 'direct', title: '直推佣金', desc: '用户大美下单 · 精华液礼盒', amount: 24.50, date: '2026-03-28' },
  { id: '8', type: 'withdraw', title: '提现到微信', desc: '扣除手续费 ¥6.00', amount: -300.00, date: '2026-03-28' },
]

// Group earnings by date
function groupByDate(items: EarningItem[]) {
  const groups: { date: string; items: EarningItem[] }[] = []
  items.forEach((item) => {
    const existing = groups.find((g) => g.date === item.date)
    if (existing) {
      existing.items.push(item)
    } else {
      groups.push({ date: item.date, items: [item] })
    }
  })
  return groups
}

export default function EarningsPage() {
  const [activeTab, setActiveTab] = useState(0)
  const [summary] = useState(MOCK_SUMMARY)

  const filteredEarnings = MOCK_EARNINGS.filter((item) => {
    if (activeTab === 0) return true
    if (activeTab === 1) return item.type === 'direct'
    if (activeTab === 2) return item.type === 'indirect'
    if (activeTab === 3) return item.type === 'withdraw'
    return true
  })

  const groups = groupByDate(filteredEarnings)

  return (
    <View className='earnings-page'>
      {/* Summary Card */}
      <View className='summary-card'>
        <View className='summary-grid'>
          <View className='summary-item'>
            <Text className='summary-value summary-value--gold'>
              ¥{summary.withdrawable.toFixed(2)}
            </Text>
            <Text className='summary-label'>可提现</Text>
          </View>
          <View className='summary-item'>
            <Text className='summary-value'>¥{summary.total.toFixed(2)}</Text>
            <Text className='summary-label'>累计收益</Text>
          </View>
          <View className='summary-item'>
            <Text className='summary-value'>¥{summary.withdrawn.toFixed(2)}</Text>
            <Text className='summary-label'>已提现</Text>
          </View>
          <View className='summary-item'>
            <Text className='summary-value summary-value--muted'>
              ¥{summary.frozen.toFixed(2)}
            </Text>
            <Text className='summary-label'>冻结中</Text>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View className='tabs-bar'>
        {TABS.map((tab, idx) => (
          <View
            key={tab}
            className={`tab-item ${activeTab === idx ? 'tab-item--active' : ''}`}
            onClick={() => setActiveTab(idx)}
          >
            <Text className='tab-text'>{tab}</Text>
            {activeTab === idx && <View className='tab-indicator' />}
          </View>
        ))}
      </View>

      {/* Earnings List */}
      <ScrollView className='earnings-list' scrollY>
        {groups.map((group) => (
          <View key={group.date} className='date-group'>
            <Text className='date-label'>{group.date}</Text>
            {group.items.map((item) => (
              <View key={item.id} className='earning-item'>
                <View className='earning-left'>
                  <Text className='earning-title'>{item.title}</Text>
                  <Text className='earning-desc'>{item.desc}</Text>
                </View>
                <Text
                  className={`earning-amount ${
                    item.amount > 0 ? 'earning-amount--positive' : 'earning-amount--negative'
                  }`}
                >
                  {item.amount > 0 ? '+' : ''}¥{Math.abs(item.amount).toFixed(2)}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {groups.length === 0 && (
          <View className='empty-state'>
            <Text className='empty-text'>暂无记录</Text>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
