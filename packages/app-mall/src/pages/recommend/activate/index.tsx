import { View, Text, Checkbox } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import './index.scss'

const BENEFITS = [
  { icon: '\uD83D\uDCB0', title: '佣金收益', desc: '推荐好友下单，获得佣金奖励' },
  { icon: '\uD83D\uDDBC\uFE0F', title: '专属海报', desc: '一键生成推广海报，轻松分享' },
  { icon: '\uD83D\uDCCA', title: '数据看板', desc: '实时查看推荐数据与收益' },
]

const COMMISSION_RULES = [
  { type: '直接推荐', rule: '售价的 5%（固定）', highlight: true },
  { type: '间推 · 利润 ≤ 15%', rule: '售价的 1%', highlight: false },
  { type: '间推 · 利润 16%-30%', rule: '售价的 2%', highlight: false },
  { type: '间推 · 利润 > 30%', rule: '售价的 3%', highlight: false },
]

export default function RecommendActivate() {
  const [agreed, setAgreed] = useState(false)

  const handleActivate = () => {
    if (!agreed) {
      Taro.showToast({ title: '请先同意推荐官协议', icon: 'none' })
      return
    }
    Taro.showToast({ title: '开通成功', icon: 'success' })
    setTimeout(() => {
      Taro.redirectTo({ url: '/pages/recommend/index' })
    }, 1500)
  }

  return (
    <View className='activate-page'>
      {/* Brand Intro */}
      <View className='brand-section'>
        <Text className='brand-title'>成为时皙life推荐官</Text>
        <Text className='brand-subtitle'>分享好物，轻松赚取佣金</Text>
        <Text className='brand-desc'>
          零门槛开通，无需缴纳任何费用。推荐好友购物即可获得佣金奖励，让分享变成收益。
        </Text>
      </View>

      {/* Benefits */}
      <View className='benefits-card'>
        <Text className='section-title'>推荐官权益</Text>
        <View className='benefits-grid'>
          {BENEFITS.map((item) => (
            <View key={item.title} className='benefit-item'>
              <Text className='benefit-icon'>{item.icon}</Text>
              <Text className='benefit-title'>{item.title}</Text>
              <Text className='benefit-desc'>{item.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Commission Rules */}
      <View className='rules-card'>
        <Text className='section-title'>佣金规则</Text>
        <View className='rules-list'>
          {COMMISSION_RULES.map((item) => (
            <View
              key={item.type}
              className={`rule-row ${item.highlight ? 'rule-row--highlight' : ''}`}
            >
              <Text className='rule-type'>{item.type}</Text>
              <Text className='rule-value'>{item.rule}</Text>
            </View>
          ))}
        </View>
        <Text className='rules-note'>
          佣金在买家确认收货7天后解冻至可提现余额，提现手续费2%
        </Text>
      </View>

      {/* Agreement */}
      <View className='agreement-row' onClick={() => setAgreed(!agreed)}>
        <Checkbox
          className='agreement-checkbox'
          value='agree'
          checked={agreed}
          color='#C9A96E'
        />
        <Text className='agreement-text'>
          我已阅读并同意
          <Text className='agreement-link'>《时皙life推荐官协议》</Text>
        </Text>
      </View>

      {/* Activate Button */}
      <View
        className={`activate-btn ${agreed ? 'activate-btn--active' : ''}`}
        onClick={handleActivate}
      >
        <Text className='activate-btn-text'>立即开通</Text>
      </View>
      <Text className='activate-hint'>零门槛，无需审核，立即生效</Text>
    </View>
  )
}
