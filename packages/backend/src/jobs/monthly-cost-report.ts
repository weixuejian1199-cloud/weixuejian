/**
 * 月度 AI 成本报告任务 (BL-022)
 *
 * 每月1日执行：聚合上月用量，生成结构化报告日志 + Notification。
 * 自用阶段：仅日志输出。SaaS 扩展时可增加 PDF/邮件。
 */
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { getMonthlyReport } from '../services/ai/cost-service.js';

/**
 * 获取上个月的 YYYY-MM 字符串
 */
export function getPreviousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 生成月度报告摘要文本
 */
export function formatReportSummary(report: {
  month: string;
  summary: { totalTokens: number; totalCostYuan: number; requestCount: number; usagePercent: number };
}): string {
  const s = report.summary;
  return [
    `📊 ${report.month} AI成本月报`,
    `总请求: ${s.requestCount}次`,
    `总Token: ${s.totalTokens.toLocaleString()}`,
    `总成本: ¥${s.totalCostYuan.toFixed(2)}`,
    `配额使用率: ${s.usagePercent.toFixed(1)}%`,
  ].join(' | ');
}

/**
 * 执行月度成本报告
 */
export async function generateMonthlyCostReport(): Promise<void> {
  const start = Date.now();
  const month = getPreviousMonth();
  logger.info({ month }, 'Monthly cost report generation started');

  try {
    // 获取所有活跃租户
    const tenants = await prisma.tenant.findMany({
      where: { status: 'active', deletedAt: null },
      select: { id: true, name: true },
    });

    for (const tenant of tenants) {
      try {
        const report = await getMonthlyReport(tenant.id, month);

        // 跳过无用量的租户
        if (report.summary.requestCount === 0) {
          logger.debug({ tenantId: tenant.id, month }, 'Skipping tenant with no AI usage');
          continue;
        }

        const summaryText = formatReportSummary(report);

        // 结构化日志输出（Grafana/Loki 可检索）
        logger.info({
          tenantId: tenant.id,
          tenantName: tenant.name,
          month,
          totalTokens: report.summary.totalTokens,
          totalCostYuan: report.summary.totalCostYuan,
          requestCount: report.summary.requestCount,
          usagePercent: report.summary.usagePercent,
          topAgent: report.byAgent[0]?.key ?? 'none',
          modelCount: report.modelBreakdown.length,
        }, summaryText);

        // 创建站内通知（给租户管理员）
        const admins = await prisma.user.findMany({
          where: {
            tenantId: tenant.id,
            status: 'active',
            deletedAt: null,
            role: { code: 'admin' },
          },
          select: { id: true },
        });

        for (const admin of admins) {
          await prisma.notification.create({
            data: {
              tenantId: tenant.id,
              userId: admin.id,
              type: 'ai_cost_report',
              channel: 'system',
              title: `${month} AI成本月报`,
              content: summaryText,
            },
          });
        }
      } catch (err) {
        logger.error({ err, tenantId: tenant.id, month }, 'Failed to generate cost report for tenant');
      }
    }

    logger.info({ duration: Date.now() - start, tenantCount: tenants.length, month }, 'Monthly cost report generation completed');
  } catch (err) {
    logger.error({ err, duration: Date.now() - start }, 'Monthly cost report generation failed');
  }
}
