import { create } from 'zustand';
import Taro from '@tarojs/taro';

export type MemberLevel = 'MEMBER' | 'VIP' | 'VIC';

interface UserState {
  isLoggedIn: boolean;
  phone: string;
  name: string;
  avatar: string;
  level: MemberLevel;
  points: number;
  totalConsumption: number;
  isRecommender: boolean;
  recommenderCode: string;
  referrerId: string | null;

  setUser: (user: Partial<UserState>) => void;
  logout: () => void;
  checkLogin: () => boolean;
}

export const useUserStore = create<UserState>((set, get) => ({
  isLoggedIn: false,
  phone: '',
  name: '',
  avatar: '',
  level: 'MEMBER',
  points: 0,
  totalConsumption: 0,
  isRecommender: false,
  recommenderCode: '',
  referrerId: null,

  setUser: (user) => set((state) => ({ ...state, ...user, isLoggedIn: true })),

  logout: () => {
    Taro.removeStorageSync('access_token');
    Taro.removeStorageSync('refresh_token');
    set({
      isLoggedIn: false,
      phone: '',
      name: '',
      avatar: '',
      level: 'MEMBER',
      points: 0,
      totalConsumption: 0,
      isRecommender: false,
      recommenderCode: '',
      referrerId: null,
    });
  },

  checkLogin: () => {
    const token = Taro.getStorageSync('access_token');
    return !!token;
  },
}));
