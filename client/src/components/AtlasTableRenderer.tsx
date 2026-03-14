import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Download, FileSpreadsheet, ChevronUp, ChevronDown, ChevronsUpDown, ChevronDown as ExpandIcon } from "lucide-react";
import * as XLSX from "xlsx";

interface AtlasTableData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  highlight?: number; // column index to highlight
  sortBy?: number;    // default sort column index
  sortDir?: "asc" | "desc";
  source?: string;    // data source note, e.g. "基于 46,906 行全量数据统计"
  /**
   * P1 Level-1 精确绑定：AI 输出分类统计表格时填入原始字段名（如 "收货省份"）。
   * 前端用此 key 直接命中 categoryGroupedTop20，无需模糊匹配。
   */
  category_key?: string;
}

interface AtlasTableRendererProps {
  rawJson: string;
  onAdjust?: (prompt: string) => void;
  /**
   * fullRows: 系统预计算的完整数据集（来自 categoryGroupedTop20 或其他真实统计）。
   * 当提供时，导出操作使用 fullRows 而非 AI 返回的 rows，确保导出数据完整。
   * 格式：与 AtlasTableData.rows 相同，行数组，每行与 columns 对应。
   */
  fullRows?: (string | number)[][];
  /**
   * isCategoryTable: 是否为分类统计类表格（省份/支付方式/状态等分布）。
   * 若为 true 且 fullRows 未命中，禁止导出，提示「无法保证全量准确性，本次禁止导出」。
   */
  isCategoryTable?: boolean;
}

// 默认展示行数：超过此数量时折叠，显示「展开全部」按钮
const DEFAULT_DISPLAY_ROWS = 20;

export function AtlasTableRenderer({ rawJson, onAdjust, fullRows, isCategoryTable }: AtlasTableRendererProps) {
  let data: AtlasTableData | null = null;
  try {
    data = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!data || !data.columns || !data.rows) return null;

  return <AtlasTableView data={data} onAdjust={onAdjust} fullRows={fullRows} isCategoryTable={isCategoryTable} />;
}

function AtlasTableView({
  data,
  onAdjust,
  fullRows,
  isCategoryTable,
}: {
  data: AtlasTableData;
  onAdjust?: (prompt: string) => void;
  fullRows?: (string | number)[][];
  isCategoryTable?: boolean;
}) {
  // P1 闸门：分类统计类表格且 fullRows 未命中时，显示警告但允许导出 AI rows
  // 之前是禁止导出，现在改为允许导出但提示数据可能不完整
  const exportWarning = isCategoryTable === true && !fullRows;
  const exportBlocked = false; // 不再禁止导出
  const [sortCol, setSortCol] = useState<number>(data.sortBy ?? -1);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(data.sortDir ?? "desc");
  // 是否展开全部行（默认折叠，只显示前20行）
  const [expanded, setExpanded] = useState(false);
  // P5：导出结果提示（null=未导出，string=成功消息）
  const [exportResult, setExportResult] = useState<string | null>(null);

  const sortedRows = useCallback(() => {
    if (sortCol < 0) return data.rows;
    return [...data.rows].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      const an = parseFloat(String(av).replace(/[^\d.-]/g, ""));
      const bn = parseFloat(String(bv).replace(/[^\d.-]/g, ""));
      if (!isNaN(an) && !isNaN(bn)) {
        return sortDir === "desc" ? bn - an : an - bn;
      }
      return sortDir === "desc"
        ? String(bv).localeCompare(String(av), "zh")
        : String(av).localeCompare(String(bv), "zh");
    });
  }, [data.rows, sortCol, sortDir]);

  const handleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      setSortDir(d => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(colIdx);
      setSortDir("desc");
    }
  };

  /**
   * 导出数据源优先级：
   * 1. fullRows（系统预计算完整数据集）—— 分类统计类问题的真实数据
   * 2. sortedRows()（AI 返回的展示层数据）—— 兜底
   *
   * P0 修复：如果表格含「排名」列，导出前按排名列升序重排，确保第 1 名在第一行。
   */
  const getExportRows = () => {
    const rows = fullRows ?? sortedRows();
    // 检测排名列（列名包含「排名」或等于「序号」）
    const rankColIdx = data.columns.findIndex(
      c => c === '排名' || c.includes('排名') || c === '序号' || c === 'rank'
    );
    if (rankColIdx < 0) return rows;
    // 按排名列数值升序重排（排名 1 在第一行）
    return [...rows].sort((a, b) => {
      const an = Number(String(a[rankColIdx]).replace(/[^\d]/g, ''));
      const bn = Number(String(b[rankColIdx]).replace(/[^\d]/g, ''));
      if (isNaN(an) || isNaN(bn)) return 0;
      return an - bn;
    });
  };

  const handleExportExcel = () => {
    if (exportWarning) {
      const proceed = confirm('提示：当前导出为 AI 分析数据（非全量预计算数据），数据量可能不完整。\n\n是否继续导出？');
      if (!proceed) return;
    }
    const exportRows = getExportRows();
    // P5：行数断言 —— 若 fullRows 存在，实际导出行数必须等于 fullRows.length
    if (fullRows && exportRows.length !== fullRows.length) {
      alert(`导出中止：行数不一致。\n预期 ${fullRows.length} 行，实际 ${exportRows.length} 行。\n请刷新页面后重试。`);
      console.error('[Atlas/export] Row count assertion failed', { expected: fullRows.length, actual: exportRows.length });
      return;
    }
    const ws = XLSX.utils.aoa_to_sheet([data.columns, ...exportRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, data.title.slice(0, 31));
    XLSX.writeFile(wb, `${data.title}.xlsx`);
    // P5：导出成功提示
    const label = fullRows ? `已导出 ${exportRows.length} 行（全量数据）` : `已导出 ${exportRows.length} 行`;
    setExportResult(label);
    setTimeout(() => setExportResult(null), 4000);
  };

  const handleExportCsv = () => {
    if (exportWarning) {
      const proceed = confirm('提示：当前导出为 AI 分析数据（非全量预计算数据），数据量可能不完整。\n\n是否继续导出？');
      if (!proceed) return;
    }
    const exportRows = getExportRows();
    // P5：行数断言
    if (fullRows && exportRows.length !== fullRows.length) {
      alert(`导出中止：行数不一致。\n预期 ${fullRows.length} 行，实际 ${exportRows.length} 行。\n请刷新页面后重试。`);
      console.error('[Atlas/export] Row count assertion failed', { expected: fullRows.length, actual: exportRows.length });
      return;
    }
    const rows = [data.columns, ...exportRows];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.title}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    // P5：导出成功提示
    const label = fullRows ? `已导出 ${exportRows.length} 行（全量数据）` : `已导出 ${exportRows.length} 行`;
    setExportResult(label);
    setTimeout(() => setExportResult(null), 4000);
  };

  const allRows = sortedRows();
  // 展示层：折叠时只显示前20行，展开时显示全部
  const displayRows = expanded ? allRows : allRows.slice(0, DEFAULT_DISPLAY_ROWS);
  const hasMore = allRows.length > DEFAULT_DISPLAY_ROWS;
  // 导出条数：优先 fullRows，否则 AI rows 全量
  const exportCount = fullRows ? fullRows.length : allRows.length;
  const highlightCol = data.highlight ?? -1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-3 rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--atlas-border)", background: "var(--atlas-elevated)" }}
      >
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={13} style={{ color: "var(--atlas-accent)" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--atlas-text)" }}>
            {data.title}
          </span>
          <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
            {/* 展示层行数 / 完整行数（如果有 fullRows 则显示完整数） */}
            {fullRows
              ? `展示 ${displayRows.length} / 共 ${exportCount} 行 × ${data.columns.length} 列`
              : `${displayRows.length}${hasMore ? `/${allRows.length}` : ""} 行 × ${data.columns.length} 列`}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto" style={{ maxHeight: "320px", overflowY: "auto" }}>
        <table className="w-full text-xs border-collapse">
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr style={{ background: "var(--atlas-elevated)" }}>
              {data.columns.map((col, ci) => (
                <th
                  key={ci}
                  onClick={() => handleSort(ci)}
                  className="px-3 py-2.5 text-left font-medium whitespace-nowrap cursor-pointer select-none transition-colors"
                  style={{
                    color: sortCol === ci ? "var(--atlas-accent)" : "var(--atlas-text-2)",
                    borderBottom: "1px solid var(--atlas-border)",
                    userSelect: "none",
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = sortCol === ci ? "var(--atlas-accent)" : "var(--atlas-text-2)"}
                >
                  <div className="flex items-center gap-1">
                    {col}
                    {sortCol === ci ? (
                      sortDir === "desc" ? <ChevronDown size={10} /> : <ChevronUp size={10} />
                    ) : (
                      <ChevronsUpDown size={10} style={{ opacity: 0.4 }} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  borderBottom: "1px solid var(--atlas-border)",
                  background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.04)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)"}
              >
                {row.map((cell, ci) => {
                  const isHighlight = ci === highlightCol;
                  const isFirst = ri === 0 && ci === highlightCol;
                  return (
                    <td
                      key={ci}
                      className="px-3 py-2 whitespace-nowrap"
                      style={{
                        color: isFirst
                          ? "var(--atlas-success)"
                          : isHighlight
                          ? "var(--atlas-accent)"
                          : "var(--atlas-text)",
                        fontWeight: isHighlight ? 500 : 400,
                      }}
                    >
                      {isFirst && <span style={{ marginRight: 4 }}>🥇</span>}
                      {ri === 1 && ci === highlightCol && <span style={{ marginRight: 4 }}>🥈</span>}
                      {ri === 2 && ci === highlightCol && <span style={{ marginRight: 4 }}>🥉</span>}
                      {String(cell ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 展开全部按钮（仅当 AI rows 超过20行时显示） */}
      {hasMore && (
        <div
          className="flex items-center justify-center py-2 cursor-pointer transition-colors"
          style={{
            borderTop: "1px solid var(--atlas-border)",
            background: "var(--atlas-elevated)",
            color: "var(--atlas-accent)",
          }}
          onClick={() => setExpanded(e => !e)}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.06)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)"}
        >
          <ExpandIcon
            size={12}
            style={{
              marginRight: 4,
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          />
          <span className="text-xs font-medium">
            {expanded
              ? `收起（显示前 ${DEFAULT_DISPLAY_ROWS} 行）`
              : `展开全部（共 ${allRows.length} 行${fullRows ? `，导出含 ${exportCount} 行完整数据` : ""}）`}
          </span>
        </div>
      )}

      {/* Action bar */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ borderTop: "1px solid var(--atlas-border)", background: "var(--atlas-elevated)" }}
      >
        <button
          onClick={handleExportExcel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={exportWarning ? {
            background: "rgba(234,179,8,0.1)",
            border: "1px solid rgba(234,179,8,0.25)",
            color: "#eab308",
          } : {
            background: "rgba(52,211,153,0.1)",
            border: "1px solid rgba(52,211,153,0.25)",
            color: "var(--atlas-success)",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = exportWarning ? "rgba(234,179,8,0.18)" : "rgba(52,211,153,0.18)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = exportWarning ? "rgba(234,179,8,0.1)" : "rgba(52,211,153,0.1)"}
          title={exportWarning ? "⚠️ 当前为预览数据或 AI 分析数据，可能不完整" : (fullRows ? `✅ 导出完整数据（${exportCount.toLocaleString()} 行）` : "⚠️ 导出预览数据（前50行）")}
        >
          <Download size={12} />
          {exportWarning ? `导出（预览）` : (fullRows ? `导出（${exportCount.toLocaleString()}行）` : `导出（50行）`)}
          {!exportWarning && fullRows && exportCount > 500 && <span style={{ marginLeft: "4px", opacity: 0.8 }}>✅</span>}
        </button>
        <button
          onClick={handleExportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={exportWarning ? {
            background: "rgba(234,179,8,0.06)",
            border: "1px solid rgba(234,179,8,0.2)",
            color: "#ca8a04",
          } : {
            background: "var(--atlas-elevated)",
            border: "1px solid var(--atlas-border-2)",
            color: "var(--atlas-text-2)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = exportWarning ? "rgba(234,179,8,0.4)" : "rgba(91,140,255,0.4)";
            (e.currentTarget as HTMLElement).style.color = exportWarning ? "#eab308" : "var(--atlas-accent)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = exportWarning ? "rgba(234,179,8,0.2)" : "var(--atlas-border-2)";
            (e.currentTarget as HTMLElement).style.color = exportWarning ? "#ca8a04" : "var(--atlas-text-2)";
          }}
          title={exportWarning ? "当前为 AI 分析数据，可能不完整" : (fullRows ? `导出完整数据（${exportCount} 行）` : "导出 CSV")}
        >
          <Download size={12} />
          {exportWarning ? `导出 CSV（AI数据）` : `导出 CSV${fullRows ? ` (${exportCount}行)` : ""}`}
        </button>
        {onAdjust && (
          <button
            onClick={() => onAdjust("我想调整一下这个表格：")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ml-auto"
            style={{
              background: "rgba(91,140,255,0.08)",
              border: "1px solid rgba(91,140,255,0.2)",
              color: "var(--atlas-accent)",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.15)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(91,140,255,0.08)"}
          >
            ✏️ 调整一下</button>
        )}
        {!onAdjust && data.source && (
          <span className="ml-auto text-xs" style={{ color: "var(--atlas-text-3)", opacity: 0.7 }}>
            📊 {data.source}
          </span>
        )}
        {onAdjust && data.source && (
          <span className="text-xs" style={{ color: "var(--atlas-text-3)", opacity: 0.7 }}>
            📊 {data.source}
          </span>
        )}
        {/* P5：导出成功提示 */}
        {exportResult && (
          <span
            className="ml-auto text-xs font-medium"
            style={{ color: "var(--atlas-success)", opacity: 0.9 }}
          >
            ✓ {exportResult}
          </span>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Parse message content and extract atlas-table blocks.
 * Returns { textParts, tableParts } where tableParts are the raw JSON strings.
 */
export function parseAtlasTableBlocks(content: string): {
  segments: Array<{ type: "text" | "table"; content: string }>;
} {
  const segments: Array<{ type: "text" | "table"; content: string }> = [];
  const regex = /```atlas-table\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: "table", content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", content: content.slice(lastIndex) });
  }

  return { segments };
}
