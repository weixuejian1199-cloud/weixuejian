import { useState } from 'react';
import { View, Text, Image, ScrollView, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

interface SubCategory {
  id: string;
  name: string;
}

interface Category {
  id: string;
  emoji: string;
  name: string;
  banner: { tag: string; title: string; desc: string };
  subCategories: SubCategory[];
  products: Array<{
    id: string;
    name: string;
    image: string;
    price: number;
    originalPrice: number;
    sold: number;
    bgClass: string;
  }>;
}

// Mock data
const MOCK_CATEGORIES: Category[] = [
  {
    id: 'skincare',
    emoji: '\uD83E\uDDF4',
    name: '护肤',
    banner: { tag: 'CEBRENIS', title: '护肤精选', desc: '医研共创 \u00B7 大牌品质' },
    subCategories: [
      { id: 'all', name: '全部' },
      { id: 'serum', name: '精华' },
      { id: 'cream', name: '面霜' },
      { id: 'mask', name: '面膜' },
      { id: 'cleanser', name: '洁面' },
      { id: 'sunscreen', name: '防晒' },
    ],
    products: [
      { id: 'p1', name: 'CEBRENIS 黄金双因精华液', image: '', price: 299, originalPrice: 599, sold: 1280, bgClass: 'warm' },
      { id: 'p2', name: '多肽焕颜紧致面霜', image: '', price: 328, originalPrice: 658, sold: 856, bgClass: 'rose' },
      { id: 'p3', name: '玻尿酸修复精华水', image: '', price: 198, originalPrice: 398, sold: 2103, bgClass: 'cool' },
      { id: 'p4', name: '温和氨基酸洁面乳', image: '', price: 89, originalPrice: 169, sold: 3421, bgClass: 'blue' },
      { id: 'p5', name: 'CEBRENIS 焕肤修复面膜', image: '', price: 158, originalPrice: 298, sold: 1567, bgClass: 'lavender' },
      { id: 'p6', name: '玫瑰果精华油', image: '', price: 128, originalPrice: 256, sold: 987, bgClass: 'peach' },
    ],
  },
  {
    id: 'food',
    emoji: '\uD83C\uDF75',
    name: '食品',
    banner: { tag: '臻选', title: '食品精选', desc: '天然好物 \u00B7 品质之选' },
    subCategories: [
      { id: 'all', name: '全部' },
      { id: 'tea', name: '茶饮' },
      { id: 'snack', name: '零食' },
      { id: 'health', name: '养生' },
    ],
    products: [
      { id: 'f1', name: '云南凤庆古树滇红茶', image: '', price: 68, originalPrice: 128, sold: 2341, bgClass: 'warm' },
      { id: 'f2', name: '有机枸杞原浆', image: '', price: 138, originalPrice: 258, sold: 1023, bgClass: 'cool' },
    ],
  },
  {
    id: 'daily',
    emoji: '\uD83C\uDFE0',
    name: '日用',
    banner: { tag: '好物', title: '日用精选', desc: '品质生活 \u00B7 精致日常' },
    subCategories: [{ id: 'all', name: '全部' }],
    products: [],
  },
  {
    id: 'makeup',
    emoji: '\uD83D\uDC84',
    name: '美妆',
    banner: { tag: '美妆', title: '美妆精选', desc: '精致妆容 \u00B7 美丽绽放' },
    subCategories: [{ id: 'all', name: '全部' }],
    products: [],
  },
  {
    id: 'clothing',
    emoji: '\uD83D\uDC57',
    name: '服装',
    banner: { tag: '时尚', title: '服装精选', desc: '品质穿搭 \u00B7 时尚态度' },
    subCategories: [{ id: 'all', name: '全部' }],
    products: [],
  },
  {
    id: 'baby',
    emoji: '\uD83E\uDDF8',
    name: '母婴',
    banner: { tag: '母婴', title: '母婴精选', desc: '安心之选 \u00B7 守护成长' },
    subCategories: [{ id: 'all', name: '全部' }],
    products: [],
  },
  {
    id: 'wellness',
    emoji: '\uD83D\uDCAA',
    name: '健康',
    banner: { tag: '健康', title: '健康精选', desc: '科学养护 \u00B7 活力人生' },
    subCategories: [{ id: 'all', name: '全部' }],
    products: [],
  },
  {
    id: 'sports',
    emoji: '\uD83C\uDFC3',
    name: '运动',
    banner: { tag: '运动', title: '运动精选', desc: '活力运动 \u00B7 健康生活' },
    subCategories: [{ id: 'all', name: '全部' }],
    products: [],
  },
  {
    id: 'digital',
    emoji: '\uD83D\uDCF1',
    name: '数码',
    banner: { tag: '数码', title: '数码精选', desc: '智能科技 \u00B7 品质生活' },
    subCategories: [{ id: 'all', name: '全部' }],
    products: [],
  },
];

const SORT_OPTIONS = ['综合', '销量', '价格', '新品'];

export default function CategoryPage() {
  const [activeCatIndex, setActiveCatIndex] = useState(0);
  const [activeSubId, setActiveSubId] = useState('all');
  const [activeSortIndex, setActiveSortIndex] = useState(0);

  const currentCat = MOCK_CATEGORIES[activeCatIndex];

  const handleCatChange = (index: number) => {
    setActiveCatIndex(index);
    setActiveSubId('all');
  };

  const handleProductTap = (productId: string) => {
    Taro.navigateTo({ url: `/pages/product/detail?id=${productId}` });
  };

  return (
    <View className="category-page">
      {/* Search */}
      <View className="search-section">
        <View className="search-box">
          <Text className="search-icon">&#x1F50D;</Text>
          <Input
            className="search-input"
            placeholder="搜索商品名称"
            placeholderClass="search-placeholder"
            disabled
          />
        </View>
      </View>

      {/* Body */}
      <View className="category-body">
        {/* Left sidebar */}
        <ScrollView className="cat-sidebar" scrollY enhanced showScrollbar={false}>
          {MOCK_CATEGORIES.map((cat, index) => (
            <View
              key={cat.id}
              className={`cat-nav-item ${index === activeCatIndex ? 'active' : ''}`}
              onClick={() => handleCatChange(index)}
            >
              <Text className="cat-emoji">{cat.emoji}</Text>
              <Text className="cat-label">{cat.name}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Right content */}
        <ScrollView className="cat-content" scrollY enhanced showScrollbar={false}>
          {/* Banner */}
          <View className="cat-banner">
            <View className="cat-banner-text">
              <Text className="cbt-tag">{currentCat.banner.tag}</Text>
              <Text className="cbt-title">{currentCat.banner.title}</Text>
              <Text className="cbt-desc">{currentCat.banner.desc}</Text>
            </View>
            <View className="cat-banner-img">
              <Text className="cat-banner-img__text">{currentCat.banner.title}</Text>
            </View>
          </View>

          {/* Sub-category tags */}
          <ScrollView className="sub-tags" scrollX enhanced showScrollbar={false}>
            {currentCat.subCategories.map((sub) => (
              <Text
                key={sub.id}
                className={`sub-tag ${activeSubId === sub.id ? 'active' : ''}`}
                onClick={() => setActiveSubId(sub.id)}
              >
                {sub.name}
              </Text>
            ))}
          </ScrollView>

          {/* Sort bar */}
          <View className="sort-bar">
            {SORT_OPTIONS.map((label, index) => (
              <Text
                key={label}
                className={`sort-item ${index === activeSortIndex ? 'active' : ''}`}
                onClick={() => setActiveSortIndex(index)}
              >
                {label}
                {index === 2 && '\u2191\u2193'}
              </Text>
            ))}
          </View>

          {/* Product grid */}
          <View className="product-grid">
            {currentCat.products.map((product) => (
              <View
                key={product.id}
                className="pick-card"
                onClick={() => handleProductTap(product.id)}
              >
                <View className={`pick-img ${product.bgClass}`}>
                  <Text className="pick-img__placeholder">{product.name.slice(0, 6)}</Text>
                </View>
                <View className="pick-info">
                  <Text className="pick-name">{product.name}</Text>
                  <View className="pick-price-row">
                    <Text className="pick-price">
                      <Text className="yen">&yen;</Text>
                      {product.price}
                    </Text>
                    <Text className="pick-original">&yen;{product.originalPrice}</Text>
                  </View>
                  <Text className="pick-sold">已售 {product.sold.toLocaleString()}</Text>
                </View>
              </View>
            ))}
          </View>

          {currentCat.products.length === 0 && (
            <View className="empty-tip">
              <Text className="empty-tip__text">暂无商品</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
