import { useState } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Image, Input } from '@tarojs/components'
import './index.scss'

// ─── Mock Data ──────────────────────────────
const mockAddress = {
  name: '小雨',
  phone: '138****8888',
  tag: '默认',
  detail: '上海市浦东新区陆家嘴环路1000号 时皙大厦3楼',
}

const mockProducts = [
  { id: 1, name: 'CEBRENIS 黄金双因抗老精华液', spec: '30ml 标准装', price: 299, qty: 1, img: '', theme: 'warm' },
  { id: 2, name: '云南凤庆古树滇红茶 蜜香金芽', spec: '250g 罐装', price: 68, qty: 2, img: '', theme: 'cool' },
]

const mockPriceDetail = {
  subtotal: 435,
  shipping: 0,
  coupon: -30,
  points: 500,
  pointsDiscount: -5,
  total: 400,
  saved: 35,
}

// ─── OrderConfirm Page Component ────────────
export default function OrderConfirm() {
  const [usePoints, setUsePoints] = useState(true)
  const [remark, setRemark] = useState('')

  const navigateTo = (url: string) => {
    Taro.navigateTo({ url })
  }

  const handleSubmit = () => {
    Taro.navigateTo({ url: '/pages/order/result/index' })
  }

  // ─── Address Card ─────────────────────────
  const renderAddress = () => (
    <View className='confirm__address' onClick={() => navigateTo('/pages/address/list/index')}>
      <View className='address__top'>
        <View className='address__info'>
          <View className='address__name'>
            <Text>{mockAddress.name}</Text>
            <Text className='address__phone'>{mockAddress.phone}</Text>
            {mockAddress.tag && <Text className='address__tag'>{mockAddress.tag}</Text>}
          </View>
          <Text className='address__detail'>{mockAddress.detail}</Text>
        </View>
        <Text className='address__arrow'>&#8250;</Text>
      </View>
      <View className='address__zigzag' />
    </View>
  )

  // ─── Product List ─────────────────────────
  const renderProducts = () => (
    <View className='confirm__section'>
      <Text className='section__title'>商品信息</Text>
      {mockProducts.map((item) => (
        <View key={item.id} className='product-item'>
          <View className={`product-item__img product-item__img--${item.theme}`}>
            {item.img ? <Image src={item.img} mode='aspectFill' /> : <Text className='product-item__placeholder'>{item.name.slice(0, 4)}</Text>}
          </View>
          <View className='product-item__info'>
            <View>
              <Text className='product-item__name'>{item.name}</Text>
              <Text className='product-item__spec'>{item.spec}</Text>
            </View>
            <View className='product-item__row'>
              <Text className='product-item__price'>
                <Text className='product-item__yen'>¥</Text>{item.price}
              </Text>
              <Text className='product-item__qty'>×{item.qty}</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  )

  // ─── Price Detail ─────────────────────────
  const renderPriceDetail = () => (
    <View className='confirm__section'>
      <View className='price-row'>
        <Text className='price-row__label'>商品合计</Text>
        <Text className='price-row__value'>¥{mockPriceDetail.subtotal}</Text>
      </View>
      <View className='price-row'>
        <Text className='price-row__label'>运费</Text>
        <Text className='price-row__value price-row__value--free'>免运费</Text>
      </View>
      <View className='price-row'>
        <Text className='price-row__label'>优惠券</Text>
        <Text className='price-row__value price-row__value--coupon'>-¥{Math.abs(mockPriceDetail.coupon)}</Text>
      </View>
      <View className='price-row'>
        <View className='price-row__label'>
          <Text>积分抵扣</Text>
          <Text className='price-row__points-text'>（使用{mockPriceDetail.points}积分）</Text>
        </View>
        <View className='price-row__points'>
          <Text className='price-row__value price-row__value--coupon'>-¥{Math.abs(mockPriceDetail.pointsDiscount)}</Text>
          <View
            className={`toggle ${usePoints ? 'toggle--on' : ''}`}
            onClick={() => setUsePoints(!usePoints)}
          />
        </View>
      </View>
    </View>
  )

  // ─── Remark ───────────────────────────────
  const renderRemark = () => (
    <View className='confirm__section'>
      <Text className='section__title section__title--sm'>订单备注</Text>
      <Input
        className='confirm__remark'
        placeholder='选填，给卖家留言'
        value={remark}
        onInput={(e) => setRemark(e.detail.value)}
      />
    </View>
  )

  // ─── Commission Hint ──────────────────────
  const renderCommission = () => (
    <View className='confirm__commission'>
      <Text className='commission__icon'>💰</Text>
      <Text className='commission__text'>本单预计推荐收益 ¥21.75</Text>
    </View>
  )

  // ─── Submit Bar ───────────────────────────
  const renderSubmitBar = () => (
    <View className='confirm__submit-bar'>
      <View className='submit-bar__left'>
        <View className='submit-bar__total'>
          <Text className='submit-bar__label'>合计</Text>
          <Text className='submit-bar__amount'>
            <Text className='submit-bar__yen'>¥</Text>{mockPriceDetail.total}
          </Text>
        </View>
        <Text className='submit-bar__saved'>已优惠 ¥{mockPriceDetail.saved}</Text>
      </View>
      <View className='submit-bar__btn' onClick={handleSubmit}>
        <Text className='submit-bar__btn-text'>提交订单</Text>
      </View>
    </View>
  )

  return (
    <View className='confirm'>
      <View className='confirm__content'>
        {renderAddress()}
        {renderProducts()}
        {renderPriceDetail()}
        {renderRemark()}
        {renderCommission()}
      </View>
      {renderSubmitBar()}
    </View>
  )
}
