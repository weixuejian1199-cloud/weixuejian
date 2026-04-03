import { useState } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Image, ScrollView, Swiper, SwiperItem } from '@tarojs/components'
import './index.scss'

// ─── Mock Data ──────────────────────────────
const mockBanners = [
  { id: 1, tag: 'CEBRENIS', title: '黄金双因精华\n抗老新突破', desc: '莹特丽代工 · 医研共创', img: '' },
  { id: 2, tag: '限时特惠', title: '全场满199\n减30元', desc: '仅限今日 · 先到先得', img: '' },
  { id: 3, tag: '新品上市', title: '一条根植萃膏\n古法养护', desc: '29.9元体验装', img: '' },
]

const mockCategories = [
  { id: 1, icon: '🧴', label: '护肤' },
  { id: 2, icon: '🍵', label: '食品' },
  { id: 3, icon: '🏠', label: '日用' },
  { id: 4, icon: '💄', label: '美妆' },
  { id: 5, icon: '👗', label: '服装' },
  { id: 6, icon: '🧸', label: '母婴' },
  { id: 7, icon: '💪', label: '健康' },
  { id: 8, icon: '🏃', label: '运动' },
  { id: 9, icon: '📱', label: '数码' },
  { id: 10, icon: '···', label: '更多' },
]

const mockTrials = [
  { id: 1, name: 'CEBRENIS 焕肤修复面膜体验装', pts: '200积分兑换', img: '' },
  { id: 2, name: '玫瑰果精华油旅行装', pts: '150积分兑换', img: '' },
  { id: 3, name: '益生菌冻干粉试用装', pts: '100积分兑换', img: '' },
]

const mockFlagships = [
  { id: 1, name: '黄金双因抗老精华液', price: 299, original: 599, img: '' },
  { id: 2, name: '多肽焕颜紧致面霜', price: 328, original: 658, img: '' },
  { id: 3, name: '玻尿酸修复精华水', price: 198, original: 398, img: '' },
]

const mockPicks = [
  { id: 1, name: '云南凤庆古树滇红茶 蜜香金芽250g', price: 68, original: 128, sold: '1,280', theme: 'warm' },
  { id: 2, name: '温和氨基酸洁面乳 敏肌适用120ml', price: 89, original: 169, sold: '856', theme: 'rose' },
  { id: 3, name: '日本进口德绒自发热保暖内衣套装', price: 129, original: 299, sold: '2,103', theme: 'cool' },
  { id: 4, name: '复合益生菌冻干粉 肠道调理30条', price: 158, original: 298, sold: '3,421', theme: 'blue' },
]

// ─── Home Page Component ────────────────────
export default function Home() {
  const [currentBanner, setCurrentBanner] = useState(0)

  const navigateTo = (url: string) => {
    Taro.navigateTo({ url })
  }

  // ─── Banner ───────────────────────────────
  const renderBanner = () => (
    <View className='home__banner'>
      <Swiper
        className='banner-swiper'
        indicatorDots={false}
        autoplay
        circular
        interval={4000}
        onChange={(e) => setCurrentBanner(e.detail.current)}
      >
        {mockBanners.map((banner) => (
          <SwiperItem key={banner.id} className='banner-slide'>
            <View className='banner-content'>
              <View className='banner-text'>
                <Text className='banner-tag'>{banner.tag}</Text>
                <Text className='banner-title'>{banner.title}</Text>
                <Text className='banner-desc'>{banner.desc}</Text>
              </View>
              <View className='banner-img'>
                {banner.img && <Image src={banner.img} mode='aspectFill' />}
              </View>
            </View>
          </SwiperItem>
        ))}
      </Swiper>
      <View className='banner-dots'>
        {mockBanners.map((_, i) => (
          <View
            key={i}
            className={`banner-dot ${i === currentBanner ? 'banner-dot--active' : ''}`}
          />
        ))}
      </View>
    </View>
  )

  // ─── Category Grid ────────────────────────
  const renderCategory = () => (
    <View className='home__category'>
      <View className='category-grid'>
        {mockCategories.map((cat) => (
          <View
            key={cat.id}
            className='category-item'
            onClick={() => navigateTo(`/pages/category/index?id=${cat.id}`)}
          >
            <View className='category-icon'>
              <Text>{cat.icon}</Text>
            </View>
            <Text className='category-label'>{cat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )

  // ─── Checkin Card ─────────────────────────
  const renderCheckin = () => (
    <View
      className='home__checkin'
      onClick={() => navigateTo('/pages/checkin/index')}
    >
      <View className='checkin-left'>
        <Text className='checkin-emoji'>☀️</Text>
        <View>
          <Text className='checkin-title'>签到领积分</Text>
          <Text className='checkin-sub'>已连续签到3天 | 每日品质任务</Text>
        </View>
      </View>
      <View className='checkin-btn'>
        <Text>去签到</Text>
      </View>
    </View>
  )

  // ─── Section Header ───────────────────────
  const renderSectionHeader = (title: string, more: string, highlight?: string, onMore?: () => void) => (
    <View className='home__section-header'>
      <Text className='section-title'>
        {title}
        {highlight && <Text className='section-highlight'> {highlight}</Text>}
      </Text>
      <Text className='section-more' onClick={onMore}>{more}</Text>
    </View>
  )

  // ─── Trial Section ────────────────────────
  const renderTrials = () => (
    <>
      {renderSectionHeader('新品试用', '更多 >')}
      <View className='home__trial'>
        <ScrollView scrollX className='trial-scroll' enhanced showScrollbar={false}>
          {mockTrials.map((item) => (
            <View
              key={item.id}
              className='trial-card'
              onClick={() => navigateTo(`/pages/trial/detail?id=${item.id}`)}
            >
              <View className='trial-img'>
                {item.img && <Image src={item.img} mode='aspectFill' />}
              </View>
              <View className='trial-info'>
                <Text className='trial-name'>{item.name}</Text>
                <Text className='trial-pts'>{item.pts}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </>
  )

  // ─── Flagship Section ─────────────────────
  const renderFlagship = () => (
    <>
      {renderSectionHeader('时皙护肤', '全部 >', '旗舰推荐')}
      <View className='home__flagship'>
        <View className='flagship-header'>
          <Text className='flagship-badge'>CEBRENIS</Text>
          <Text className='flagship-sub'>莹特丽代工 / 医研共创</Text>
        </View>
        <ScrollView scrollX className='flagship-scroll' enhanced showScrollbar={false}>
          {mockFlagships.map((item) => (
            <View
              key={item.id}
              className='flagship-card'
              onClick={() => navigateTo(`/pages/product/detail?id=${item.id}`)}
            >
              <View className='flagship-img'>
                {item.img && <Image src={item.img} mode='aspectFill' />}
              </View>
              <Text className='flagship-name'>{item.name}</Text>
              <View className='flagship-price-row'>
                <Text className='flagship-price'>¥{item.price}</Text>
                <Text className='flagship-original'>¥{item.original}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </>
  )

  // ─── Daily Picks ──────────────────────────
  const renderPicks = () => (
    <>
      {renderSectionHeader('今日精选', '更多 >')}
      <View className='home__picks'>
        {mockPicks.map((item) => (
          <View
            key={item.id}
            className='pick-card'
            onClick={() => navigateTo(`/pages/product/detail?id=${item.id}`)}
          >
            <View className={`pick-img pick-img--${item.theme}`} />
            <View className='pick-info'>
              <Text className='pick-name'>{item.name}</Text>
              <View className='pick-price-row'>
                <Text className='pick-price'>
                  <Text className='pick-yen'>¥</Text>{item.price}
                </Text>
                <Text className='pick-original'>¥{item.original}</Text>
              </View>
              <Text className='pick-sold'>已售 {item.sold}</Text>
            </View>
          </View>
        ))}
      </View>
    </>
  )

  // ─── Weekly Report ────────────────────────
  const renderWeekly = () => (
    <View
      className='home__weekly'
      onClick={() => navigateTo('/pages/weekly/index')}
    >
      <View className='weekly-left'>
        <Text className='weekly-icon'>📖</Text>
        <Text className='weekly-text'>本周品质周报已更新</Text>
      </View>
      <Text className='weekly-arrow'>查看 &gt;</Text>
    </View>
  )

  // ─── Share Bar ────────────────────────────
  const renderShare = () => (
    <View
      className='home__share'
      onClick={() => navigateTo('/pages/recommender/index')}
    >
      <Text className='share-text'>分享好物给朋友，轻松赚收益</Text>
      <Text className='share-link'>了解详情 &gt;</Text>
    </View>
  )

  // ─── AI FAB ───────────────────────────────
  const renderAiFab = () => (
    <View
      className='home__ai-fab'
      onClick={() => navigateTo('/pages/ai-assistant/index')}
    >
      <Text className='ai-fab-text'>AI</Text>
    </View>
  )

  return (
    <View className='home'>
      {renderBanner()}
      {renderCategory()}
      {renderCheckin()}
      {renderTrials()}
      {renderFlagship()}
      {renderPicks()}
      {renderWeekly()}
      {renderShare()}
      {renderAiFab()}
    </View>
  )
}
