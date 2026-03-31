/**
 * FAQ 知识库匹配器 — 纯函数
 *
 * Phase 1: 硬编码 FAQ 列表 + 关键词匹配
 * Phase 2: 升级为语义匹配(embedding)
 */

import type { FaqEntry, FaqMatch } from './types.js';

// ─── 硬编码 FAQ 库 ──────────────────────────────────────

const FAQ_ENTRIES: FaqEntry[] = [
  // 物流类
  {
    id: 'faq-01',
    keywords: ['发货', '什么时候发', '几天发'],
    synonyms: ['啥时候发', '多久发'],
    question: '什么时候发货？',
    answer: '一般在付款后48小时内发货，遇节假日顺延。您可以在订单详情查看物流状态。',
    category: 'shipping',
  },
  {
    id: 'faq-02',
    keywords: ['快递', '物流', '到哪了', '运单'],
    synonyms: ['包裹', '发到哪了', '物流信息'],
    question: '快递到哪了？',
    answer: '请提供您的订单号，我来帮您查询最新物流信息。',
    category: 'shipping',
  },
  {
    id: 'faq-03',
    keywords: ['配送', '送货', '派送'],
    synonyms: ['送到', '上门'],
    question: '配送范围和时效？',
    answer: '目前支持全国配送，一般3-7个工作日送达，偏远地区可能稍慢。',
    category: 'shipping',
  },

  // 退货类（触发 ACI 判断）
  {
    id: 'faq-04',
    keywords: ['退货', '退款', '不想要'],
    synonyms: ['退回去', '退掉', '不要了', '怎么退'],
    question: '怎么退货？',
    answer: '我来帮您查看订单情况，判断是否符合退货条件。',
    category: 'return',
  },
  {
    id: 'faq-05',
    keywords: ['换货', '换一个', '换个'],
    synonyms: ['能换吗', '想换'],
    question: '可以换货吗？',
    answer: '收到商品7天内可以申请换货，我来帮您看一下订单状态。',
    category: 'return',
  },
  {
    id: 'faq-06',
    keywords: ['质量', '坏了', '破损', '有问题'],
    synonyms: ['瑕疵', '损坏', '不好'],
    question: '收到的商品有质量问题怎么办？',
    answer: '非常抱歉给您带来不便，请拍照描述问题，我来帮您处理。',
    category: 'return',
  },

  // 支付类
  {
    id: 'faq-07',
    keywords: ['付款', '支付', '怎么付'],
    synonyms: ['付钱', '买单'],
    question: '支持哪些支付方式？',
    answer: '支持微信支付、支付宝等主流支付方式。',
    category: 'payment',
  },
  {
    id: 'faq-08',
    keywords: ['发票', '开票', '开发票'],
    synonyms: ['票据'],
    question: '可以开发票吗？',
    answer: '可以的，请在下单时备注开票信息，或联系客服补开。',
    category: 'payment',
  },

  // 商品类
  {
    id: 'faq-09',
    keywords: ['成分', '配料', '含有'],
    synonyms: ['有什么成分', '原料'],
    question: '商品成分是什么？',
    answer: '具体成分请查看商品详情页，如有过敏原顾虑请提前咨询。',
    category: 'product',
  },
  {
    id: 'faq-10',
    keywords: ['保质期', '过期', '有效期'],
    synonyms: ['能放多久', '保质'],
    question: '商品保质期多长？',
    answer: '不同商品保质期不同，请查看包装标注。我们保证发货时至少留有2/3保质期。',
    category: 'product',
  },
  {
    id: 'faq-11',
    keywords: ['使用方法', '怎么用', '怎么吃'],
    synonyms: ['用法', '食用方法'],
    question: '商品怎么使用？',
    answer: '请参考商品详情页的使用说明，如有疑问随时咨询。',
    category: 'product',
  },
  {
    id: 'faq-12',
    keywords: ['有货', '库存', '缺货', '补货'],
    synonyms: ['还有吗', '什么时候有'],
    question: '商品有货吗？',
    answer: '请告诉我您想要的商品名称，我帮您查询库存情况。',
    category: 'product',
  },

  // 账户类
  {
    id: 'faq-13',
    keywords: ['密码', '忘记密码', '改密码'],
    synonyms: ['登录不了'],
    question: '忘记密码怎么办？',
    answer: '您可以通过手机号验证码重置密码，在登录页点击"忘记密码"即可。',
    category: 'account',
  },
  {
    id: 'faq-14',
    keywords: ['优惠券', '折扣', '优惠'],
    synonyms: ['券', '打折'],
    question: '有什么优惠活动？',
    answer: '最新优惠活动请关注小程序首页，会员可享专属折扣。',
    category: 'general',
  },
  {
    id: 'faq-15',
    keywords: ['客服', '人工', '转人工'],
    synonyms: ['找人', '真人'],
    question: '可以转人工客服吗？',
    answer: '好的，我帮您转接人工客服，请稍等。',
    category: 'general',
  },
];

// ─── 匹配算法 ──────────────────────────────────────────

export function matchFaq(text: string): FaqMatch | null {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return null;

  let bestMatch: { entry: FaqEntry; score: number } | null = null;

  for (const entry of FAQ_ENTRIES) {
    let score = 0;
    const allKeywords = [...entry.keywords, ...(entry.synonyms ?? [])];

    for (const kw of allKeywords) {
      if (normalized.includes(kw)) {
        score += kw.length;
      }
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { entry, score };
    }
  }

  if (!bestMatch || bestMatch.score < 2) return null;

  return {
    faqId: bestMatch.entry.id,
    question: bestMatch.entry.question,
    answer: bestMatch.entry.answer,
    category: bestMatch.entry.category,
    confidence: Math.min(bestMatch.score / 10, 1.0),
    isReturnRelated: bestMatch.entry.category === 'return',
  };
}

/** 获取 FAQ 条目数量（用于测试验证） */
export function getFaqCount(): number {
  return FAQ_ENTRIES.length;
}
