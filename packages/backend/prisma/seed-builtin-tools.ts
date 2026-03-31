/**
 * 种子脚本：为所有租户注册并激活9个内置工具
 *
 * 用法: npx tsx packages/backend/prisma/seed-builtin-tools.ts
 * 幂等：多次运行结果相同
 */
import { PrismaClient } from '@prisma/client';

// 直接创建 PrismaClient 避免导入 env.ts 的全量校验
const prisma = new PrismaClient();

// 内联内置工具种子（避免导入链触发 env 校验）
const BUILTIN_SEEDS = [
  { name: 'getSalesStats',              displayName: '销售统计查询',   category: 'analytics' as const, description: '查询指定日期范围的销售统计' },
  { name: 'getTopSuppliers',            displayName: '供应商排行榜',   category: 'analytics' as const, description: '查询供应商排行榜' },
  { name: 'getOrderStatusDistribution', displayName: '订单状态分布',   category: 'analytics' as const, description: '查询订单状态分布' },
  { name: 'getOrders',                  displayName: '订单列表查询',   category: 'operation' as const, description: '查询订单列表明细' },
  { name: 'getUsers',                   displayName: '用户列表查询',   category: 'operation' as const, description: '查询用户列表' },
  { name: 'getItems',                   displayName: '商品列表查询',   category: 'operation' as const, description: '查询商品列表' },
  { name: 'getSlowSuppliers',           displayName: '慢发货供应商',   category: 'analytics' as const, description: '查询出货最慢的供应商' },
  { name: 'getUserGrowthTrend',         displayName: '用户增长趋势',   category: 'analytics' as const, description: '查询用户增长趋势' },
  { name: 'getSupplierWithdraws',       displayName: '供应商提现记录', category: 'finance'   as const, description: '查询供应商提现记录' },
];

async function main() {
  console.log('🌱 Seeding built-in tools...\n');

  // 获取所有活跃租户
  const tenants = await prisma.tenant.findMany({
    where: { status: 'active', deletedAt: null },
    select: { id: true, name: true },
  });

  console.log(`Found ${tenants.length} active tenant(s)\n`);

  for (const tenant of tenants) {
    console.log(`── Tenant: ${tenant.name} (${tenant.id})`);

    for (const seed of BUILTIN_SEEDS) {
      // Upsert ToolDefinition
      const def = await prisma.toolDefinition.upsert({
        where: {
          tenantId_name_version: {
            tenantId: tenant.id,
            name: seed.name,
            version: '1.0.0',
          },
        },
        update: {
          displayName: seed.displayName,
          description: seed.description,
          category: seed.category,
          isBuiltin: true,
          deletedAt: null,
        },
        create: {
          tenantId: tenant.id,
          name: seed.name,
          displayName: seed.displayName,
          description: seed.description,
          category: seed.category,
          version: '1.0.0',
          permissions: ['data:read'],
          isBuiltin: true,
        },
      });

      // Upsert ToolInstance (activate)
      await prisma.toolInstance.upsert({
        where: {
          tenantId_toolDefinitionId: {
            tenantId: tenant.id,
            toolDefinitionId: def.id,
          },
        },
        update: {
          status: 'active',
          deletedAt: null,
        },
        create: {
          tenantId: tenant.id,
          toolDefinitionId: def.id,
          status: 'active',
        },
      });
    }

    console.log(`   ✅ ${BUILTIN_SEEDS.length} tools seeded & activated\n`);
  }

  console.log('🎉 Done!');
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
