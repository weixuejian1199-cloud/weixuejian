# ATLAS TODO

- [x] 合并 smartUpload（分块上传大文件）
- [x] 后端新增 GET /api/atlas/export/:sessionId 端点
- [x] 前端导出按钮改为调用后端 exportFromSession API
- [x] 修复多文件合并竞态条件（先轮询 Pipeline 完成再调 merge）
- [x] 优化上传速度：并行分块上传(并发3) + 分块大小4MB + parseFile与上传并行 + 轮询间隔1s
