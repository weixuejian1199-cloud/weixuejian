import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './index.scss'

interface Address {
  id: number
  name: string
  phone: string
  province: string
  city: string
  district: string
  detail: string
  isDefault: boolean
}

const MOCK_ADDRESSES: Address[] = [
  {
    id: 1,
    name: '小雨',
    phone: '138****8888',
    province: '广东省',
    city: '深圳市',
    district: '南山区',
    detail: '科技园南区A栋1201室',
    isDefault: true,
  },
  {
    id: 2,
    name: '小雨',
    phone: '138****8888',
    province: '广东省',
    city: '广州市',
    district: '天河区',
    detail: '体育西路101号天河城写字楼15F',
    isDefault: false,
  },
  {
    id: 3,
    name: '李妈妈',
    phone: '139****6666',
    province: '湖南省',
    city: '长沙市',
    district: '岳麓区',
    detail: '麓山南路88号湖南大学教工宿舍3栋502',
    isDefault: false,
  },
]

export default function AddressPage() {
  const [addresses, setAddresses] = useState<Address[]>(MOCK_ADDRESSES)

  const handleDelete = (id: number) => {
    Taro.showModal({
      title: '提示',
      content: '确定删除该地址吗？',
      success: (res) => {
        if (res.confirm) {
          setAddresses((prev) => prev.filter((a) => a.id !== id))
          Taro.showToast({ title: '已删除', icon: 'none' })
        }
      },
    })
  }

  const handleSetDefault = (id: number) => {
    setAddresses((prev) =>
      prev.map((a) => ({ ...a, isDefault: a.id === id }))
    )
    Taro.showToast({ title: '已设为默认', icon: 'none' })
  }

  const handleEdit = (_id: number) => {
    Taro.showToast({ title: '编辑地址', icon: 'none' })
  }

  const handleAdd = () => {
    Taro.showToast({ title: '新增地址', icon: 'none' })
  }

  return (
    <View className='address'>
      {/* Address List */}
      <View className='address__list'>
        {addresses.map((addr) => (
          <View key={addr.id} className='address__card'>
            <View className='address__card-header'>
              <View className='address__card-user'>
                <Text className='address__card-name'>{addr.name}</Text>
                <Text className='address__card-phone'>{addr.phone}</Text>
                {addr.isDefault && (
                  <Text className='address__card-default'>默认</Text>
                )}
              </View>
            </View>
            <Text className='address__card-detail'>
              {addr.province}{addr.city}{addr.district}{addr.detail}
            </Text>
            <View className='address__card-actions'>
              {!addr.isDefault && (
                <View
                  className='address__card-action'
                  onClick={() => handleSetDefault(addr.id)}
                >
                  <Text className='address__card-action-text'>设为默认</Text>
                </View>
              )}
              <View className='address__card-action-right'>
                <View
                  className='address__card-action'
                  onClick={() => handleEdit(addr.id)}
                >
                  <Text className='address__card-action-icon'>{'\u270F\uFE0F'}</Text>
                  <Text className='address__card-action-text'>编辑</Text>
                </View>
                <View
                  className='address__card-action'
                  onClick={() => handleDelete(addr.id)}
                >
                  <Text className='address__card-action-icon'>{'\uD83D\uDDD1'}</Text>
                  <Text className='address__card-action-text'>删除</Text>
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Add Button */}
      <View className='address__add' onClick={handleAdd}>
        <Text className='address__add-text'>+ 新增收货地址</Text>
      </View>
    </View>
  )
}
