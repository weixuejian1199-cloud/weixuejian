import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';

config();

const app = express();
const PORT = process.env['PORT'] || 3000;

// 基础中间件
app.use(helmet());
app.use(cors());
app.use(express.json());

// 路由挂载点（US-P1a-005 实现健康检查后启用）
// app.use('/health', healthRouter);
// app.use('/api/v1/employee', employeeRouter);
// app.use('/api/v1/buyer', buyerRouter);
// app.use('/api/v1/admin', adminRouter);
// app.use('/webhook', webhookRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
