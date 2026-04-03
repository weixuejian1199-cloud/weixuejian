import Taro from '@tarojs/taro'
import { View, Text, Image } from '@tarojs/components'
import './index.scss'

// ─── Mock Data ──────────────────────────────
const mockOrder = {
  status: '待收货',
  statusCode: 'pending_receive',
  statusDesc: '商品已发出，请耐心等待',
  address: {
    name: '小雨',
    phone: '138****8888',
    detail: '上海市浦东新区陆家嘴环路1000号 时皙大厦3楼',
  },
  products: [
    { id: 1, name: 'CEBRENIS 黄金双因抗老精华液', spec: '30ml 标准装', price: 299, qty: 1, img: '', theme: 'warm' },
    { id: 2, name: '云南凤庆古树滇红茶 蜜香金芽', spec: '250g 罐装', price: 68, qty: 2, img: '', theme: 'cool' },
  ],
  priceDetail: {
    subtotal: 435,
    shipping: 0,
    coupon: -30,
    pointsDiscount: -5,
    total: 400,
  },
  orderInfo: {
    orderNo: '2026033112345678',
    createTime: '2026-03-31 10:30:00',
    payTime: '2026-03-31 10:31:25',
    payMethod: '微信支付',
  },
  actions: ['查看物流', '确认收货'],
}

// ─── OrderDetail Page Component ─────────────
export default function OrderDetail() {
  const navigateTo = (url: string) => {
    Taro.navigateTo({ url })
  }

  // ─── Status Bar ───────────────────────────
  const renderStatus = () => (
    <View className={`detail__status detail__status--${mockOrder.statusCode}`}>
      <Text className='detail__status-text'>{mockOrder.status}</Text>
      <Text className='detail__status-desc'>{mockOrder.statusDesc}</Text>
    </View>
  )

  // ─── Address ──────────────────────────────
  const renderAddress = () => (
    <View className='detail__section'>
      <View className='detail__address'>
        <View className='detail__address-icon'>
          <Text>📍</Text>
        </View>
        <View className='detail__address-info'>
          <View className='detail__address-name'>
            <Text>{mockOrder.address.name}</Text>
            <Text className='detail__address-phone'>{mockOrder.address.phone}</Text>
          </View>
          <Text className='detail__address-detail'>{mockOrder.address.detail}</Text>
        </View>
      </View>
    </View>
  )

  // ─── Products ─────────────────────────────
  const renderProducts = () => (
    <View className='detail__section'>
      <Text className='detail__section-title'>商品信息</Text>
      {mockOrder.products.map((item) => (
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
    <View className='detail__section'>
      <View className='price-row'>
        <Text className='price-row__label'>商品合计</Text>
        <Text className='price-row__value'>¥{mockOrder.priceDetail.subtotal}</Text>
      </View>
      <View className='price-row'>
        <Text className='price-row__label'>运费</Text>
        <Text className='price-row__value price-row__value--free'>免运费</Text>
      </View>
      <View className='price-row'>
        <Text className='price-row__label'>优惠券</Text>
        <Text className='price-row__value price-row__value--coupon'>-¥{Math.abs(mockOrder.priceDetail.coupon)}</Text>
      </View>
      <View className='price-row'>
        <Text className='price-row__label'>积分抵扣</Text>
        <Text className='price-row__value price-row__value--coupon'>-¥{Math.abs(mockOrder.priceDetail.pointsDiscount)}</Text>
      </View>
      <View className='price-row price-row--total'>
        <Text className='price-row__label'>实付款</Text>
        <Text className='price-row__value price-row__value--total'>¥{mockOrder.priceDetail.total}</Text>
      </View>
    </View>
  )

  // ─── Order Info ───────────────────────────
  const renderOrderInfo = () => (
    <View className='detail__section'>
      <Text className='detail__section-title'>订单信息</Text>
      <View className='info-row'>
        <Text className='info-row__label'>订单编号</Text>
        <Text className='info-row__value'>{mockOrder.orderInfo.orderNo}</Text>
      </View>
      <View className='info-row'>
        <Text className='info-row__label'>创建时间</Text>
        <Text className='info-row__value'>{mockOrder.orderInfo.createTime}</Text>
      </View>
      <View className='info-row'>
        <Text className='info-row__label'>付款时间</Text>
        <Text className='info-row__value'>{mockOrder.orderInfo.payTime}</Text>
      </View>
      <View className='info-row'>
        <Text className='info-row__label'>支付方式</Text>
        <Text className='info-row__value'>{mockOrder.orderInfo.payMethod}</Text>
      </View>
    </View>
  )

  // ─── Bottom Actions ───────────────────────
  const renderActions = () => (
    <View className='detail__action-bar'>
      {mockOrder.actions.map((action) => (
        <View
          key={action}
          className={`detail__action-btn ${action === '确认收货' ? 'detail__action-btn--primary' : ''}`}
          onClick={() => {
            if (action === '查看物流') navigateTo(`/pages/order/logistics/index?id=${mockOrder.orderInfo.orderNo}`)
          }}
        >
          <Text className={`detail__action-btn-text ${action === '确认收货' ? 'detail__action-btn-text--primary' : ''}`}>{action}</Text>
        </View>
      ))}
    </View>
  )

  return (
    <View className='detail'>
      {renderStatus()}
      <View className='detail__content'>
        {renderAddress()}
        {renderProducts()}
        {renderPriceDetail()}
        {renderOrderInfo()}
      </View>
      {renderActions()}
    </View>
  )
}
