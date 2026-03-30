/**
 * SPIKE-001: 百炼 Qwen tool_call 最小验证
 *
 * 验证目标：
 * 1. 格式兼容性 — Qwen 返回的 tool_call 是否符合 OpenAI 格式
 * 2. 参数准确性 — 自然语言能否正确映射到函数参数
 * 3. 多工具选择 — 多个工具定义时能否选对
 *
 * 运行方式：
 *   在项目根目录运行：
 *   DASHSCOPE_API_KEY=sk-xxx npx tsx scripts/spike-001-tool-call.ts
 *
 *   或配置好 .env 后：
 *   npx tsx scripts/spike-001-tool-call.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

// 加载 .env（从项目根目录）
config({ path: resolve(import.meta.dirname ?? '.', '../packages/backend/.env') });
config({ path: resolve(import.meta.dirname ?? '.', '../.env') });

const API_KEY = process.env['DASHSCOPE_API_KEY'];
const BASE_URL = process.env['DASHSCOPE_BASE_URL'] ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = process.env['DASHSCOPE_MODEL'] ?? 'qwen-plus';

if (!API_KEY) {
  console.error('❌ DASHSCOPE_API_KEY 未配置');
  console.error('   请设置环境变量或在 .env 文件中配置');
  process.exit(1);
}

console.log(`\n🔧 SPIKE-001: 百炼 Qwen tool_call 验证`);
console.log(`   模型: ${MODEL}`);
console.log(`   API: ${BASE_URL}`);
console.log('');

// ─── 工具定义（模拟 MallAdapter 的 5 个工具）──────────────

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'getSalesStats',
      description: '查询指定日期范围的销售统计，包括总金额、订单数、平均客单价',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '开始日期，格式 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期，格式 YYYY-MM-DD' },
        },
        required: ['startDate', 'endDate'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getTopSuppliers',
      description: '获取排名前N的供应商，可按订单量或金额排序',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['orderCount', 'amount'], description: '排序指标' },
          limit: { type: 'number', description: '返回数量，默认10' },
        },
        required: ['metric'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getOrders',
      description: '查询订单列表，支持按日期、状态、供应商筛选',
      parameters: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: '页码' },
          pageSize: { type: 'number', description: '每页数量' },
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          status: { type: 'number', description: '订单状态' },
          supplierId: { type: 'number', description: '供应商ID' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getUsers',
      description: '查询用户列表，支持按关键字和等级筛选',
      parameters: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: '页码' },
          pageSize: { type: 'number', description: '每页数量' },
          keyword: { type: 'string', description: '搜索关键字' },
          levelId: { type: 'number', description: '用户等级ID' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getItems',
      description: '查询商品列表，支持按关键字和上下架状态筛选',
      parameters: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: '页码' },
          pageSize: { type: 'number', description: '每页数量' },
          keyword: { type: 'string', description: '搜索关键字' },
          isShelf: { type: 'boolean', description: '是否上架' },
        },
      },
    },
  },
];

// ─── 测试用例 ────────────────────────────────────────────

interface TestCase {
  name: string;
  userMessage: string;
  expectedTool: string;
  validateArgs?: (args: Record<string, unknown>) => boolean;
}

const testCases: TestCase[] = [
  {
    name: '测试1: 销售统计 — 日期参数填充',
    userMessage: '这个月销售额多少？',
    expectedTool: 'getSalesStats',
    validateArgs: (args) => {
      const start = args['startDate'] as string;
      const end = args['endDate'] as string;
      return typeof start === 'string' && typeof end === 'string'
        && start.match(/^\d{4}-\d{2}-\d{2}$/) !== null
        && end.match(/^\d{4}-\d{2}-\d{2}$/) !== null;
    },
  },
  {
    name: '测试2: 供应商排行 — enum参数选择',
    userMessage: '哪个供应商出货量最大？给我前5名',
    expectedTool: 'getTopSuppliers',
    validateArgs: (args) => {
      return args['metric'] === 'orderCount' && (args['limit'] === 5 || args['limit'] === undefined);
    },
  },
  {
    name: '测试3: 多工具选择 — 用户查询',
    userMessage: '帮我查一下叫张三的用户',
    expectedTool: 'getUsers',
    validateArgs: (args) => {
      return typeof args['keyword'] === 'string' && args['keyword'].includes('张三');
    },
  },
  {
    name: '测试4: 多工具选择 — 商品查询',
    userMessage: '有哪些下架的商品？',
    expectedTool: 'getItems',
    validateArgs: (args) => {
      return args['isShelf'] === false;
    },
  },
  {
    name: '测试5: 订单查询 — 复合条件',
    userMessage: '查一下3月份供应商201的订单',
    expectedTool: 'getOrders',
    validateArgs: (args) => {
      return args['supplierId'] === 201
        && typeof args['startDate'] === 'string'
        && typeof args['endDate'] === 'string';
    },
  },
];

// ─── API 调用 ────────────────────────────────────────────

interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function callWithTools(userMessage: string): Promise<ChatResponse> {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: '你是企业AI工作站的助手。用户问业务问题时，调用对应的工具函数查询数据。今天是2026年3月30日。',
        },
        { role: 'user', content: userMessage },
      ],
      tools,
      tool_choice: 'auto',
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body}`);
  }

  return response.json() as Promise<ChatResponse>;
}

// ─── 执行验证 ────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  toolSelected: string | null;
  args: Record<string, unknown> | null;
  error?: string;
  finishReason?: string;
  rawToolCalls?: ToolCall[];
}

async function runTest(tc: TestCase): Promise<TestResult> {
  try {
    const resp = await callWithTools(tc.userMessage);
    const choice = resp.choices[0];

    if (!choice) {
      return { name: tc.name, passed: false, toolSelected: null, args: null, error: 'No choices in response' };
    }

    const toolCalls = choice.message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return {
        name: tc.name,
        passed: false,
        toolSelected: null,
        args: null,
        error: `No tool_call returned (finish_reason: ${choice.finish_reason}, content: ${choice.message.content?.slice(0, 100)})`,
        finishReason: choice.finish_reason,
      };
    }

    const firstCall = toolCalls[0];
    if (!firstCall) {
      return { name: tc.name, passed: false, toolSelected: null, args: null, error: 'tool_calls array empty' };
    }

    const toolName = firstCall.function.name;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(firstCall.function.arguments);
    } catch {
      return {
        name: tc.name,
        passed: false,
        toolSelected: toolName,
        args: null,
        error: `Invalid JSON in arguments: ${firstCall.function.arguments}`,
        rawToolCalls: toolCalls,
      };
    }

    const toolCorrect = toolName === tc.expectedTool;
    const argsValid = tc.validateArgs ? tc.validateArgs(args) : true;

    return {
      name: tc.name,
      passed: toolCorrect && argsValid,
      toolSelected: toolName,
      args,
      error: !toolCorrect
        ? `Expected tool '${tc.expectedTool}', got '${toolName}'`
        : !argsValid
          ? `Arguments validation failed`
          : undefined,
      finishReason: choice.finish_reason,
      rawToolCalls: toolCalls,
    };
  } catch (err) {
    return {
      name: tc.name,
      passed: false,
      toolSelected: null,
      args: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const results: TestResult[] = [];
  let passCount = 0;

  for (const tc of testCases) {
    process.stdout.write(`⏳ ${tc.name}...`);
    const result = await runTest(tc);
    results.push(result);

    if (result.passed) {
      passCount++;
      console.log(` ✅ PASS`);
      console.log(`   工具: ${result.toolSelected}`);
      console.log(`   参数: ${JSON.stringify(result.args)}`);
    } else {
      console.log(` ❌ FAIL`);
      console.log(`   错误: ${result.error}`);
      if (result.toolSelected) console.log(`   工具: ${result.toolSelected}`);
      if (result.args) console.log(`   参数: ${JSON.stringify(result.args)}`);
    }
    console.log('');
  }

  // ─── 结论 ──────────────────────────────────────────────

  console.log('═══════════════════════════════════════════════');
  console.log(`📊 结果: ${passCount}/${testCases.length} 通过`);
  console.log('');

  if (passCount === testCases.length) {
    console.log('✅ 结论: Qwen tool_call 完全可用');
    console.log('   - 格式兼容 OpenAI tool_call 标准');
    console.log('   - 参数填充准确');
    console.log('   - 多工具选择正确');
    console.log('   → Phase 1b AI对话引擎可以直接使用 tool_call');
  } else if (passCount >= 3) {
    console.log('⚠️ 结论: Qwen tool_call 基本可用，但有不稳定场景');
    console.log('   → Phase 1b 需要增加 tool_call 结果校验和重试逻辑');
  } else {
    console.log('❌ 结论: Qwen tool_call 不可靠');
    console.log('   → Phase 1b 需要改用 prompt-based 工具路由（类似Qiyao方案）');
  }

  console.log('');
  console.log('详细结果:');
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`);
    if (r.rawToolCalls) {
      console.log(`     raw: ${JSON.stringify(r.rawToolCalls)}`);
    }
  }
}

main().catch((err) => {
  console.error('💥 Spike 执行失败:', err);
  process.exit(1);
});
