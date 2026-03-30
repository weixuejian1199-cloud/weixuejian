import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';

import { logger } from './utils/logger.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { notFoundHandler, globalErrorHandler } from './middleware/error-handler.js';
import { basicHealthRouter, detailHealthRouter } from './routes/health.js';

config();

const app = express();
const PORT = process.env['PORT'] ?? 3000;

// 基础中间件
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);

// 路由挂载
app.use('/health', basicHealthRouter);
app.use('/api/v1/health', detailHealthRouter);

// 路由挂载点（后续 US 实现后启用）
// app.use('/api/v1/employee', employeeRouter);
// app.use('/api/v1/buyer', buyerRouter);
// app.use('/api/v1/admin', adminRouter);
// app.use('/webhook', webhookRouter);

// 404 兜底 + 全局错误处理（必须在所有路由之后）
app.use(notFoundHandler);
app.use(globalErrorHandler);

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server running');
});

export default app;
export { server };
