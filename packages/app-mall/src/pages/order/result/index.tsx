import Taro from '@tarojs/taro'
import { View, Text, Image } from '@tarojs/components'
import './index.scss'

// ─── Mock Data ──────────────────────────────
const mockResult = {
  amount: 400,
  orderNo: '2026033112345678',
}

const mockRecommends = [
  { id: 1, name: '多肽焕颜紧致面霜 50ml', price: 328, original: 658, img: '' },
  { id: 2, name: '玻尿酸修复精华水 120ml', price: 198, original: 398, img: '' },
  { id: 3, name: '氨基酸温和洁面乳 120ml', price: 89, original: 169, img: '' },
]

// ─── PayResult Page Component ───────────────
export default function PayResult() {
  const navigateTo = (url: string) => {
    Taro.navigateTo({ url })
  }

  const goOrderDetail = () => {
    Taro.navigateTo({ url: `/pages/order/detail/index?orderNo=${mockResult.orderNo}` })
  }

  const goHome = () => {
    Taro.switchTab({ url: '/pages/home/index' })
  }

  // ─── Result Header ────────────────────────
  const renderHeader = () => (
    <View className='result__header'>
      <View className='result__icon'>
        <Text className='result__checkmark'>&#10003;</Text>
      </View>
      <Text className='result__title'>支付成功</Text>
      <Text className='result__amount'>
        <Text className='result__yen'>¥</Text>{mockResult.amount}
      </Text>
      <Text className='result__order-no'>订单号：{mockResult.orderNo}</Text>
    </View>
  )

  // ─── Buttons ──────────────────────────────
  const renderButtons = () => (
    <View className='result__buttons'>
      <View className='result__btn result__btn--primary' onClick={goOrderDetail}>
        <Text className='result__btn-text result__btn-text--primary'>查看订单</Text>
      </View>
      <View className='result__btn result__btn--secondary' onClick={goHome}>
        <Text className='result__btn-text result__btn-text--secondary'>继续购物</Text>
      </View>
    </View>
  )

  // ─── Recommend ────────────────────────────
  const renderRecommends = () => (
    <View className='result__recommends'>
      <Text className='result__section-title'>猜你喜欢</Text>
      <View className='recommend-list'>
        {mockRecommends.map((item) => (
          <View
            key={item.id}
            className='recommend-card'
            onClick={() => navigateTo(`/pages/product/detail?id=${item.id}`)}
          >
            <View className='recommend-card__img'>
              {item.img && <Image src={item.img} mode='aspectFill' />}
            </View>
            <Text className='recommend-card__name'>{item.name}</Text>
            <View className='recommend-card__price-row'>
              <Text className='recommend-card__price'>
                <Text className='recommend-card__yen'>¥</Text>{item.price}
              </Text>
              <Text className='recommend-card__original'>¥{item.original}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )

  return (
    <View className='result'>
      {renderHeader()}
      {renderButtons()}
      {renderRecommends()}
    </View>
  )
}
