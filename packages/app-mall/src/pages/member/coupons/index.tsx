import { useState } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './index.scss'

type CouponStatus = 'available' | 'used' | 'expired'

interface Coupon {
  id: number
  amount: number
  threshold: number
  title: string
  scope: string
  expireDate: string
  status: CouponStatus
}

const MOCK_COUPONS: Coupon[] = [
  { id: 1, amount: 50, threshold: 299, title: '满299减50', scope: '全品类可用', expireDate: '2026-04-15', status: 'available' },
  { id: 2, amount: 30, threshold: 199, title: '满199减30', scope: '美妆护肤专用', expireDate: '2026-04-10', status: 'available' },
  { id: 3, amount: 20, threshold: 99, title: '满99减20', scope: '母婴用品专用', expireDate: '2026-04-20', status: 'available' },
  { id: 4, amount: 15, threshold: 0, title: '无门槛券', scope: '全品类可用', expireDate: '2026-04-08', status: 'available' },
  { id: 5, amount: 100, threshold: 499, title: '满499减100', scope: '全品类可用', expireDate: '2026-04-30', status: 'available' },
  { id: 6, amount: 25, threshold: 149, title: '满149减25', scope: '美妆护肤专用', expireDate: '2026-03-25', status: 'used' },
  { id: 7, amount: 10, threshold: 0, title: '无门槛券', scope: '全品类可用', expireDate: '2026-03-20', status: 'used' },
  { id: 8, amount: 40, threshold: 249, title: '满249减40', scope: '母婴用品专用', expireDate: '2026-03-15', status: 'expired' },
  { id: 9, amount: 20, threshold: 99, title: '满99减20', scope: '全品类可用', expireDate: '2026-03-10', status: 'expired' },
]

const TABS: { key: CouponStatus; label: string; count?: number }[] = [
  { key: 'available', label: '可使用', count: 5 },
  { key: 'used', label: '已使用' },
  { key: 'expired', label: '已过期' },
]

export default function CouponsPage() {
  const [activeTab, setActiveTab] = useState<CouponStatus>('available')
  const [redeemCode, setRedeemCode] = useState('')

  const filtered = MOCK_COUPONS.filter((c) => c.status === activeTab)

  const handleRedeem = () => {
    if (!redeemCode.trim()) {
      Taro.showToast({ title: '请输入兑换码', icon: 'none' })
      return
    }
    Taro.showToast({ title: '兑换成功', icon: 'success' })
    setRedeemCode('')
  }

  const handleUseCoupon = (coupon: Coupon) => {
    if (coupon.status !== 'available') return
    Taro.switchTab({ url: '/pages/home/index' })
  }

  const isDisabled = activeTab !== 'available'

  return (
    <View className='coupons'>
      {/* Tabs */}
      <View className='coupons__tabs'>
        {TABS.map((tab) => (
          <View
            key={tab.key}
            className={`coupons__tab ${activeTab === tab.key ? 'coupons__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <Text className='coupons__tab-text'>
              {tab.label}{tab.count ? ` ${tab.count}` : ''}
            </Text>
            {activeTab === tab.key && <View className='coupons__tab-line' />}
          </View>
        ))}
      </View>

      {/* Coupon List */}
      <View className='coupons__list'>
        {filtered.length === 0 ? (
          <View className='coupons__empty'>
            <Text className='coupons__empty-text'>暂无{TABS.find((t) => t.key === activeTab)?.label}优惠券</Text>
          </View>
        ) : (
          filtered.map((coupon) => (
            <View
              key={coupon.id}
              className={`coupons__card ${isDisabled ? 'coupons__card--disabled' : ''}`}
            >
              {/* Left - Amount */}
              <View className='coupons__card-left'>
                <View className='coupons__card-amount-row'>
                  <Text className='coupons__card-symbol'>{'\u00A5'}</Text>
                  <Text className='coupons__card-amount'>{coupon.amount}</Text>
                </View>
                {coupon.threshold > 0 ? (
                  <Text className='coupons__card-threshold'>满{coupon.threshold}可用</Text>
                ) : (
                  <Text className='coupons__card-threshold'>无门槛</Text>
                )}
              </View>

              {/* Cutout decoration */}
              <View className='coupons__card-cutout'>
                <View className='coupons__card-cutout-top' />
                <View className='coupons__card-cutout-line' />
                <View className='coupons__card-cutout-bottom' />
              </View>

              {/* Right - Info */}
              <View className='coupons__card-right'>
                <Text className='coupons__card-scope'>{coupon.scope}</Text>
                <Text className='coupons__card-expire'>有效期至 {coupon.expireDate}</Text>
                {coupon.status === 'available' && (
                  <View className='coupons__card-btn' onClick={() => handleUseCoupon(coupon)}>
                    <Text className='coupons__card-btn-text'>去使用</Text>
                  </View>
                )}
                {coupon.status === 'used' && (
                  <Text className='coupons__card-status'>已使用</Text>
                )}
                {coupon.status === 'expired' && (
                  <Text className='coupons__card-status'>已过期</Text>
                )}
              </View>
            </View>
          ))
        )}
      </View>

      {/* Redeem */}
      <View className='coupons__redeem'>
        <View className='coupons__redeem-inner'>
          <Input
            className='coupons__redeem-input'
            placeholder='输入兑换码'
            value={redeemCode}
            onInput={(e) => setRedeemCode(e.detail.value)}
          />
          <View className='coupons__redeem-btn' onClick={handleRedeem}>
            <Text className='coupons__redeem-btn-text'>兑换</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
