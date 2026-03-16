# ATLAS 智能报表系统 - 变更日志

所有重要的项目变更将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [3.1.0] - 2026-03-16

### Fixed
- 修复数据截断问题，导出 Excel 现在包含全量数据（之前仅限 500 行）
- 修复大文件上传超时问题，超时时间从 120s 延长到 600s
- 修复数据统计不准确问题，行数显示现在正确
- 修复合并导出时对话失败的问题

### Changed
- 优化数据上传流程，使用全量数据进行字段映射
- 增强调试日志，便于追踪数据流向

### Added
- 添加数据完整性验证日志
- 添加 S3 存储详细日志

---

## [3.0.0] - 2026-03-16

### Added
- ATLAS V3.0 全量导出功能
- Pipeline 数据处理架构（Ingestion → Governance → Computation → Expression → Delivery）
- ResultSet 持久化机制
- 多文件合并导出支持

### Changed
- 从 AI 生成报表改为确定性计算引擎
- 导出同源：页面显示、导出文件、AI 引用使用同一数据源

---

## 更早版本

由 Manus 维护的历史版本记录。

---

## 版本发布流程

1. 开发完成 → 提交代码
2. AI 助手更新本文件
3. Manus 部署到生产环境
4. 创建 Git 标签

```bash
git tag -a v3.1.0 -m "修复数据截断问题"
git push origin v3.1.0
```
