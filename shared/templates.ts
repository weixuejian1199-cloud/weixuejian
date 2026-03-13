/**
 * ATLAS V3.0 — L1 模板计算公式定义
 * ─────────────────────────────────────────────────────────────────
 * A 阶段交付物 A6：4 个 L1 模板的必需字段、可选字段、计算公式
 *
 * L1 模板（首发必须交付，不可延期）：
 *   1. 多店合并
 *   2. 工资条
 *   3. 考勤汇总
 *   4. 利润统计
 *
 * 模板字段匹配逻辑复用字段映射表（fieldAliases.ts）。
 * 匹配不上的必需字段，提示用户手动指定。
 *
 * 冻结规则：本文件经 A 阶段验收后冻结。后续只允许新增模板，不允许修改已有模板的计算公式。
 */

// ── 模板定义类型 ──────────────────────────────────────────────────

export interface TemplateField {
  /** 标准字段名 */
  fieldName: string;
  /** 中文显示名 */
  displayName: string;
  /** 是否必需 */
  required: boolean;
  /** 字段类型 */
  type: "string" | "number" | "integer" | "datetime";
  /** 默认值（可选字段缺失时使用） */
  defaultValue?: string | number | null;
  /** 字段说明 */
  description: string;
  /** 该字段在模板中的别名（除全局映射表外的额外别名） */
  templateAliases?: string[];
}

export interface TemplateDefinition {
  /** 模板唯一 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板分类 */
  category: "finance" | "hr" | "operations" | "management";
  /** 模板级别 */
  level: "L1" | "L2" | "L3";
  /** 适用岗位 */
  targetRole: string;
  /** 模板说明 */
  description: string;
  /** 必需字段列表 */
  requiredFields: TemplateField[];
  /** 可选字段列表 */
  optionalFields: TemplateField[];
  /** 计算公式描述（人类可读） */
  formulas: TemplateFormula[];
  /** 导出 Excel 的列顺序 */
  exportColumns: string[];
  /** 导出文件名模板 */
  exportFileName: string;
}

export interface TemplateFormula {
  /** 公式名称 */
  name: string;
  /** 输出字段名 */
  outputField: string;
  /** 公式描述 */
  formula: string;
  /** 精度 */
  precision: number;
  /** 说明 */
  description: string;
}

// ── L1 模板定义 ──────────────────────────────────────────────────

/**
 * L1-01：多店合并模板
 * 适用岗位：出纳
 * 场景：多个店铺的订单/流水文件合并为一份，按店铺汇总
 */
export const TEMPLATE_MULTI_STORE_MERGE: TemplateDefinition = {
  id: "L1-01",
  name: "多店合并",
  category: "finance",
  level: "L1",
  targetRole: "出纳",
  description:
    "将多个店铺的订单/流水文件合并为一份统一报表，自动按店铺汇总条数和金额。",
  requiredFields: [
    {
      fieldName: "order_id",
      displayName: "订单编号",
      required: true,
      type: "string",
      description: "订单唯一标识，用于去重",
    },
    {
      fieldName: "pay_amount",
      displayName: "实付金额",
      required: true,
      type: "number",
      description: "每笔订单的实付金额",
    },
  ],
  optionalFields: [
    {
      fieldName: "store_name",
      displayName: "店铺名称",
      required: false,
      type: "string",
      description: "店铺名称，如果文件中没有，使用文件名作为店铺标识",
    },
    {
      fieldName: "order_time",
      displayName: "下单时间",
      required: false,
      type: "datetime",
      description: "下单时间，用于时间范围统计",
    },
    {
      fieldName: "platform",
      displayName: "平台",
      required: false,
      type: "string",
      description: "来源平台，自动识别",
    },
    {
      fieldName: "refund_status",
      displayName: "退款状态",
      required: false,
      type: "string",
      description: "退款状态，用于区分有效订单",
    },
    {
      fieldName: "product_name",
      displayName: "商品名称",
      required: false,
      type: "string",
      description: "商品名称",
    },
    {
      fieldName: "quantity",
      displayName: "数量",
      required: false,
      type: "integer",
      description: "购买数量",
    },
  ],
  formulas: [
    {
      name: "店铺订单数",
      outputField: "store_order_count",
      formula: "COUNT(DISTINCT order_id) GROUP BY store_name",
      precision: 0,
      description: "每个店铺的去重订单数",
    },
    {
      name: "店铺销售额",
      outputField: "store_sales",
      formula:
        "SUM(pay_amount) WHERE refund_status != '已退款' GROUP BY store_name",
      precision: 2,
      description: "每个店铺的有效销售额",
    },
    {
      name: "合计订单数",
      outputField: "total_order_count",
      formula: "SUM(store_order_count)",
      precision: 0,
      description: "所有店铺的订单总数",
    },
    {
      name: "合计销售额",
      outputField: "total_sales",
      formula: "SUM(store_sales)",
      precision: 2,
      description: "所有店铺的销售总额",
    },
  ],
  exportColumns: [
    "store_name",
    "platform",
    "order_id",
    "order_time",
    "product_name",
    "quantity",
    "pay_amount",
    "refund_status",
  ],
  exportFileName: "多店合并报表_{date}",
};

/**
 * L1-02：工资条模板
 * 适用岗位：HR
 * 场景：根据考勤和底薪数据，计算每人应发工资
 */
export const TEMPLATE_PAYROLL: TemplateDefinition = {
  id: "L1-02",
  name: "工资条",
  category: "hr",
  level: "L1",
  targetRole: "HR",
  description:
    "根据员工底薪、绩效、扣款等数据，自动计算每人应发工资和个税。",
  requiredFields: [
    {
      fieldName: "employee_name",
      displayName: "姓名",
      required: true,
      type: "string",
      description: "员工姓名",
      templateAliases: ["姓名", "员工姓名", "员工", "名字"],
    },
    {
      fieldName: "base_salary",
      displayName: "底薪",
      required: true,
      type: "number",
      description: "基本工资",
      templateAliases: ["底薪", "基本工资", "基本薪资", "月薪", "基础工资"],
    },
  ],
  optionalFields: [
    {
      fieldName: "performance_bonus",
      displayName: "绩效奖金",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "绩效奖金",
      templateAliases: ["绩效", "绩效奖金", "绩效工资", "奖金", "提成"],
    },
    {
      fieldName: "overtime_pay",
      displayName: "加班费",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "加班工资",
      templateAliases: ["加班费", "加班工资", "加班"],
    },
    {
      fieldName: "allowance",
      displayName: "补贴",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "各类补贴（交通、餐补、通讯等）",
      templateAliases: ["补贴", "津贴", "交通补贴", "餐补", "通讯补贴", "住房补贴"],
    },
    {
      fieldName: "deduction",
      displayName: "扣款",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "各类扣款（迟到、缺勤、罚款等）",
      templateAliases: ["扣款", "扣除", "罚款", "缺勤扣款"],
    },
    {
      fieldName: "social_insurance",
      displayName: "社保个人",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "社保个人缴纳部分",
      templateAliases: ["社保", "社保个人", "五险个人", "社保扣除"],
    },
    {
      fieldName: "housing_fund",
      displayName: "公积金个人",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "住房公积金个人缴纳部分",
      templateAliases: ["公积金", "公积金个人", "住房公积金"],
    },
  ],
  formulas: [
    {
      name: "应发合计",
      outputField: "gross_pay",
      formula: "base_salary + performance_bonus + overtime_pay + allowance",
      precision: 2,
      description: "税前应发工资总额",
    },
    {
      name: "扣除合计",
      outputField: "total_deduction",
      formula: "deduction + social_insurance + housing_fund",
      precision: 2,
      description: "所有扣除项合计",
    },
    {
      name: "应税所得",
      outputField: "taxable_income",
      formula: "gross_pay - total_deduction - 5000",
      precision: 2,
      description: "应纳税所得额（起征点 5000 元）",
    },
    {
      name: "个人所得税",
      outputField: "income_tax",
      formula: "按七级超额累进税率计算",
      precision: 2,
      description: "个人所得税（累进税率：3%/10%/20%/25%/30%/35%/45%）",
    },
    {
      name: "实发工资",
      outputField: "net_pay",
      formula: "gross_pay - total_deduction - income_tax",
      precision: 2,
      description: "扣税扣款后的实发金额",
    },
  ],
  exportColumns: [
    "employee_name",
    "base_salary",
    "performance_bonus",
    "overtime_pay",
    "allowance",
    "gross_pay",
    "deduction",
    "social_insurance",
    "housing_fund",
    "total_deduction",
    "taxable_income",
    "income_tax",
    "net_pay",
  ],
  exportFileName: "工资条_{month}月",
};

/**
 * L1-03：考勤汇总模板
 * 适用岗位：HR
 * 场景：根据打卡记录，统计每人的出勤、迟到、早退、缺勤情况
 */
export const TEMPLATE_ATTENDANCE: TemplateDefinition = {
  id: "L1-03",
  name: "考勤汇总",
  category: "hr",
  level: "L1",
  targetRole: "HR",
  description:
    "根据员工打卡记录，自动统计每人的出勤天数、迟到次数、早退次数、缺勤天数。",
  requiredFields: [
    {
      fieldName: "employee_name",
      displayName: "姓名",
      required: true,
      type: "string",
      description: "员工姓名",
      templateAliases: ["姓名", "员工姓名", "员工", "名字"],
    },
    {
      fieldName: "attendance_date",
      displayName: "日期",
      required: true,
      type: "datetime",
      description: "考勤日期",
      templateAliases: ["日期", "考勤日期", "打卡日期", "出勤日期"],
    },
  ],
  optionalFields: [
    {
      fieldName: "clock_in",
      displayName: "上班打卡",
      required: false,
      type: "string",
      description: "上班打卡时间",
      templateAliases: ["上班打卡", "签到时间", "上班时间", "到岗时间", "上班签到"],
    },
    {
      fieldName: "clock_out",
      displayName: "下班打卡",
      required: false,
      type: "string",
      description: "下班打卡时间",
      templateAliases: ["下班打卡", "签退时间", "下班时间", "离岗时间", "下班签退"],
    },
    {
      fieldName: "attendance_status",
      displayName: "考勤状态",
      required: false,
      type: "string",
      description: "出勤/迟到/早退/缺勤/请假等状态",
      templateAliases: ["状态", "考勤状态", "出勤状态", "考勤结果"],
    },
    {
      fieldName: "department",
      displayName: "部门",
      required: false,
      type: "string",
      description: "所属部门",
      templateAliases: ["部门", "所属部门", "部门名称"],
    },
    {
      fieldName: "work_hours",
      displayName: "工时",
      required: false,
      type: "number",
      description: "当日工作时长（小时）",
      templateAliases: ["工时", "工作时长", "出勤时长"],
    },
  ],
  formulas: [
    {
      name: "应出勤天数",
      outputField: "expected_days",
      formula: "COUNT(DISTINCT attendance_date) GROUP BY employee_name",
      precision: 0,
      description: "该员工在考勤记录中的总天数",
    },
    {
      name: "实际出勤天数",
      outputField: "actual_days",
      formula:
        "COUNT(attendance_date) WHERE attendance_status NOT IN ('缺勤','旷工','请假') GROUP BY employee_name",
      precision: 0,
      description: "排除缺勤和请假后的实际出勤天数",
    },
    {
      name: "迟到次数",
      outputField: "late_count",
      formula:
        "COUNT(*) WHERE clock_in > '09:00' OR attendance_status = '迟到' GROUP BY employee_name",
      precision: 0,
      description: "上班打卡晚于 09:00 或状态标记为迟到的次数",
    },
    {
      name: "早退次数",
      outputField: "early_leave_count",
      formula:
        "COUNT(*) WHERE clock_out < '18:00' OR attendance_status = '早退' GROUP BY employee_name",
      precision: 0,
      description: "下班打卡早于 18:00 或状态标记为早退的次数",
    },
    {
      name: "缺勤天数",
      outputField: "absent_days",
      formula:
        "COUNT(*) WHERE attendance_status IN ('缺勤','旷工') GROUP BY employee_name",
      precision: 0,
      description: "状态标记为缺勤或旷工的天数",
    },
    {
      name: "出勤率",
      outputField: "attendance_rate",
      formula: "actual_days / expected_days * 100",
      precision: 2,
      description: "实际出勤天数占应出勤天数的百分比",
    },
  ],
  exportColumns: [
    "employee_name",
    "department",
    "expected_days",
    "actual_days",
    "late_count",
    "early_leave_count",
    "absent_days",
    "attendance_rate",
  ],
  exportFileName: "考勤汇总_{month}月",
};

/**
 * L1-04：利润统计模板
 * 适用岗位：会计
 * 场景：根据收入和成本数据，计算利润
 */
export const TEMPLATE_PROFIT: TemplateDefinition = {
  id: "L1-04",
  name: "利润统计",
  category: "finance",
  level: "L1",
  targetRole: "会计",
  description:
    "根据销售收入、商品成本、平台费用等数据，自动计算毛利润和净利润。",
  requiredFields: [
    {
      fieldName: "pay_amount",
      displayName: "销售收入",
      required: true,
      type: "number",
      description: "订单实付金额（销售收入）",
      templateAliases: ["销售额", "收入", "实付金额", "销售收入"],
    },
  ],
  optionalFields: [
    {
      fieldName: "cost",
      displayName: "商品成本",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "商品采购/生产成本",
      templateAliases: ["成本", "商品成本", "采购成本", "进货价", "成本价"],
    },
    {
      fieldName: "platform_fee",
      displayName: "平台服务费",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "平台收取的技术服务费/佣金",
    },
    {
      fieldName: "commission",
      displayName: "达人佣金",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "达人/推广佣金",
    },
    {
      fieldName: "logistics_cost",
      displayName: "物流费用",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "快递/物流费用",
      templateAliases: ["物流费", "快递费", "运费", "物流费用", "运费成本"],
    },
    {
      fieldName: "refund_amount",
      displayName: "退款金额",
      required: false,
      type: "number",
      defaultValue: 0,
      description: "退款金额",
    },
    {
      fieldName: "store_name",
      displayName: "店铺名称",
      required: false,
      type: "string",
      description: "店铺名称，用于按店铺统计利润",
    },
    {
      fieldName: "product_name",
      displayName: "商品名称",
      required: false,
      type: "string",
      description: "商品名称，用于按商品统计利润",
    },
  ],
  formulas: [
    {
      name: "总收入",
      outputField: "total_revenue",
      formula: "SUM(pay_amount) WHERE refund_status != '已退款'",
      precision: 2,
      description: "扣除已退款订单后的总销售收入",
    },
    {
      name: "总成本",
      outputField: "total_cost",
      formula: "SUM(cost)",
      precision: 2,
      description: "商品成本合计",
    },
    {
      name: "毛利润",
      outputField: "gross_profit",
      formula: "total_revenue - total_cost",
      precision: 2,
      description: "收入减去商品成本",
    },
    {
      name: "毛利率",
      outputField: "gross_margin",
      formula: "gross_profit / total_revenue * 100",
      precision: 2,
      description: "毛利润占总收入的百分比",
    },
    {
      name: "总费用",
      outputField: "total_expenses",
      formula: "SUM(platform_fee) + SUM(commission) + SUM(logistics_cost)",
      precision: 2,
      description: "平台费 + 佣金 + 物流费",
    },
    {
      name: "净利润",
      outputField: "net_profit",
      formula: "gross_profit - total_expenses - SUM(refund_amount)",
      precision: 2,
      description: "毛利润减去所有费用和退款",
    },
    {
      name: "净利率",
      outputField: "net_margin",
      formula: "net_profit / total_revenue * 100",
      precision: 2,
      description: "净利润占总收入的百分比",
    },
  ],
  exportColumns: [
    "store_name",
    "total_revenue",
    "total_cost",
    "gross_profit",
    "gross_margin",
    "platform_fee",
    "commission",
    "logistics_cost",
    "total_expenses",
    "refund_amount",
    "net_profit",
    "net_margin",
  ],
  exportFileName: "利润统计报表_{date}",
};

// ── 模板注册表 ──────────────────────────────────────────────────

export const L1_TEMPLATES: TemplateDefinition[] = [
  TEMPLATE_MULTI_STORE_MERGE,
  TEMPLATE_PAYROLL,
  TEMPLATE_ATTENDANCE,
  TEMPLATE_PROFIT,
];

export const ALL_TEMPLATES: TemplateDefinition[] = [...L1_TEMPLATES];

/**
 * 根据模板 ID 获取模板定义。
 */
export function getTemplateById(
  templateId: string
): TemplateDefinition | undefined {
  return ALL_TEMPLATES.find(t => t.id === templateId);
}

/**
 * 根据模板名称获取模板定义（模糊匹配）。
 */
export function getTemplateByName(
  name: string
): TemplateDefinition | undefined {
  const normalized = name.trim();
  return ALL_TEMPLATES.find(
    t =>
      t.name === normalized ||
      t.name.includes(normalized) ||
      normalized.includes(t.name)
  );
}

/**
 * 检查上传文件的字段是否满足模板的必需字段要求。
 * 返回匹配结果和缺失字段。
 */
export function checkTemplateFieldMatch(
  template: TemplateDefinition,
  availableFields: string[]
): {
  matched: boolean;
  matchedFields: Record<string, string>;
  missingFields: string[];
} {
  const matchedFields: Record<string, string> = {};
  const missingFields: string[] = [];

  const availableLower = availableFields.map(f => f.trim().toLowerCase());

  for (const reqField of template.requiredFields) {
    let found = false;

    // 检查标准字段名
    if (availableLower.includes(reqField.fieldName.toLowerCase())) {
      matchedFields[reqField.fieldName] = reqField.fieldName;
      found = true;
    }

    // 检查模板别名
    if (!found && reqField.templateAliases) {
      for (const alias of reqField.templateAliases) {
        const idx = availableLower.indexOf(alias.toLowerCase());
        if (idx >= 0) {
          matchedFields[reqField.fieldName] = availableFields[idx];
          found = true;
          break;
        }
      }
    }

    // 检查中文显示名
    if (!found) {
      const idx = availableLower.indexOf(
        reqField.displayName.toLowerCase()
      );
      if (idx >= 0) {
        matchedFields[reqField.fieldName] = availableFields[idx];
        found = true;
      }
    }

    if (!found) {
      missingFields.push(reqField.displayName);
    }
  }

  return {
    matched: missingFields.length === 0,
    matchedFields,
    missingFields,
  };
}

// ── 个税计算（工资条模板专用）──────────────────────────────────────

/**
 * 七级超额累进税率表。
 * 适用于居民个人综合所得（月度）。
 */
const TAX_BRACKETS = [
  { min: 0, max: 3000, rate: 0.03, deduction: 0 },
  { min: 3000, max: 12000, rate: 0.1, deduction: 210 },
  { min: 12000, max: 25000, rate: 0.2, deduction: 1410 },
  { min: 25000, max: 35000, rate: 0.25, deduction: 2660 },
  { min: 35000, max: 55000, rate: 0.3, deduction: 4410 },
  { min: 55000, max: 80000, rate: 0.35, deduction: 7160 },
  { min: 80000, max: Infinity, rate: 0.45, deduction: 15160 },
];

/**
 * 计算个人所得税（月度简易计算）。
 * taxableIncome = 应发合计 - 扣除合计 - 5000（起征点）
 * 如果 taxableIncome <= 0，则不需要缴税。
 */
export function calculateIncomeTax(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;

  for (const bracket of TAX_BRACKETS) {
    if (taxableIncome <= bracket.max) {
      return Number(
        (taxableIncome * bracket.rate - bracket.deduction).toFixed(2)
      );
    }
  }

  // 超过最高档
  const last = TAX_BRACKETS[TAX_BRACKETS.length - 1];
  return Number(
    (taxableIncome * last.rate - last.deduction).toFixed(2)
  );
}
