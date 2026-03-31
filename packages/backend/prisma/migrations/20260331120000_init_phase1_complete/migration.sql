-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('master', 'finance', 'operation', 'settlement', 'report', 'customer_service', 'system', 'tool');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'tool', 'system');

-- CreateEnum
CREATE TYPE "CSSessionStatus" AS ENUM ('ai_handling', 'ai_judging', 'pending_human_review', 'escalated', 'human_queue', 'human_handling', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "CSMessageSender" AS ENUM ('buyer', 'ai', 'human_agent');

-- CreateEnum
CREATE TYPE "CSTicketType" AS ENUM ('refund', 'exchange', 'return_goods', 'complaint', 'other');

-- CreateEnum
CREATE TYPE "CSTicketStatus" AS ENUM ('pending', 'ai_judging', 'awaiting_human_confirmation', 'approved', 'rejected', 'processing', 'completed');

-- CreateEnum
CREATE TYPE "AciDecision" AS ENUM ('APPROVE', 'REJECT', 'REJECT_WITH_APPEAL', 'ESCALATE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('taobao', 'jd', 'douyin', 'pinduoduo', 'wechat', 'self');

-- CreateEnum
CREATE TYPE "ErpType" AS ENUM ('jushuitan', 'wangdiantong', 'ztdy_open', 'manual');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('full', 'incremental', 'manual');

-- CreateEnum
CREATE TYPE "SyncEntity" AS ENUM ('order', 'product', 'user', 'supplier');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('pending', 'running', 'success', 'failed', 'partial');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('wechat', 'alipay', 'bank', 'balance');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'processing', 'success', 'failed', 'refunding', 'refunded', 'closed');

-- CreateEnum
CREATE TYPE "AfterSaleType" AS ENUM ('return_refund', 'refund_only', 'exchange');

-- CreateEnum
CREATE TYPE "AfterSaleStatus" AS ENUM ('as_pending', 'ai_judged', 'human_review', 'approved', 'rejected', 'as_processing', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ToolCategory" AS ENUM ('health', 'finance', 'operation', 'cs', 'analytics');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "DepartmentStatus" AS ENUM ('dept_active', 'dept_inactive');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planExpiresAt" TIMESTAMP(3),
    "maxUsers" INTEGER NOT NULL DEFAULT 10,
    "maxShops" INTEGER NOT NULL DEFAULT 5,
    "aiQuotaMonthly" INTEGER NOT NULL DEFAULT 1000,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "wechatOpenid" TEXT,
    "wecomUserid" TEXT,
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "dataScope" TEXT NOT NULL DEFAULT 'own',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "title" TEXT,
    "contextSummary" TEXT,
    "tokenUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolResults" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_service_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "buyerName" TEXT,
    "orderId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "status" "CSSessionStatus" NOT NULL DEFAULT 'ai_handling',
    "assignedUserId" TEXT,
    "aiSummary" TEXT,
    "satisfaction" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_service_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_service_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sender" "CSMessageSender" NOT NULL,
    "content" TEXT NOT NULL,
    "msgType" TEXT NOT NULL DEFAULT 'text',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_service_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_service_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "orderId" TEXT,
    "afterSaleId" TEXT,
    "aiJudgmentId" TEXT,
    "type" "CSTicketType" NOT NULL,
    "aiDecision" JSONB NOT NULL,
    "humanDecision" JSONB,
    "humanReviewedAt" TIMESTAMP(3),
    "humanComments" TEXT,
    "status" "CSTicketStatus" NOT NULL DEFAULT 'pending',
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_service_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_judgment_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "ticketId" TEXT,
    "orderId" TEXT,
    "userId" TEXT NOT NULL,
    "judgmentType" TEXT NOT NULL,
    "decision" "AciDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "reasonForCustomer" TEXT,
    "riskLevel" "RiskLevel" NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "triggeredRules" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "executionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "disclaimer" TEXT,
    "processingTimeMs" INTEGER,
    "modelUsed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_judgment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "path" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "DepartmentStatus" NOT NULL DEFAULT 'dept_active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_shops" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'operator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "user_shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformShopId" TEXT NOT NULL,
    "status" "ShopStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "erpType" "ErpType" NOT NULL,
    "name" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "syncConfig" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSyncAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "erp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "erpConnectionId" TEXT NOT NULL,
    "syncType" "SyncType" NOT NULL,
    "entity" "SyncEntity" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'pending',
    "recordsTotal" INTEGER NOT NULL DEFAULT 0,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderSource" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "transactionId" TEXT,
    "gatewayResponse" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderSource" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AfterSaleType" NOT NULL,
    "status" "AfterSaleStatus" NOT NULL DEFAULT 'as_pending',
    "reason" TEXT,
    "aiJudgmentId" TEXT,
    "humanReviewerId" TEXT,
    "humanDecision" TEXT,
    "refundAmount" DECIMAL(12,2),
    "refundPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "after_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" "ToolCategory" NOT NULL,
    "version" TEXT NOT NULL,
    "configSchema" JSONB,
    "permissions" TEXT[],
    "modelConfig" JSONB,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tool_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_instances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "toolDefinitionId" TEXT NOT NULL,
    "config" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tool_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_phone_key" ON "users"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_code_key" ON "roles"("tenantId", "code");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenantId_userId_idx" ON "refresh_tokens"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenantId_tokenHash_idx" ON "refresh_tokens"("tenantId", "tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenantId_expiresAt_idx" ON "refresh_tokens"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "conversations_tenantId_userId_createdAt_idx" ON "conversations"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_tenantId_userId_idx" ON "messages"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_userId_action_idx" ON "audit_logs"("tenantId", "userId", "action");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_isRead_idx" ON "notifications"("tenantId", "userId", "isRead");

-- CreateIndex
CREATE INDEX "customer_service_sessions_tenantId_status_idx" ON "customer_service_sessions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "customer_service_sessions_tenantId_channelType_externalUser_idx" ON "customer_service_sessions"("tenantId", "channelType", "externalUserId");

-- CreateIndex
CREATE INDEX "customer_service_sessions_tenantId_createdAt_idx" ON "customer_service_sessions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_service_messages_sessionId_createdAt_idx" ON "customer_service_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_service_messages_tenantId_createdAt_idx" ON "customer_service_messages"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_service_tickets_tenantId_status_idx" ON "customer_service_tickets"("tenantId", "status");

-- CreateIndex
CREATE INDEX "customer_service_tickets_tenantId_sessionId_idx" ON "customer_service_tickets"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "customer_service_tickets_tenantId_aiJudgmentId_idx" ON "customer_service_tickets"("tenantId", "aiJudgmentId");

-- CreateIndex
CREATE INDEX "ai_judgment_records_tenantId_createdAt_idx" ON "ai_judgment_records"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_judgment_records_tenantId_judgmentType_createdAt_idx" ON "ai_judgment_records"("tenantId", "judgmentType", "createdAt");

-- CreateIndex
CREATE INDEX "ai_judgment_records_tenantId_decision_idx" ON "ai_judgment_records"("tenantId", "decision");

-- CreateIndex
CREATE INDEX "ai_judgment_records_tenantId_orderId_idx" ON "ai_judgment_records"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "ai_judgment_records_tenantId_sessionId_idx" ON "ai_judgment_records"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "ai_judgment_records_tenantId_riskLevel_createdAt_idx" ON "ai_judgment_records"("tenantId", "riskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "ai_judgment_records_tenantId_confidence_createdAt_idx" ON "ai_judgment_records"("tenantId", "confidence", "createdAt");

-- CreateIndex
CREATE INDEX "departments_tenantId_path_idx" ON "departments"("tenantId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_name_parentId_key" ON "departments"("tenantId", "name", "parentId");

-- CreateIndex
CREATE INDEX "user_shops_tenantId_shopId_idx" ON "user_shops"("tenantId", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "user_shops_tenantId_userId_shopId_key" ON "user_shops"("tenantId", "userId", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "shops_tenantId_platformShopId_key" ON "shops"("tenantId", "platformShopId");

-- CreateIndex
CREATE UNIQUE INDEX "erp_connections_tenantId_erpType_name_key" ON "erp_connections"("tenantId", "erpType", "name");

-- CreateIndex
CREATE INDEX "sync_logs_tenantId_erpConnectionId_idx" ON "sync_logs"("tenantId", "erpConnectionId");

-- CreateIndex
CREATE INDEX "sync_logs_tenantId_status_idx" ON "sync_logs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "payments_tenantId_orderId_idx" ON "payments"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "payments_tenantId_status_createdAt_idx" ON "payments"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_transactionId_key" ON "payments"("tenantId", "transactionId");

-- CreateIndex
CREATE INDEX "after_sales_tenantId_orderId_idx" ON "after_sales"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "after_sales_tenantId_userId_status_idx" ON "after_sales"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "after_sales_tenantId_status_createdAt_idx" ON "after_sales"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "tool_definitions_tenantId_idx" ON "tool_definitions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tool_definitions_tenantId_name_version_key" ON "tool_definitions"("tenantId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "tool_instances_tenantId_toolDefinitionId_key" ON "tool_instances"("tenantId", "toolDefinitionId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_service_sessions" ADD CONSTRAINT "customer_service_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_service_sessions" ADD CONSTRAINT "customer_service_sessions_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_service_messages" ADD CONSTRAINT "customer_service_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_service_messages" ADD CONSTRAINT "customer_service_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "customer_service_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_service_tickets" ADD CONSTRAINT "customer_service_tickets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_service_tickets" ADD CONSTRAINT "customer_service_tickets_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "customer_service_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_service_tickets" ADD CONSTRAINT "customer_service_tickets_aiJudgmentId_fkey" FOREIGN KEY ("aiJudgmentId") REFERENCES "ai_judgment_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_judgment_records" ADD CONSTRAINT "ai_judgment_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_judgment_records" ADD CONSTRAINT "ai_judgment_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "customer_service_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_judgment_records" ADD CONSTRAINT "ai_judgment_records_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "customer_service_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_judgment_records" ADD CONSTRAINT "ai_judgment_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_connections" ADD CONSTRAINT "erp_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_erpConnectionId_fkey" FOREIGN KEY ("erpConnectionId") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales" ADD CONSTRAINT "after_sales_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales" ADD CONSTRAINT "after_sales_aiJudgmentId_fkey" FOREIGN KEY ("aiJudgmentId") REFERENCES "ai_judgment_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_definitions" ADD CONSTRAINT "tool_definitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_instances" ADD CONSTRAINT "tool_instances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_instances" ADD CONSTRAINT "tool_instances_toolDefinitionId_fkey" FOREIGN KEY ("toolDefinitionId") REFERENCES "tool_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

