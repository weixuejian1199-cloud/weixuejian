# C Stage Implementation Notes

## UI Spec Key Points (from ATLAS_V3.0_UI规格文档.md)

### Design Direction
- Google Gemini-inspired minimal style + Kimi file management interaction
- Light theme only, no dark mode
- Background: #f0f4f9 (light gray-blue)
- Brand color: #4f6ef7 (blue)

### Navigation Structure (CONFIRMED)
- Sidebar: ONLY 新建对话 + 历史列表 + 分享 + 设置
- NO separate nav items for HR中心/模板库/数据中枢
- HR/模板功能via quick tags below chat input: 出纳模版/会计模版/HR中心/数据分析
- Sidebar width: 200px expanded, 48px collapsed

### TopBar
- Height: 56px, no bottom border, seamless with content
- Left: ATLAS brand name (only logo position)
- Center: conversation title (auto-generated)
- Right: 📎 paperclip + ⋮ more + user avatar

### Home Page
- Centered welcome: "✦ Hi {username}" + "需要我帮你处理什么数据？"
- Chat input box (max-width 680px, radius 24px)
- 4 quick tags: 出纳模版/会计模版/HR中心/数据分析

### Colors
- Page bg: #f0f4f9
- Card bg: #ffffff
- Main text: #1f2937
- Secondary text: #6b7280
- Brand: #4f6ef7
- Brand light: #eff2fe
- User bubble: #e8eaed
- Success: #10b981
- Error: #ef4444
- Warning: #f59e0b
- Border: #e5e7eb

### Font
- Font family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif
- Home title: 28px Bold
- Home subtitle: 18px Regular
- Chat text: 15px Regular, line-height 1.7
- Quick tags: 14px Regular

### Files to Rewrite
1. MainWorkspace.tsx - Gemini-style home + chat flow
2. Sidebar.tsx - Minimal sidebar (200px/48px)
3. TopBar.tsx - Simplified: logo + title + 📎 + ⋮ + avatar
4. AtlasContext.tsx - Remove invite nav, add file panel state
5. index.css - Light theme color variables
6. App.tsx - Simplify routes

### New Components Needed
- WelcomeScreen.tsx
- MessageActions.tsx
- FilePanel.tsx
- FileCard.tsx
- TablePreview.tsx
- FullScreenPreview.tsx
- SettingsOverlay.tsx
- ShareOverlay.tsx
- ProcessingStatus.tsx
- ErrorCard.tsx

### Responsive Breakpoints
- Desktop large: ≥1200px (sidebar expanded)
- Desktop standard: 768-1199px (sidebar expanded, adaptive)
- Tablet: 600-767px (sidebar collapsed, overlay)
- Mobile: <600px (no sidebar, ☰ overlay, fullscreen chat)
