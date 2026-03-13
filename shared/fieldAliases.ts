/**
 * ATLAS V3.0 — 全局字段映射表
 * ─────────────────────────────────────────────────────────────────
 * A 阶段交付物 A1：30 个标准字段 × 4 平台（抖音/天猫/拼多多/京东）
 *
 * 设计原则：
 *   1. 映射表按"标准字段名 → 平台字段名列表"的结构组织
 *   2. 映射优先级：精确匹配 > 映射表匹配 > 用户确认
 *   3. 新遇到的未知字段，记录到日志，不自动猜测
 *   4. 映射表可迭代扩展，但已有映射不可随意修改（修改需走变更审批）
 *   5. 语义等价字段在映射表中显式声明
 *
 * 冻结规则：本文件经 A 阶段验收后冻结，后续只允许新增标准字段，不允许修改已有映射。
 */

// ── 标准字段定义 ──────────────────────────────────────────────────

export type FieldType = "string" | "number" | "integer" | "datetime";

export interface StandardField {
  /** 标准字段名（英文，代码中使用） */
  name: string;
  /** 中文显示名（导出 Excel 列名） */
  displayName: string;
  /** 字段类型 */
  type: FieldType;
  /** 字段说明 */
  description: string;
  /** 各平台的别名列表 */
  aliases: {
    /** 通用别名（跨平台通用） */
    common: string[];
    /** 抖音平台字段名 */
    douyin: string[];
    /** 天猫/淘宝平台字段名 */
    tmall: string[];
    /** 拼多多平台字段名 */
    pdd: string[];
    /** 京东平台字段名 */
    jd: string[];
  };
}

// ── 30 个标准字段定义 ──────────────────────────────────────────────

export const STANDARD_FIELDS: StandardField[] = [
  // ── 订单基础信息（1-6）──────────────────────────────────────────
  {
    name: "order_id",
    displayName: "订单编号",
    type: "string",
    description: "订单唯一标识",
    aliases: {
      common: ["订单号", "订单编号", "订单ID"],
      douyin: ["订单号", "子订单号", "主订单号", "订单编号"],
      tmall: ["订单编号", "子订单编号", "交易订单号", "订单号"],
      pdd: ["订单号", "订单编号", "商家订单号"],
      jd: ["订单编号", "订单号", "订单ID"],
    },
  },
  {
    name: "order_time",
    displayName: "下单时间",
    type: "datetime",
    description: "订单创建时间",
    aliases: {
      common: ["下单时间", "订单时间", "创建时间"],
      douyin: ["订单创建时间", "下单时间", "创建时间", "订单提交时间"],
      tmall: ["订单创建时间", "创建时间", "拍下时间", "下单时间"],
      pdd: ["订单创建时间", "下单时间", "成团时间"],
      jd: ["下单时间", "订单创建时间", "下单日期"],
    },
  },
  {
    name: "pay_time",
    displayName: "付款时间",
    type: "datetime",
    description: "订单付款时间",
    aliases: {
      common: ["付款时间", "支付时间"],
      douyin: ["支付时间", "付款时间", "支付完成时间"],
      tmall: ["付款时间", "支付时间", "买家付款时间"],
      pdd: ["支付时间", "付款时间"],
      jd: ["付款时间", "支付时间", "付款确认时间"],
    },
  },
  {
    name: "pay_amount",
    displayName: "实付金额",
    type: "number",
    description: "买家实际支付金额",
    aliases: {
      common: ["实付金额", "付款金额", "支付金额", "实付"],
      douyin: ["订单应付金额", "实付金额", "商品金额", "订单金额", "实际支付金额", "商品实付"],
      tmall: ["实付金额", "买家实付", "实收金额", "订单实付金额", "实际支付金额"],
      pdd: ["实付金额", "商品金额", "实际支付金额", "订单金额"],
      jd: ["实付金额", "订单金额", "应付金额", "实际支付金额"],
    },
  },
  {
    name: "product_name",
    displayName: "商品名称",
    type: "string",
    description: "商品标题/名称",
    aliases: {
      common: ["商品名称", "商品标题", "商品名", "产品名称"],
      douyin: ["商品标题", "商品名称", "商品名", "选购商品"],
      tmall: ["商品标题", "宝贝标题", "商品名称", "宝贝名称"],
      pdd: ["商品名称", "商品标题", "商品名"],
      jd: ["商品名称", "商品标题", "SKU名称"],
    },
  },
  {
    name: "sku_id",
    displayName: "SKU编号",
    type: "string",
    description: "SKU唯一标识",
    aliases: {
      common: ["SKU编号", "商品编码", "SKU", "商品ID"],
      douyin: ["商品ID", "SKU编号", "商品编码", "货品编码"],
      tmall: ["商品编号", "宝贝ID", "SKU编号", "商品ID"],
      pdd: ["商品编号", "SKU编号", "商品ID", "货品编码"],
      jd: ["商品编号", "SKU编号", "商品ID", "SKU ID"],
    },
  },

  // ── 数量与金额（7-12）──────────────────────────────────────────
  {
    name: "quantity",
    displayName: "购买数量",
    type: "integer",
    description: "购买件数",
    aliases: {
      common: ["数量", "购买数量", "购买件数", "件数"],
      douyin: ["数量", "购买件数", "商品数量", "购买数量"],
      tmall: ["购买数量", "宝贝数量", "数量", "商品数量"],
      pdd: ["商品数量", "数量", "购买数量"],
      jd: ["商品数量", "数量", "购买数量", "购买件数"],
    },
  },
  {
    name: "unit_price",
    displayName: "商品单价",
    type: "number",
    description: "商品单价",
    aliases: {
      common: ["单价", "商品单价", "商品价格"],
      douyin: ["商品单价", "单价", "商品价格"],
      tmall: ["商品价格", "单价", "宝贝单价"],
      pdd: ["商品单价", "单价", "商品价格"],
      jd: ["单价", "商品单价", "京东价"],
    },
  },
  {
    name: "refund_amount",
    displayName: "退款金额",
    type: "number",
    description: "退款金额",
    aliases: {
      common: ["退款金额", "退款总额", "退款"],
      douyin: ["退款金额", "退款总额", "售后退款金额"],
      tmall: ["退款金额", "退款总额", "退款总金额"],
      pdd: ["退款金额", "退款总额"],
      jd: ["退款金额", "退款总额", "退款总金额"],
    },
  },
  {
    name: "refund_status",
    displayName: "退款状态",
    type: "string",
    description: "退款/售后状态",
    aliases: {
      common: ["退款状态", "售后状态"],
      douyin: ["售后状态", "退款状态", "退货退款状态"],
      tmall: ["退款状态", "售后状态", "退款/退货状态"],
      pdd: ["售后状态", "退款状态"],
      jd: ["售后状态", "退款状态", "退换货状态"],
    },
  },
  {
    name: "order_status",
    displayName: "订单状态",
    type: "string",
    description: "订单当前状态",
    aliases: {
      common: ["订单状态", "状态"],
      douyin: ["订单状态", "订单阶段"],
      tmall: ["订单状态", "交易状态", "订单阶段"],
      pdd: ["订单状态", "售后状态"],
      jd: ["订单状态", "订单阶段"],
    },
  },
  {
    name: "discount_amount",
    displayName: "优惠金额",
    type: "number",
    description: "优惠/折扣金额",
    aliases: {
      common: ["优惠金额", "折扣金额", "优惠"],
      douyin: ["优惠金额", "平台优惠", "商家优惠", "达人优惠"],
      tmall: ["优惠金额", "卖家优惠", "平台优惠", "折扣金额"],
      pdd: ["优惠金额", "平台优惠", "商家优惠"],
      jd: ["优惠金额", "促销优惠", "优惠合计"],
    },
  },

  // ── 店铺与平台（13-15）──────────────────────────────────────────
  {
    name: "store_name",
    displayName: "店铺名称",
    type: "string",
    description: "店铺名称",
    aliases: {
      common: ["店铺名称", "店铺", "店铺名", "商家名称"],
      douyin: ["店铺名称", "店铺", "商家名称", "小店名称"],
      tmall: ["店铺名称", "卖家昵称", "店铺名", "商家名称"],
      pdd: ["店铺名称", "店铺名", "商家名称"],
      jd: ["店铺名称", "商家名称", "店铺名"],
    },
  },
  {
    name: "platform",
    displayName: "平台名称",
    type: "string",
    description: "来源平台（自动识别）",
    aliases: {
      common: ["平台", "平台名称", "来源平台", "渠道"],
      douyin: ["平台"],
      tmall: ["平台"],
      pdd: ["平台"],
      jd: ["平台"],
    },
  },
  {
    name: "talent_name",
    displayName: "达人名称",
    type: "string",
    description: "达人/推广者名称",
    aliases: {
      common: ["达人名称", "达人昵称", "达人", "推广者"],
      douyin: ["达人昵称", "达人名称", "推广达人", "分销达人", "达人"],
      tmall: ["淘客昵称", "推广者", "达人昵称"],
      pdd: ["推广者", "达人昵称", "推广达人"],
      jd: ["推广者", "达人昵称", "联盟达人"],
    },
  },

  // ── 收货信息（16-19）──────────────────────────────────────────
  {
    name: "province",
    displayName: "省份",
    type: "string",
    description: "收货省份",
    aliases: {
      common: ["省份", "省", "收货省份"],
      douyin: ["收货省份", "省份", "省"],
      tmall: ["收货地址省", "省份", "收件人省份"],
      pdd: ["省份", "收货省份", "省"],
      jd: ["省份", "收货省份", "收件人省"],
    },
  },
  {
    name: "city",
    displayName: "城市",
    type: "string",
    description: "收货城市",
    aliases: {
      common: ["城市", "市", "收货城市"],
      douyin: ["收货城市", "城市", "市"],
      tmall: ["收货地址市", "城市", "收件人城市"],
      pdd: ["城市", "收货城市", "市"],
      jd: ["城市", "收货城市", "收件人市"],
    },
  },
  {
    name: "receiver_name",
    displayName: "收件人",
    type: "string",
    description: "收件人姓名",
    aliases: {
      common: ["收件人", "收货人", "收件人姓名"],
      douyin: ["收件人", "收货人", "收件人姓名"],
      tmall: ["收货人姓名", "收件人", "买家姓名"],
      pdd: ["收件人", "收货人姓名", "收货人"],
      jd: ["收货人", "收件人姓名", "收件人"],
    },
  },
  {
    name: "receiver_phone",
    displayName: "收件人电话",
    type: "string",
    description: "收件人手机号",
    aliases: {
      common: ["手机号", "电话", "联系电话", "收件人电话"],
      douyin: ["收件人手机号", "联系电话", "手机号"],
      tmall: ["联系手机", "手机号码", "收货人手机"],
      pdd: ["收件人手机", "手机号", "联系电话"],
      jd: ["手机号", "联系电话", "收货人电话"],
    },
  },

  // ── 物流信息（20-22）──────────────────────────────────────────
  {
    name: "logistics_no",
    displayName: "物流单号",
    type: "string",
    description: "快递/物流单号",
    aliases: {
      common: ["物流单号", "快递单号", "运单号"],
      douyin: ["快递单号", "物流编号", "运单号", "物流单号"],
      tmall: ["运单号", "物流单号", "快递单号"],
      pdd: ["快递单号", "物流单号", "运单号"],
      jd: ["运单号", "物流单号", "快递单号"],
    },
  },
  {
    name: "logistics_company",
    displayName: "物流公司",
    type: "string",
    description: "快递/物流公司名称",
    aliases: {
      common: ["物流公司", "快递公司", "承运商"],
      douyin: ["快递公司", "物流公司", "承运商"],
      tmall: ["物流公司", "快递公司"],
      pdd: ["快递公司", "物流公司"],
      jd: ["快递公司", "物流公司", "承运商"],
    },
  },
  {
    name: "ship_time",
    displayName: "发货时间",
    type: "datetime",
    description: "商家发货时间",
    aliases: {
      common: ["发货时间", "发货日期"],
      douyin: ["发货时间", "发货日期", "商家发货时间"],
      tmall: ["发货时间", "卖家发货时间"],
      pdd: ["发货时间", "商家发货时间"],
      jd: ["发货时间", "出库时间"],
    },
  },

  // ── 支付信息（23-24）──────────────────────────────────────────
  {
    name: "pay_method",
    displayName: "支付方式",
    type: "string",
    description: "支付方式/渠道",
    aliases: {
      common: ["支付方式", "付款方式", "支付渠道"],
      douyin: ["支付方式", "付款方式", "支付渠道"],
      tmall: ["支付方式", "付款方式"],
      pdd: ["支付方式", "付款方式"],
      jd: ["支付方式", "付款方式", "支付渠道"],
    },
  },
  {
    name: "buyer_id",
    displayName: "买家ID",
    type: "string",
    description: "买家账号/ID",
    aliases: {
      common: ["买家ID", "买家账号", "用户ID", "会员ID"],
      douyin: ["买家ID", "用户ID", "买家昵称"],
      tmall: ["买家会员名", "买家昵称", "买家ID"],
      pdd: ["买家ID", "用户ID"],
      jd: ["用户账号", "买家ID", "客户账号"],
    },
  },

  // ── 佣金与费用（25-27）──────────────────────────────────────────
  {
    name: "commission",
    displayName: "佣金",
    type: "number",
    description: "平台/达人佣金",
    aliases: {
      common: ["佣金", "佣金金额", "推广佣金"],
      douyin: ["达人佣金", "佣金", "推广佣金", "佣金金额", "技术服务费"],
      tmall: ["佣金", "淘客佣金", "推广佣金"],
      pdd: ["佣金", "推广佣金", "佣金金额"],
      jd: ["佣金", "推广佣金", "联盟佣金"],
    },
  },
  {
    name: "platform_fee",
    displayName: "平台服务费",
    type: "number",
    description: "平台收取的服务费/技术服务费",
    aliases: {
      common: ["平台服务费", "技术服务费", "服务费"],
      douyin: ["技术服务费", "平台服务费", "平台扣点"],
      tmall: ["技术服务费", "平台服务费", "佣金"],
      pdd: ["技术服务费", "平台服务费"],
      jd: ["平台服务费", "技术服务费", "扣点"],
    },
  },
  {
    name: "settlement_amount",
    displayName: "结算金额",
    type: "number",
    description: "商家实际到手金额",
    aliases: {
      common: ["结算金额", "到手金额", "商家实收"],
      douyin: ["结算金额", "商家实收", "预估结算金额"],
      tmall: ["结算金额", "卖家实收", "商家实收金额"],
      pdd: ["结算金额", "商家实收"],
      jd: ["结算金额", "商家实收", "货款"],
    },
  },

  // ── 备注与扩展（28-30）──────────────────────────────────────────
  {
    name: "buyer_remark",
    displayName: "买家备注",
    type: "string",
    description: "买家留言/备注",
    aliases: {
      common: ["买家备注", "买家留言", "备注"],
      douyin: ["买家备注", "买家留言"],
      tmall: ["买家留言", "买家备注"],
      pdd: ["买家备注", "买家留言"],
      jd: ["买家备注", "买家留言", "订单备注"],
    },
  },
  {
    name: "seller_remark",
    displayName: "卖家备注",
    type: "string",
    description: "商家备注/标记",
    aliases: {
      common: ["卖家备注", "商家备注", "卖家留言"],
      douyin: ["商家备注", "卖家备注"],
      tmall: ["卖家备注", "商家备注"],
      pdd: ["商家备注", "卖家备注"],
      jd: ["商家备注", "卖家备注"],
    },
  },
  {
    name: "complete_time",
    displayName: "完成时间",
    type: "datetime",
    description: "订单完成/确认收货时间",
    aliases: {
      common: ["完成时间", "确认收货时间", "交易完成时间"],
      douyin: ["确认收货时间", "完成时间", "交易完成时间"],
      tmall: ["确认收货时间", "交易完成时间", "完成时间"],
      pdd: ["确认收货时间", "完成时间"],
      jd: ["完成时间", "确认收货时间", "交易完成时间"],
    },
  },
];

// ── 字段映射引擎 ──────────────────────────────────────────────────

/**
 * 构建反向索引：别名 → 标准字段名
 * 用于 O(1) 查找
 */
function buildAliasIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const field of STANDARD_FIELDS) {
    // 标准字段名本身也是别名
    index.set(field.name, field.name);
    index.set(field.displayName, field.name);
    // 所有平台别名
    const { common, douyin, tmall, pdd, jd } = field.aliases;
    for (const alias of [...common, ...douyin, ...tmall, ...pdd, ...jd]) {
      const normalized = alias.trim().toLowerCase();
      // 如果已存在映射，保留第一个（优先级更高的字段）
      if (!index.has(normalized)) {
        index.set(normalized, field.name);
      }
    }
  }
  return index;
}

const ALIAS_INDEX = buildAliasIndex();

/**
 * 将任意字段名映射为标准字段名。
 * 匹配策略：精确匹配（大小写不敏感）→ 映射表匹配 → 返回 null（未知字段）
 *
 * @param rawFieldName 原始字段名
 * @returns 标准字段名，或 null 表示未匹配
 */
export function normalizeFieldName(rawFieldName: string): string | null {
  const normalized = rawFieldName.trim().toLowerCase();
  return ALIAS_INDEX.get(normalized) ?? null;
}

/**
 * 批量映射字段名。
 * 返回映射结果和未匹配的字段列表。
 *
 * @param rawFieldNames 原始字段名数组
 * @returns { mapped: Record<原始名, 标准名>, unmapped: string[] }
 */
export function normalizeFieldNames(rawFieldNames: string[]): {
  mapped: Record<string, string>;
  unmapped: string[];
} {
  const mapped: Record<string, string> = {};
  const unmapped: string[] = [];

  for (const raw of rawFieldNames) {
    const standard = normalizeFieldName(raw);
    if (standard) {
      mapped[raw] = standard;
    } else {
      unmapped.push(raw);
    }
  }

  return { mapped, unmapped };
}

/**
 * 获取标准字段的中文显示名。
 * 用于导出 Excel 列名。
 */
export function getDisplayName(standardFieldName: string): string {
  const field = STANDARD_FIELDS.find(f => f.name === standardFieldName);
  return field?.displayName ?? standardFieldName;
}

/**
 * 获取标准字段的类型定义。
 */
export function getFieldType(standardFieldName: string): FieldType | null {
  const field = STANDARD_FIELDS.find(f => f.name === standardFieldName);
  return field?.type ?? null;
}

// ── 平台识别 ──────────────────────────────────────────────────────

export type Platform = "douyin" | "tmall" | "pdd" | "jd" | "unknown";

/**
 * 根据文件表头字段名自动识别来源平台。
 * 策略：统计每个平台的独有字段命中数，取最高分。
 */
export function detectPlatform(headerFields: string[]): Platform {
  const scores: Record<Platform, number> = {
    douyin: 0,
    tmall: 0,
    pdd: 0,
    jd: 0,
    unknown: 0,
  };

  // 平台独有字段关键词
  const platformSignatures: Record<Exclude<Platform, "unknown">, string[]> = {
    douyin: ["达人昵称", "小店名称", "抖音", "订单应付金额", "商品实付", "达人佣金", "选购商品"],
    tmall: ["买家会员名", "宝贝标题", "宝贝数量", "天猫", "淘宝", "卖家昵称", "旺旺", "淘客"],
    pdd: ["拼多多", "成团时间", "商家编码", "拼单"],
    jd: ["京东", "京东价", "PLUS", "联盟达人"],
  };

  const normalizedHeaders = headerFields.map(h => h.trim().toLowerCase());

  for (const [platform, signatures] of Object.entries(platformSignatures)) {
    for (const sig of signatures) {
      const sigLower = sig.toLowerCase();
      for (const header of normalizedHeaders) {
        if (header.includes(sigLower)) {
          scores[platform as Platform]++;
        }
      }
    }
  }

  // 取最高分平台
  let bestPlatform: Platform = "unknown";
  let bestScore = 0;
  for (const [platform, score] of Object.entries(scores)) {
    if (platform !== "unknown" && score > bestScore) {
      bestScore = score;
      bestPlatform = platform as Platform;
    }
  }

  return bestScore >= 2 ? bestPlatform : "unknown";
}
