---
name: RPA数据桥梁决策
description: ADR-031 RPA只读数据采集替代API，管理员一次授权各岗位透明使用，聚水潭只有订单数据无财务数据
type: project
---

RPA数据桥梁方案(ADR-031)：用Playwright模拟浏览器采集各平台财务+运营数据，替代尚未开放的API。

**Why:** 聚水潭API只能获取订单数据，拿不到财务数据（结算单/佣金/推广费）；小红书/美团API对小商家几乎不开放。财务做账和运营决策都需要完整的多平台数据。

**How to apply:**
- RPA绝对只读不写（不改价/不发货/不回评/不投放）
- 管理员一次绑定平台账号，财务/运营按权限看数据，不感知RPA存在
- DataSourceAdapter统一接口，底层可切换RPASource或APISource
- 哪个平台API开放就替换对应RPA，业务层零修改
- 技术选型：Playwright(Node.js)，与项目技术栈一致
- 详见 docs/14-RPA数据桥梁方案.md
