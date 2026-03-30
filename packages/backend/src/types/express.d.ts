import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    user?: {
      userId: string;
      tenantId: string;
      role: string;
    };
    tenantId?: string;
  }
}
