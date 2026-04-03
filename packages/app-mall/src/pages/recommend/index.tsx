import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import './index.scss'

const MOCK_USER = {
  name: '小雨',
  avatar: '',
  daysJoined: 28,
}

const MOCK_REVENUE = {
  total: 1280,
  withdrawable: 580,
  monthly: 320,
  frozen: 120,
}

const MOCK_DATA = {
  directCount: 12,
  cooperateCount: 5,
  monthlyOrders: 28,
}

const FUNC_ENTRIES = [
  { icon: '\uD83D\uDDBC\uFE0F', label: '生成海报', url: '/pages/recommend/poster/index' },
  { icon: '\uD83D\uDD17', label: '推荐码', url: '' },
  { icon: '\uD83D\uDCC8', label: '佣金明细', url: '/pages/recommend/earnings/index' },
  { icon: '\uD83D\uDC65', label: '团队管理', url: '' },
]

const COMMISSION_RULES = [
  { label: '直接推荐', value: '售价的 5%（固定）' },
]

const INDIRECT_RULES = [
  { label: '利润 ≤ 15%', value: '1%' },
  { label: '利润 16%-30%', value: '2%' },
  { label: '利润 > 30%', value: '3%' },
]

export default function RecommendCenter() {
  const [user] = useState(MOCK_USER)
  const [revenue] = useState(MOCK_REVENUE)
  const [data] = useState(MOCK_DATA)

  const handleNavigate = (url: string) => {
    if (url) {
      Taro.navigateTo({ url })
    }
  }

  const handleWithdraw = () => {
    Taro.navigateTo({ url: '/pages/recommend/withdraw/index' })
  }

  return (
    <View className='recommend-page'>
      {/* Identity Card */}
      <View className='identity-card'>
        <View className='id-header'>
          {user.avatar ? (
            <Image className='id-avatar' src={user.avatar} mode='aspectFill' />
          ) : (
            <View className='id-avatar-placeholder'>
              <Text className='id-avatar-emoji'>{'\uD83D\uDC69'}</Text>
            </View>
          )}
          <View className='id-info'>
            <View className='id-name-row'>
              <Text className='id-name'>{user.name}</Text>
              <Text className='id-badge'>推荐官</Text>
            </View>
            <Text className='id-level'>推荐官 · 加入 {user.daysJoined} 天</Text>
          </View>
        </View>
      </View>

      {/* Revenue Overview */}
      <View className='revenue-card'>
        <View className='rev-header'>
          <Text className='rev-title'>收益概览</Text>
          <View className='rev-withdraw-btn' onClick={handleWithdraw}>
            <Text className='rev-withdraw-text'>去提现</Text>
          </View>
        </View>
        <View className='rev-grid'>
          <View className='rev-item'>
            <Text className='rev-value rev-value--gold'>¥{revenue.total.toLocaleString()}</Text>
            <Text className='rev-label'>累计收益</Text>
          </View>
          <View className='rev-item'>
            <Text className='rev-value'>¥{revenue.withdrawable.toLocaleString()}</Text>
            <Text className='rev-label'>可提现</Text>
          </View>
          <View className='rev-divider' />
          <View className='rev-item'>
            <Text className='rev-value'>¥{revenue.monthly.toLocaleString()}</Text>
            <Text className='rev-label'>本月佣金</Text>
          </View>
          <View className='rev-item'>
            <Text className='rev-value rev-value--muted'>¥{revenue.frozen.toLocaleString()}</Text>
            <Text className='rev-label'>冻结中</Text>
          </View>
        </View>
      </View>

      {/* Data Overview */}
      <View className='data-card'>
        <Text className='data-title'>数据概览</Text>
        <View className='data-grid'>
          <View className='data-item'>
            <Text className='data-value'>{data.directCount}</Text>
            <Text className='data-label'>直推人数</Text>
          </View>
          <View className='data-item'>
            <Text className='data-value'>{data.cooperateCount}</Text>
            <Text className='data-label'>协作推荐</Text>
          </View>
          <View className='data-item'>
            <Text className='data-value'>{data.monthlyOrders}</Text>
            <Text className='data-label'>本月单数</Text>
          </View>
        </View>
      </View>

      {/* Function Entries */}
      <View className='func-grid'>
        {FUNC_ENTRIES.map((item) => (
          <View
            key={item.label}
            className='func-item'
            onClick={() => handleNavigate(item.url)}
          >
            <Text className='func-icon'>{item.icon}</Text>
            <Text className='func-label'>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Commission Rules */}
      <View className='commission-card'>
        <Text className='commission-title'>佣金规则</Text>
        <View className='commission-rules'>
          {COMMISSION_RULES.map((rule) => (
            <View key={rule.label} className='commission-row commission-row--border'>
              <Text className='commission-row-label'>{rule.label}</Text>
              <Text className='commission-row-value'>{rule.value}</Text>
            </View>
          ))}
          <Text className='commission-subtitle'>间接推荐：按商品利润率浮动</Text>
          {INDIRECT_RULES.map((rule) => (
            <View key={rule.label} className='commission-row'>
              <Text className='commission-row-label commission-row-label--muted'>{rule.label}</Text>
              <Text className='commission-row-value'>{rule.value}</Text>
            </View>
          ))}
        </View>
        <Text className='commission-hint'>佣金在买家确认收货后解冻，可提现</Text>
      </View>
    </View>
  )
}
