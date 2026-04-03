import { create } from 'zustand';

export interface CartItem {
  id: string;
  productId: string;
  skuId: string;
  name: string;
  spec: string;
  price: number;
  image: string;
  quantity: number;
  checked: boolean;
  stock: number;
}

interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'checked'>) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  toggleCheck: (id: string) => void;
  toggleCheckAll: () => void;
  clearChecked: () => void;
  checkedItems: () => CartItem[];
  totalPrice: () => number;
  totalCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],

  addItem: (item) =>
    set((state) => {
      const existing = state.items.find((i) => i.skuId === item.skuId);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.skuId === item.skuId ? { ...i, quantity: i.quantity + item.quantity } : i,
          ),
        };
      }
      return { items: [...state.items, { ...item, checked: true }] };
    }),

  removeItem: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

  updateQuantity: (id, quantity) =>
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, quantity) } : i)),
    })),

  toggleCheck: (id) =>
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)),
    })),

  toggleCheckAll: () =>
    set((state) => {
      const allChecked = state.items.every((i) => i.checked);
      return { items: state.items.map((i) => ({ ...i, checked: !allChecked })) };
    }),

  clearChecked: () => set((state) => ({ items: state.items.filter((i) => !i.checked) })),

  checkedItems: () => get().items.filter((i) => i.checked),

  totalPrice: () =>
    get()
      .items.filter((i) => i.checked)
      .reduce((sum, i) => sum + i.price * i.quantity, 0),

  totalCount: () =>
    get()
      .items.filter((i) => i.checked)
      .reduce((sum, i) => sum + i.quantity, 0),
}));
