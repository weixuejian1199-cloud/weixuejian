export default defineAppConfig({
  pages: [
    // Tab pages
    'pages/home/index',
    'pages/category/index',
    'pages/cart/index',
    'pages/my/index',
    // Auth
    'pages/login/index',
    // Product
    'pages/product/detail',
    // Order flow
    'pages/order/confirm',
    'pages/order/result',
    'pages/order/list',
    'pages/order/detail',
    'pages/order/logistics',
    // Recommend
    'pages/recommend/index',
    'pages/recommend/activate',
    'pages/recommend/earnings',
    'pages/recommend/withdraw',
    'pages/recommend/poster',
    // Member
    'pages/member/checkin',
    'pages/member/points',
    'pages/member/coupons',
    // My sub-pages
    'pages/my/address',
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#FAFAF7',
    navigationBarTitleText: '时皙life',
    navigationBarTextStyle: 'black',
    backgroundColor: '#FAFAF7',
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#1A1A1A',
    backgroundColor: '#FAFAF7',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
        iconPath: 'assets/tab/home.png',
        selectedIconPath: 'assets/tab/home-active.png',
      },
      {
        pagePath: 'pages/category/index',
        text: '品类',
        iconPath: 'assets/tab/category.png',
        selectedIconPath: 'assets/tab/category-active.png',
      },
      {
        pagePath: 'pages/cart/index',
        text: '购物车',
        iconPath: 'assets/tab/cart.png',
        selectedIconPath: 'assets/tab/cart-active.png',
      },
      {
        pagePath: 'pages/my/index',
        text: '我的',
        iconPath: 'assets/tab/my.png',
        selectedIconPath: 'assets/tab/my-active.png',
      },
    ],
  },
});
