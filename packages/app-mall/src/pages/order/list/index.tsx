import { useState } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Image } from '@tarojs/components'
import './index.scss'

// ─── Mock Data ──────────────────────────────
const mockTabs = ['全部', '待付款', '待发货', '待收货', '待评价']

const mockOrders = [
  {
    id: '2026033112345678',
    status: '待付款',
    statusCode: 'pending_pay',
    products: [
      { id: 1, name: 'CEBRENIS 黄金双因抗老精华液 30ml', spec: '30ml 标准装', price: 299, qty: 1, img: '' },
    ],
    totalCount: 1,
    totalAmount: 299,
    actions: ['取消订单', '去付款'],
  },
  {
    id: '2026033012345679',
    status: '待发货',
    statusCode: 'pending_ship',
    products: [
      { id: 2, name: '云南凤庆古树滇红茶 蜜香金芽', spec: '250g 罐装', price: 68, qty: 2, img: '' },
      { id: 3, name: '复合益生菌冻干粉 肠道调理', spec: '30条/盒', price: 158, qty: 1, img: '' },
    ],
    totalCount: 3,
    totalAmount: 294,
    actions: ['提醒发货'],
  },
  {
    id: '2026032912345680',
    status: '待收货',
    statusCode: 'pending_receive',
    products: [
      { id: 4, name: '温和氨基酸洁面乳 敏肌适用', spec: '120ml', price: 89, qty: 1, img: '' },
    ],
    totalCount: 1,
    totalAmount: 89,
    actions: ['查看物流', '确认收货'],
  },
]

// ─── OrderList Page Component ───────────────
export default function OrderList() {
  const [activeTab, setActiveTab] = useState(0)

  const navigateTo = (url: string) => {
    Taro.navigateTo({ url })
  }

  // ─── Tabs ─────────────────────────────────
  const renderTabs = () => (
    <View className='order-list__tabs'>
      {mockTabs.map((tab, index) => (
        <View
          key={tab}
          className={`tab-item ${index === activeTab ? 'tab-item--active' : ''}`}
          onClick={() => setActiveTab(index)}
        >
          <Text className={`tab-item__text ${index === activeTab ? 'tab-item__text--active' : ''}`}>{tab}</Text>
          {index === activeTab && <View className='tab-item__bar' />}
        </View>
      ))}
    </View>
  )

  // ─── Order Card ───────────────────────────
  const renderOrderCard = (order: typeof mockOrders[0]) => (
    <View
      key={order.id}
      className='order-card'
      onClick={() => navigateTo(`/pages/order/detail/index?id=${order.id}`)}
    >
      <View className='order-card__header'>
        <Text className='order-card__id'>订单号：{order.id}</Text>
        <Text className={`order-card__status order-card__status--${order.statusCode}`}>{order.status}</Text>
      </View>

      {order.products.map((product) => (
        <View key={product.id} className='order-card__product'>
          <View className='order-card__img'>
            {product.img && <Image src={product.img} mode='aspectFill' />}
          </View>
          <View className='order-card__info'>
            <Text className='order-card__name'>{product.name}</Text>
            <Text className='order-card__spec'>{product.spec}</Text>
          </View>
          <View className='order-card__right'>
            <Text className='order-card__price'>¥{product.price}</Text>
            <Text className='order-card__qty'>×{product.qty}</Text>
          </View>
        </View>
      ))}

      <View className='order-card__footer'>
        <Text className='order-card__summary'>共{order.totalCount}件 合计：<Text className='order-card__total'>¥{order.totalAmount}</Text></Text>
        <View className='order-card__actions'>
          {order.actions.map((action) => (
            <View
              key={action}
              className={`order-card__btn ${action === '去付款' || action === '确认收货' ? 'order-card__btn--primary' : ''}`}
              onClick={(e) => { e.stopPropagation() }}
            >
              <Text className={`order-card__btn-text ${action === '去付款' || action === '确认收货' ? 'order-card__btn-text--primary' : ''}`}>{action}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  )

  return (
    <View className='order-list'>
      {renderTabs()}
      <View className='order-list__content'>
        {mockOrders.map((order) => renderOrderCard(order))}
      </View>
    </View>
  )
}
