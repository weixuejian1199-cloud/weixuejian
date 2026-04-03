import { View, Image, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

interface ProductCardProps {
  id: string;
  name: string;
  image: string;
  price: number;
  originalPrice?: number;
  sold?: number;
  tags?: Array<{ text: string; type: 'quality' | 'promo' | 'new' | 'vip' }>;
}

export default function ProductCard({
  id,
  name,
  image,
  price,
  originalPrice,
  sold,
  tags,
}: ProductCardProps) {
  const handleClick = () => {
    Taro.navigateTo({ url: `/pages/product/detail?id=${id}` });
  };

  return (
    <View className="product-card" onClick={handleClick}>
      <Image className="product-card__img" src={image} mode="aspectFill" lazyLoad />
      {tags && tags.length > 0 && (
        <View className="product-card__tags">
          {tags.map((tag) => (
            <Text key={tag.text} className={`tag tag--${tag.type}`}>
              {tag.text}
            </Text>
          ))}
        </View>
      )}
      <View className="product-card__info">
        <Text className="product-card__name">{name}</Text>
        <View className="product-card__price-row">
          <Text className="price price--md">
            <Text className="yen">¥</Text>
            {price}
          </Text>
          {originalPrice && <Text className="price-original">¥{originalPrice}</Text>}
        </View>
        {sold !== undefined && (
          <Text className="product-card__sold">已售 {sold.toLocaleString()}</Text>
        )}
      </View>
    </View>
  );
}
