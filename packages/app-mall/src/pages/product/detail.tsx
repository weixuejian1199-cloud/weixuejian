import { useState } from 'react';
import { View, Text, Swiper, SwiperItem, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCartStore } from '../../stores/cart';
import './detail.scss';

// ── Mock Data: CEBRENIS 精华液 ──
const mockProduct = {
  id: 'prod_cebrenis_001',
  name: 'CEBRENIS 黄金双因抗老精华液 30ml',
  subtitle: '莹特丽代工 · 黄金双因抗老技术 · 医研共创',
  currentPrice: 299,
  originalPrice: 599,
  discount: '5折',
  soldCount: '1,280+',
  favorableRate: '98.6%',
  images: [
    'https://placeholder.com/cebrenis-1.jpg',
    'https://placeholder.com/cebrenis-2.jpg',
    'https://placeholder.com/cebrenis-3.jpg',
    'https://placeholder.com/cebrenis-4.jpg',
    'https://placeholder.com/cebrenis-5.jpg',
  ],
  hasVideo: true,
  promos: [
    { type: 'coupon' as const, label: '满减', text: '满299减30，满599减80' },
    { type: 'group' as const, label: '拼团', text: '2人拼团价 ¥269' },
    { type: 'points' as const, label: '积分', text: '预计获得 150 积分' },
  ],
  specs: [
    { id: 'sku_30ml', label: '30ml 标准装', price: 299, stock: 500 },
    { id: 'sku_15ml', label: '15ml 体验装', price: 169, stock: 300 },
    { id: 'sku_30mlx2', label: '30ml×2 套装', price: 549, stock: 200 },
  ],
  sellingPoints: [
    { title: '双因子抗老科技', desc: '重组胶原蛋白+类蛇毒肽双通路抗皱，28天淡纹率达87%' },
    { title: '莹特丽代工品质', desc: '全球TOP3代工厂出品，与La Mer/SK-II同级产线' },
    { title: '敏肌友好配方', desc: '0酒精0香精0色素，通过SGS安全性检测认证' },
  ],
  ingredients: [
    { name: '重组胶原蛋白', role: '紧致抗皱' },
    { name: '类蛇毒肽', role: '平滑表情纹' },
    { name: '角鲨烷', role: '深层保湿' },
    { name: '烟酰胺', role: '提亮匀肤' },
    { name: '透明质酸钠', role: '锁水屏障' },
  ],
  trialReports: [
    { user: '小鹿妈妈', tag: 'VIP会员', text: '用了两周，法令纹明显浅了，质地很清爽不油腻，敏感肌也能用。' },
    { user: '美肌达人Lily', tag: '试用官', text: '吸收很快，第二天早起皮肤滑滑的，会一直回购。' },
  ],
  reviews: [
    { user: '用户***8', stars: '★★★★★', text: '朋友推荐来的，果然没让我失望，性价比超高！' },
    { user: '用户***3', stars: '★★★★★', text: '包装精致，效果看得见，已经买了第三瓶。' },
  ],
  brandStory:
    'CEBRENIS源自瑞士精研科技，甄选全球顶级原料，联合莹特丽实验室历时3年研发。我们相信，真正的抗老不应是奢侈品的专属——以医研级品质、亲民的价格，让每一位女性都能拥有自信光彩。',
};

// ── Tab 定义 ──
const TABS = ['成分解析', '试用报告', '买家晒单', '品质故事'] as const;

const ProductDetail = () => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [selectedSpec, setSelectedSpec] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);

  const addItem = useCartStore((s) => s.addItem);

  const product = mockProduct;
  const spec = product.specs[selectedSpec];

  // ── Handlers ──
  const handleBack = () => {
    Taro.navigateBack();
  };

  const handleAddCart = () => {
    addItem({
      id: `cart_${spec.id}_${Date.now()}`,
      productId: product.id,
      skuId: spec.id,
      name: product.name,
      spec: spec.label,
      price: spec.price,
      image: product.images[0],
      quantity: 1,
      stock: spec.stock,
    });
    Taro.showToast({ title: '已加入购物车', icon: 'success' });
  };

  const handleBuyNow = () => {
    Taro.navigateTo({
      url: `/pages/order/confirm?productId=${product.id}&skuId=${spec.id}&quantity=1`,
    });
  };

  const handleContact = () => {
    // 小程序客服通过 button open-type="contact" 触发，此处做降级提示
    Taro.showToast({ title: '请点击客服按钮', icon: 'none' });
  };

  const handleFavorite = () => {
    setIsFavorite((prev) => !prev);
    Taro.showToast({ title: isFavorite ? '已取消收藏' : '已收藏', icon: 'none' });
  };

  // ── Tab Content Renderers ──
  const renderTabContent = () => {
    switch (activeTab) {
      case 0:
        return (
          <View className='tab-content'>
            {product.ingredients.map((ing, idx) => (
              <View key={idx} className='ingredient-item'>
                <Text className='ing-name'>{ing.name}</Text>
                <Text className='ing-role'>{ing.role}</Text>
              </View>
            ))}
          </View>
        );
      case 1:
        return (
          <View className='tab-content'>
            {product.trialReports.map((item, idx) => (
              <View key={idx} className='trial-item'>
                <Text className='trial-user'>
                  {item.user}
                  <Text className='trial-tag'>{item.tag}</Text>
                </Text>
                <Text className='trial-text'>{item.text}</Text>
              </View>
            ))}
          </View>
        );
      case 2:
        return (
          <View className='tab-content'>
            {product.reviews.map((item, idx) => (
              <View key={idx} className='review-item'>
                <View className='review-header'>
                  <Text className='review-user'>{item.user}</Text>
                  <Text className='review-stars'>{item.stars}</Text>
                </View>
                <Text className='review-text'>{item.text}</Text>
              </View>
            ))}
          </View>
        );
      case 3:
        return (
          <View className='tab-content'>
            <Text className='story-text'>{product.brandStory}</Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View className='product-detail'>
      {/* ── 1. 商品图片轮播 ── */}
      <View className='gallery'>
        <Swiper
          className='gallery__swiper'
          indicatorDots={false}
          circular
          autoplay
          interval={4000}
          onChange={(e) => setCurrentSlide(e.detail.current)}
        >
          {product.images.map((img, idx) => (
            <SwiperItem key={idx}>
              <View className='gallery__slide'>
                {/* 开发阶段使用 placeholder，正式替换为 Image */}
                <Text className='gallery__placeholder'>
                  {idx === 0 ? `CEBRENIS\n黄金双因抗老精华液\n30ml\n\n[ 商品主图 ]` : `[ 商品图 ${idx + 1} ]`}
                </Text>
              </View>
            </SwiperItem>
          ))}
        </Swiper>

        {/* 导航按钮 */}
        <View className='gallery__nav'>
          <View className='gallery__nav-btn' onClick={handleBack}>
            <Text style={{ fontSize: '18px', color: '#1A1A1A' }}>{'<'}</Text>
          </View>
          <View className='gallery__actions'>
            <View className='gallery__nav-btn' onClick={handleFavorite}>
              <Text style={{ fontSize: '16px', color: isFavorite ? '#E85D3A' : '#1A1A1A' }}>
                {isFavorite ? '♥' : '♡'}
              </Text>
            </View>
            <View className='gallery__nav-btn'>
              <Text style={{ fontSize: '16px', color: '#1A1A1A' }}>↑</Text>
            </View>
          </View>
        </View>

        {/* 指示点 */}
        <View className='gallery__dots'>
          {product.images.map((_, idx) => (
            <View
              key={idx}
              className={`gallery__dot ${currentSlide === idx ? 'gallery__dot--active' : ''}`}
            />
          ))}
        </View>

        {/* 视频标识 */}
        {product.hasVideo && (
          <View className='gallery__video-badge'>
            <Text style={{ fontSize: '10px', color: '#fff' }}>▶</Text>
            <Text>视频</Text>
          </View>
        )}
      </View>

      {/* ── 2. 价格区 ── */}
      <View className='price-section'>
        <View className='price-row'>
          <Text className='current-price'>
            <Text className='yen'>¥</Text>
            {spec.price}
          </Text>
          <Text className='original-price'>¥{product.originalPrice}</Text>
          <Text className='discount-tag'>{product.discount}</Text>
        </View>
        <Text className='product-title'>{product.name}</Text>
        <Text className='product-subtitle'>{product.subtitle}</Text>
        <Text className='sold-info'>
          月销 {product.soldCount} | 好评率 {product.favorableRate}
        </Text>
      </View>

      {/* ── 4. 优惠信息 ── */}
      <View className='promo-section'>
        {product.promos.map((promo, idx) => (
          <View key={idx} className='promo-item'>
            <Text className={`promo-tag promo-tag--${promo.type}`}>{promo.label}</Text>
            <Text className='promo-text'>{promo.text}</Text>
            <Text className='promo-arrow'>{'>'}</Text>
          </View>
        ))}
      </View>

      {/* ── 5. 规格选择 ── */}
      <View className='spec-section'>
        <Text className='spec-label'>规格选择</Text>
        <View className='spec-options'>
          {product.specs.map((s, idx) => (
            <Text
              key={s.id}
              className={`spec-chip ${selectedSpec === idx ? 'spec-chip--selected' : ''}`}
              onClick={() => setSelectedSpec(idx)}
            >
              {s.label}
            </Text>
          ))}
        </View>
      </View>

      {/* ── 6. 核心卖点 ── */}
      <View className='points-section'>
        <Text className='points-title'>核心卖点</Text>
        {product.sellingPoints.map((point, idx) => (
          <View key={idx} className='point-item'>
            <View className='point-dot' />
            <Text className='point-text'>
              <Text className='bold'>{point.title}</Text> — {point.desc}
            </Text>
          </View>
        ))}
      </View>

      {/* ── 7. 详情Tab ── */}
      <View className='detail-tabs'>
        <View className='tab-row'>
          {TABS.map((tab, idx) => (
            <Text
              key={idx}
              className={`tab-item ${activeTab === idx ? 'tab-item--active' : ''}`}
              onClick={() => setActiveTab(idx)}
            >
              {tab}
            </Text>
          ))}
        </View>
        {renderTabContent()}
      </View>

      {/* ── 8. 底部操作栏 ── */}
      <View className='bottom-bar'>
        <View className='icon-btn' onClick={handleContact}>
          <Text className='icon-btn__icon'>💬</Text>
          <Text className='icon-btn__text'>客服</Text>
        </View>
        <View className='icon-btn' onClick={handleFavorite}>
          <Text className='icon-btn__icon'>{isFavorite ? '♥' : '♡'}</Text>
          <Text className='icon-btn__text'>收藏</Text>
        </View>
        <View className='btn-add-cart' onClick={handleAddCart}>
          加入购物车
        </View>
        <View className='btn-buy' onClick={handleBuyNow}>
          立即购买
        </View>
      </View>
    </View>
  );
};

export default ProductDetail;
