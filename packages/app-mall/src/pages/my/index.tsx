import { View, Text, Image } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useUserStore } from '../../stores/user'
import './index.scss'

// Mock data for demo
const MOCK_USER = {
  name: '小雨',
  avatar: '',
  level: 'VIP' as const,
  points: 2680,
  totalConsumption: 3680,
  isRecommender: true,
  recommenderCode: 'SX20260328001',
  phone: '138****8888',
}

const ORDER_ITEMS = [
  { icon: '\uD83D\uDCB3', label: '待付款', badge: 2 },
  { icon: '\uD83D\uDCE6', label: '待发货', badge: 1 },
  { icon: '\uD83D\uDE9A', label: '待收货', badge: 0 },
  { icon: '\u2B50', label: '待评价', badge: 3 },
]

const QUICK_ITEMS = [
  { icon: '\uD83C\uDF81', label: '积分试用' },
  { icon: '\uD83D\uDC51', label: '会员权益' },
  { icon: '\uD83C\uDF1F', label: 'VIP中心' },
  { icon: '\uD83D\uDCB0', label: '推荐中心' },
]

const FUNC_ITEMS = [
  { icon: '\uD83D\uDCCD', name: '收货地址' },
  { icon: '\uD83E\uDD16', name: 'AI顾问' },
  { icon: '\u2764\uFE0F', name: '我的收藏' },
  { icon: '\uD83D\uDD04', name: '售后服务' },
  { icon: '\uD83D\uDCAC', name: '在线客服' },
  { icon: '\u2699\uFE0F', name: '设置' },
]

export default function MyPage() {
  const { isLoggedIn, name, avatar, level, points, totalConsumption, isRecommender, recommenderCode, setUser } = useUserStore()

  useDidShow(() => {
    // Load mock data for demo
    if (!isLoggedIn) {
      setUser(MOCK_USER)
    }
  })

  const vicThreshold = 5000
  const progressPercent = Math.min((totalConsumption / vicThreshold) * 100, 100)
  const remaining = Math.max(vicThreshold - totalConsumption, 0)

  const levelLabel = level === 'VIC' ? 'VIC 会员' : level === 'VIP' ? 'VIP 会员' : '普通会员'

  const handleNavigate = (url: string) => {
    Taro.navigateTo({ url })
  }

  const handleSettings = () => {
    Taro.navigateTo({ url: '/pages/settings/index' })
  }

  const handleAllOrders = () => {
    Taro.navigateTo({ url: '/pages/orders/index' })
  }

  const handleOrderTab = (index: number) => {
    Taro.navigateTo({ url: `/pages/orders/index?tab=${index + 1}` })
  }

  return (
    <View className='my-page'>
      {/* User Header */}
      <View className='user-header'>
        <View className='user-info'>
          {avatar ? (
            <Image className='avatar' src={avatar} mode='aspectFill' />
          ) : (
            <View className='avatar-placeholder'>
              <Text className='avatar-emoji'>{'\uD83D\uDC69'}</Text>
            </View>
          )}
          <View className='user-meta'>
            <View className='user-name-row'>
              <Text className='user-name'>{name || '未登录'}</Text>
              {level === 'VIP' && <Text className='vip-badge'>VIP</Text>}
              {level === 'VIC' && <Text className='vic-badge'>VIC</Text>}
            </View>
            <Text className='user-id'>ID: {recommenderCode || '--'}</Text>
            <Text className='user-points'>{'\u2728'} {points.toLocaleString()} 积分</Text>
          </View>
          <View className='settings-icon' onClick={handleSettings}>
            <Text>{'\u2699\uFE0F'}</Text>
          </View>
        </View>
      </View>

      {/* Level Progress */}
      {level !== 'VIC' && (
        <View className='level-progress'>
          <View className='level-info'>
            <Text className='level-current'>{levelLabel}</Text>
            <Text className='level-target'>距VIC还差 ¥{remaining.toLocaleString()}</Text>
          </View>
          <View className='progress-bar'>
            <View className='progress-fill' style={{ width: `${progressPercent}%` }} />
          </View>
          <Text className='level-hint'>累计消费满 ¥{vicThreshold.toLocaleString()} 升级VIC，享更多专属权益</Text>
        </View>
      )}

      {/* Checkin Status */}
      <View className='checkin-status'>
        <View className='cs-left'>
          <Text className='cs-emoji'>{'\u2600\uFE0F'}</Text>
          <Text className='cs-text'>
            已连续签到 <Text className='cs-highlight'>3天</Text>，明日+15积分
          </Text>
        </View>
        <View className='cs-btn'>
          <Text>已签到</Text>
        </View>
      </View>

      {/* Orders */}
      <View className='orders-card'>
        <View className='orders-header'>
          <Text className='orders-title'>我的订单</Text>
          <Text className='orders-all' onClick={handleAllOrders}>全部订单 &gt;</Text>
        </View>
        <View className='orders-grid'>
          {ORDER_ITEMS.map((item, idx) => (
            <View key={item.label} className='order-item' onClick={() => handleOrderTab(idx)}>
              <Text className='order-icon'>{item.icon}</Text>
              <Text className='order-label'>{item.label}</Text>
              {item.badge > 0 && <Text className='order-badge'>{item.badge}</Text>}
            </View>
          ))}
        </View>
      </View>

      {/* Recommend Center */}
      {isRecommender && (
        <View className='recommend-card'>
          <View className='rec-header'>
            <Text className='rec-title'>推荐中心</Text>
            <Text className='rec-badge'>已开通</Text>
          </View>
          <View className='rec-stats'>
            <View className='rec-stat-item'>
              <Text className='rec-stat-value rec-stat-value--gold'>¥1,280</Text>
              <Text className='rec-stat-label'>累计收益</Text>
            </View>
            <View className='rec-stat-item'>
              <Text className='rec-stat-value'>¥580</Text>
              <Text className='rec-stat-label'>可提现</Text>
            </View>
            <View className='rec-stat-item'>
              <Text className='rec-stat-value'>¥320</Text>
              <Text className='rec-stat-label'>本月佣金</Text>
            </View>
          </View>
        </View>
      )}

      {/* Wallet */}
      <View className='wallet-row'>
        <View className='wallet-item' onClick={() => handleNavigate('/pages/coupons/index')}>
          <Text className='wallet-value'>5</Text>
          <Text className='wallet-label'>优惠券</Text>
        </View>
        <View className='wallet-item' onClick={() => handleNavigate('/pages/points/index')}>
          <Text className='wallet-value'>{points.toLocaleString()}</Text>
          <Text className='wallet-label'>积分</Text>
        </View>
        <View className='wallet-item' onClick={() => handleNavigate('/pages/commission/index')}>
          <Text className='wallet-value wallet-value--gold'>¥580</Text>
          <Text className='wallet-label'>佣金</Text>
        </View>
      </View>

      {/* Quick Entries */}
      <View className='quick-entries'>
        {QUICK_ITEMS.map((item) => (
          <View key={item.label} className='quick-item'>
            <View className='quick-icon'>
              <Text>{item.icon}</Text>
            </View>
            <Text className='quick-label'>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Function List */}
      <View className='func-list'>
        {FUNC_ITEMS.map((item) => (
          <View key={item.name} className='func-item'>
            <View className='func-left'>
              <Text className='func-icon'>{item.icon}</Text>
              <Text className='func-name'>{item.name}</Text>
            </View>
            <Text className='func-arrow'>&gt;</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
