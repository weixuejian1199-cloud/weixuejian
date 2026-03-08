import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Download, FileSpreadsheet, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import * as XLSX from "xlsx";

interface AtlasTableData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  highlight?: number; // column index to highlight
  sortBy?: number;    // default sort column index
  sortDir?: "asc" | "desc";
}

interface AtlasTableRendererProps {
  rawJson: string;
  onAdjust?: (prompt: string) => void;
}

export function AtlasTableRenderer({ rawJson, onAdjust }: AtlasTableRendererProps) {
  let data: AtlasTableData | null = null;
  try {
    data = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!data || !data.columns || !data.rows) return null;

  return <AtlasTableView data={data} onAdjust={onAdjust} />;
}

function AtlasTableView({ data, onAdjust }: { data: AtlasTableData; onAdjust?: (prompt: string) => void }) {
  const [sortCol, setSortCol] = useState<number>(data.sortBy ?? -1);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(data.sortDir ?? "desc");

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

  const handleExportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet([data.columns, ...sortedRows()]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, data.title.slice(0, 31));
    XLSX.writeFile(wb, `${data.title}.xlsx`);
  };

  const handleExportCsv = () => {
    const rows = [data.columns, ...sortedRows()];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.title}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rows = sortedRows();
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
            {rows.length} 行 × {data.columns.length} 列
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
            {rows.map((row, ri) => (
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

      {/* Action bar */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ borderTop: "1px solid var(--atlas-border)", background: "var(--atlas-elevated)" }}
      >
        <button
          onClick={handleExportExcel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            background: "rgba(52,211,153,0.1)",
            border: "1px solid rgba(52,211,153,0.25)",
            color: "var(--atlas-success)",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(52,211,153,0.18)"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(52,211,153,0.1)"}
        >
          <Download size={12} />
          导出 Excel
        </button>
        <button
          onClick={handleExportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            background: "var(--atlas-elevated)",
            border: "1px solid var(--atlas-border-2)",
            color: "var(--atlas-text-2)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.4)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border-2)";
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
          }}
        >
          <Download size={12} />
          导出 CSV
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
            ✏️ 调整一下
          </button>
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
