import { describe, it, expect } from 'vitest';
import {
  ztdyEnvelopeSchema,
  rawUserSchema,
  rawOrderSchema,
  rawItemSchema,
  rawSupplierSchema,
  rawSupplierWithdrawSchema,
  rawUserWithdrawSchema,
  userFilterSchema,
  orderFilterSchema,
  itemFilterSchema,
  supplierFilterSchema,
  withdrawFilterSchema,
} from '../../adapters/erp/schemas.js';

describe('ztdyEnvelopeSchema', () => {
  it('should parse valid envelope', () => {
    const valid = {
      Data: { PageIndex: 1, PageSize: 20, TotalCount: 100, PageData: [] },
      Status: 1,
      Message: null,
      Code: 0,
    };
    expect(ztdyEnvelopeSchema.parse(valid)).toBeDefined();
  });

  it('should transform boolean Status to number', () => {
    const withBoolStatus = {
      Data: { PageIndex: 1, PageSize: 20, TotalCount: 0, PageData: [] },
      Status: true,
      Message: null,
      Code: 0,
    };
    const result = ztdyEnvelopeSchema.parse(withBoolStatus);
    expect(result.Status).toBe(1);
  });

  it('should transform false Status to 0', () => {
    const withFalseStatus = {
      Data: { PageIndex: 1, PageSize: 20, TotalCount: 0, PageData: [] },
      Status: false,
      Message: null,
      Code: 0,
    };
    const result = ztdyEnvelopeSchema.parse(withFalseStatus);
    expect(result.Status).toBe(0);
  });

  it('should reject missing Data', () => {
    expect(() => ztdyEnvelopeSchema.parse({ Status: 1, Message: null, Code: 0 })).toThrow();
  });
});

describe('rawUserSchema', () => {
  it('should parse valid user', () => {
    const user = { UserID: 1, LoginID: 'test', UserName: '张三' };
    expect(rawUserSchema.parse(user)).toBeDefined();
  });

  it('should allow nullable optional fields', () => {
    const minimal = { UserID: 1 };
    expect(rawUserSchema.parse(minimal)).toBeDefined();
  });

  it('should reject missing UserID', () => {
    expect(() => rawUserSchema.parse({ LoginID: 'test' })).toThrow();
  });
});

describe('rawOrderSchema', () => {
  it('should parse valid order', () => {
    const order = {
      OrderItemID: 1,
      OrderItemNo: 'ORD001',
      UserID: 100,
      SupplierID: 50,
      ProcessNode: 2,
      TotalAmount: 99.9,
    };
    expect(rawOrderSchema.parse(order)).toBeDefined();
  });

  it('should default Number to 1 and Status to 0', () => {
    const order = {
      OrderItemID: 1,
      OrderItemNo: 'X',
      UserID: 1,
      SupplierID: 1,
      ProcessNode: 0,
      TotalAmount: 0,
    };
    const result = rawOrderSchema.parse(order);
    expect(result.Number).toBe(1);
    expect(result.Status).toBe(0);
  });

  it('should reject missing required fields', () => {
    expect(() => rawOrderSchema.parse({ OrderItemID: 1 })).toThrow();
  });
});

describe('rawItemSchema', () => {
  it('should parse valid item', () => {
    const item = { ItemID: 1, ItemName: '产品A', IsShelf: true };
    expect(rawItemSchema.parse(item)).toBeDefined();
  });

  it('should transform numeric IsShelf 1 to true', () => {
    const item = { ItemID: 1, ItemName: '产品A', IsShelf: 1 };
    const result = rawItemSchema.parse(item);
    expect(result.IsShelf).toBe(true);
  });

  it('should transform IsShelf 0 to false', () => {
    const item = { ItemID: 1, ItemName: '产品A', IsShelf: 0 };
    const result = rawItemSchema.parse(item);
    expect(result.IsShelf).toBe(false);
  });
});

describe('rawSupplierSchema', () => {
  it('should parse valid supplier', () => {
    const supplier = { SupplierID: 1, SupplierName: '供应商A' };
    expect(rawSupplierSchema.parse(supplier)).toBeDefined();
  });

  it('should reject missing SupplierName', () => {
    expect(() => rawSupplierSchema.parse({ SupplierID: 1 })).toThrow();
  });
});

describe('rawSupplierWithdrawSchema', () => {
  it('should parse valid withdraw', () => {
    const w = { SupplierID: 1, PayNo: 'PAY001', TranAmount: 100, Status: 1 };
    expect(rawSupplierWithdrawSchema.parse(w)).toBeDefined();
  });
});

describe('rawUserWithdrawSchema', () => {
  it('should parse valid user withdraw', () => {
    const w = { UserID: 1, PayNo: 'PAY002', Award: 50, Status: 1 };
    expect(rawUserWithdrawSchema.parse(w)).toBeDefined();
  });
});

// Filter schemas
describe('filter schemas', () => {
  it('userFilterSchema should have defaults', () => {
    const result = userFilterSchema.parse({});
    expect(result.pageIndex).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('orderFilterSchema should accept date range', () => {
    const result = orderFilterSchema.parse({ startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(result.startDate).toBe('2026-01-01');
  });

  it('itemFilterSchema should accept keyword and isShelf', () => {
    const result = itemFilterSchema.parse({ keyword: '面膜', isShelf: true });
    expect(result.keyword).toBe('面膜');
    expect(result.isShelf).toBe(true);
  });

  it('supplierFilterSchema should accept keyword', () => {
    const result = supplierFilterSchema.parse({ keyword: '供应商' });
    expect(result.keyword).toBe('供应商');
  });

  it('withdrawFilterSchema should accept status filter', () => {
    const result = withdrawFilterSchema.parse({ status: 1 });
    expect(result.status).toBe(1);
  });

  it('should reject invalid pageSize', () => {
    expect(() => orderFilterSchema.parse({ pageSize: 0 })).toThrow();
    expect(() => orderFilterSchema.parse({ pageSize: 1001 })).toThrow();
  });
});
