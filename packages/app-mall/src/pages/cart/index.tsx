import { useEffect } from 'react';
import { View, Text, Image, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useCartStore, type CartItem } from '../../stores/cart';
import './index.scss';

// Mock recommended products
const RECOMMEND_LIST = [
  { id: 'r1', name: '多肽焕颜紧致面霜', image: '', price: 328 },
  { id: 'r2', name: '复合益生菌冻干粉', image: '', price: 158 },
  { id: 'r3', name: '玻尿酸修复精华水', image: '', price: 198 },
];

// Initialize mock cart data
const MOCK_CART_ITEMS: CartItem[] = [
  {
    id: 'c1',
    productId: 'p1',
    skuId: 'sku-p1-30ml',
    name: 'CEBRENIS 黄金双因抗老精华液',
    spec: '30ml 标准装',
    price: 299,
    image: '',
    quantity: 1,
    checked: true,
    stock: 99,
  },
  {
    id: 'c2',
    productId: 'f1',
    skuId: 'sku-f1-250g',
    name: '云南凤庆古树滇红茶 蜜香金芽',
    spec: '250g 罐装',
    price: 68,
    image: '',
    quantity: 2,
    checked: true,
    stock: 50,
  },
  {
    id: 'c3',
    productId: 'p4',
    skuId: 'sku-p4-120ml',
    name: '温和氨基酸洁面乳 敏肌适用',
    spec: '120ml',
    price: 89,
    image: '',
    quantity: 1,
    checked: false,
    stock: 30,
  },
];

const BG_CLASSES = ['warm', 'cool', 'rose'];

export default function CartPage() {
  const {
    items,
    addItem,
    toggleCheck,
    toggleCheckAll,
    updateQuantity,
    removeItem,
    totalPrice,
    totalCount,
  } = useCartStore();

  // Seed mock data on first mount when store is empty
  useEffect(() => {
    if (items.length === 0) {
      MOCK_CART_ITEMS.forEach((item) => {
        const { checked, ...rest } = item;
        addItem(rest);
      });
      // Uncheck third item to match mock
      setTimeout(() => {
        const state = useCartStore.getState();
        const third = state.items[2];
        if (third && third.checked) {
          useCartStore.getState().toggleCheck(third.id);
        }
      }, 0);
    }
  }, []);

  const allChecked = items.length > 0 && items.every((i) => i.checked);
  const checkedCount = totalCount();
  const total = totalPrice();

  const handleProductTap = (productId: string) => {
    Taro.navigateTo({ url: `/pages/product/detail?id=${productId}` });
  };

  const handleCheckout = () => {
    if (checkedCount === 0) {
      Taro.showToast({ title: '请选择商品', icon: 'none' });
      return;
    }
    Taro.showToast({ title: '去结算', icon: 'none' });
  };

  return (
    <View className="cart-page">
      <ScrollView className="cart-scroll" scrollY enhanced showScrollbar={false}>
        {/* Promo banner */}
        {total > 0 && (
          <View className="cart-promo">
            <Text className="promo-icon">{'\uD83C\uDF81'}</Text>
            <Text className="promo-text">
              再买 &yen;{Math.max(0, 299 - total)} 可用满299减30优惠券
            </Text>
            <Text className="promo-action">去凑单 &gt;</Text>
          </View>
        )}

        {/* Cart items */}
        <View className="cart-list">
          {items.map((item, index) => (
            <View className="cart-item" key={item.id}>
              <View
                className={`cart-checkbox ${item.checked ? 'checked' : ''}`}
                onClick={() => toggleCheck(item.id)}
              />
              <View
                className={`cart-img ${BG_CLASSES[index % BG_CLASSES.length]}`}
                onClick={() => handleProductTap(item.productId)}
              >
                {item.image ? (
                  <Image className="cart-img__pic" src={item.image} mode="aspectFill" />
                ) : (
                  <Text className="cart-img__placeholder">
                    {item.name.slice(0, 4)}
                  </Text>
                )}
              </View>
              <View className="cart-details">
                <Text
                  className="cart-name"
                  onClick={() => handleProductTap(item.productId)}
                >
                  {item.name}
                </Text>
                <Text className="cart-spec">{item.spec}</Text>
                <View className="cart-bottom">
                  <Text className="cart-price">
                    <Text className="yen">&yen;</Text>
                    {item.price}
                  </Text>
                  <View className="qty-control">
                    <View
                      className={`qty-btn ${item.quantity <= 1 ? 'disabled' : ''}`}
                      onClick={() => {
                        if (item.quantity > 1) updateQuantity(item.id, item.quantity - 1);
                      }}
                    >
                      <Text className="qty-btn__text">&minus;</Text>
                    </View>
                    <Text className="qty-value">{item.quantity}</Text>
                    <View
                      className={`qty-btn ${item.quantity >= item.stock ? 'disabled' : ''}`}
                      onClick={() => {
                        if (item.quantity < item.stock)
                          updateQuantity(item.id, item.quantity + 1);
                      }}
                    >
                      <Text className="qty-btn__text">+</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Empty state */}
        {items.length === 0 && (
          <View className="cart-empty">
            <Text className="cart-empty__text">购物车空空如也</Text>
            <Text className="cart-empty__sub">去逛逛吧</Text>
          </View>
        )}

        {/* Recommended */}
        <View className="like-section">
          <Text className="like-header">猜你喜欢</Text>
          <ScrollView className="like-scroll" scrollX enhanced showScrollbar={false}>
            {RECOMMEND_LIST.map((item) => (
              <View
                key={item.id}
                className="like-card"
                onClick={() => handleProductTap(item.id)}
              >
                <View className="like-img">
                  <Text className="like-img__placeholder">{item.name.slice(0, 4)}</Text>
                </View>
                <View className="like-info">
                  <Text className="like-name">{item.name}</Text>
                  <Text className="like-price">&yen;{item.price}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </ScrollView>

      {/* Bottom checkout bar */}
      <View className="checkout-bar">
        <View className="select-all" onClick={toggleCheckAll}>
          <View className={`cart-checkbox checkout-checkbox ${allChecked ? 'checked' : ''}`} />
          <Text className="select-all-text">全选</Text>
        </View>
        <View className="checkout-total">
          <Text className="total-label">合计 </Text>
          <Text className="total-price">
            <Text className="yen">&yen;</Text>
            {total.toFixed(0)}
          </Text>
        </View>
        <View className="checkout-btn" onClick={handleCheckout}>
          <Text className="checkout-btn__text">
            结算{checkedCount > 0 ? `(${checkedCount})` : ''}
          </Text>
        </View>
      </View>
    </View>
  );
}
