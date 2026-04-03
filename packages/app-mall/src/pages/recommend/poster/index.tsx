import { View, Text, ScrollView, Image, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import './index.scss'

interface Product {
  id: string
  name: string
  image: string
  price: number
  commission: number
}

const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'CEBRENIS 精华水 150ml', image: '', price: 299, commission: 14.95 },
  { id: '2', name: '一条根按摩膏 50g', image: '', price: 29.9, commission: 1.50 },
  { id: '3', name: '保湿面膜套装 5片', image: '', price: 128, commission: 6.40 },
  { id: '4', name: '精华液礼盒 30ml*3', image: '', price: 490, commission: 24.50 },
]

interface Template {
  id: string
  name: string
  bgColor: string
  textColor: string
  accentColor: string
}

const TEMPLATES: Template[] = [
  { id: 'white', name: '品质白', bgColor: '#FFFFFF', textColor: '#1A1A1A', accentColor: '#C9A96E' },
  { id: 'gold', name: '品牌金', bgColor: '#FFF8EF', textColor: '#6B5C4D', accentColor: '#C9A96E' },
  { id: 'gray', name: '简约灰', bgColor: '#F5F4F1', textColor: '#1A1A1A', accentColor: '#666666' },
]

export default function PosterPage() {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0])
  const [searchText, setSearchText] = useState('')

  const filteredProducts = MOCK_PRODUCTS.filter((p) =>
    p.name.includes(searchText)
  )

  const handleSave = () => {
    if (!selectedProduct) {
      Taro.showToast({ title: '请先选择商品', icon: 'none' })
      return
    }
    Taro.showToast({ title: '海报已保存到相册', icon: 'success' })
  }

  const handleShare = () => {
    if (!selectedProduct) {
      Taro.showToast({ title: '请先选择商品', icon: 'none' })
      return
    }
    Taro.showToast({ title: '分享功能开发中', icon: 'none' })
  }

  return (
    <View className='poster-page'>
      {/* Product Selection */}
      <View className='product-section'>
        <Text className='section-title'>选择商品</Text>
        <Input
          className='search-input'
          placeholder='搜索商品'
          value={searchText}
          onInput={(e) => setSearchText(e.detail.value)}
        />
        <ScrollView className='product-list' scrollX>
          {filteredProducts.map((product) => (
            <View
              key={product.id}
              className={`product-card ${
                selectedProduct?.id === product.id ? 'product-card--selected' : ''
              }`}
              onClick={() => setSelectedProduct(product)}
            >
              <View className='product-img-placeholder'>
                {product.image ? (
                  <Image className='product-img' src={product.image} mode='aspectFill' />
                ) : (
                  <Text className='product-img-emoji'>{'\uD83D\uDCE6'}</Text>
                )}
              </View>
              <Text className='product-name'>{product.name}</Text>
              <Text className='product-price'>¥{product.price}</Text>
              <Text className='product-commission'>佣金 ¥{product.commission}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Template Selection */}
      <View className='template-section'>
        <Text className='section-title'>选择模板</Text>
        <ScrollView className='template-list' scrollX>
          {TEMPLATES.map((tpl) => (
            <View
              key={tpl.id}
              className={`template-card ${
                selectedTemplate.id === tpl.id ? 'template-card--selected' : ''
              }`}
              onClick={() => setSelectedTemplate(tpl)}
            >
              <View
                className='template-preview'
                style={{ background: tpl.bgColor }}
              >
                <View className='tpl-header' style={{ background: tpl.accentColor }} />
                <View className='tpl-body'>
                  <View className='tpl-rect' />
                  <View className='tpl-lines'>
                    <View className='tpl-line' style={{ background: tpl.textColor, opacity: 0.3 }} />
                    <View className='tpl-line tpl-line--short' style={{ background: tpl.textColor, opacity: 0.2 }} />
                  </View>
                </View>
              </View>
              <Text className='template-name'>{tpl.name}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Poster Preview */}
      <View className='preview-section'>
        <Text className='section-title'>海报预览</Text>
        <View
          className='poster-preview'
          style={{ background: selectedTemplate.bgColor }}
        >
          {/* Poster Header */}
          <View className='poster-brand'>
            <Text
              className='poster-brand-name'
              style={{ color: selectedTemplate.accentColor }}
            >
              时皙life
            </Text>
            <Text
              className='poster-brand-slogan'
              style={{ color: selectedTemplate.textColor }}
            >
              让美好生活触手可及
            </Text>
          </View>

          {/* Product Area */}
          {selectedProduct ? (
            <View className='poster-product'>
              <View className='poster-product-img'>
                <Text className='poster-product-emoji'>{'\uD83D\uDCE6'}</Text>
              </View>
              <Text
                className='poster-product-name'
                style={{ color: selectedTemplate.textColor }}
              >
                {selectedProduct.name}
              </Text>
              <Text
                className='poster-product-price'
                style={{ color: selectedTemplate.accentColor }}
              >
                ¥{selectedProduct.price}
              </Text>
            </View>
          ) : (
            <View className='poster-empty'>
              <Text className='poster-empty-text'>请选择商品</Text>
            </View>
          )}

          {/* QR Code Area */}
          <View className='poster-qr'>
            <View className='poster-qr-box'>
              <Text className='poster-qr-text'>小程序码</Text>
            </View>
            <Text
              className='poster-qr-hint'
              style={{ color: selectedTemplate.textColor }}
            >
              长按识别 立即选购
            </Text>
          </View>
        </View>
      </View>

      {/* Action Buttons */}
      <View className='action-bar'>
        <View className='action-btn action-btn--outline' onClick={handleSave}>
          <Text className='action-btn-text action-btn-text--outline'>保存海报</Text>
        </View>
        <View className='action-btn action-btn--primary' onClick={handleShare}>
          <Text className='action-btn-text action-btn-text--primary'>分享好友</Text>
        </View>
      </View>
    </View>
  )
}
