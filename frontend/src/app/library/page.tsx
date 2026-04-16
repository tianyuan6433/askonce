"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  listKnowledge,
  createKnowledge,
  createKnowledgeBatch,
  deleteKnowledge,
  updateKnowledge,
  extractKnowledge,
  extractFromFeishu,
  importDocument,
  getKnowledgeLogs,
  translateKnowledge,
  exportKnowledgeExcel,
  importKnowledgeExcel,
  type KnowledgeEntry,
  type KnowledgeLogEntry,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/* ─── helpers ─── */

const ACTION_ICON: Record<string, string> = {
  created: "add_circle",
  updated: "edit",
  deleted: "delete",
  extracted: "auto_awesome",
  imported: "upload_file",
  learned: "psychology",
};

const CATEGORY_COLORS: Record<string, string> = {
  Product: "bg-teal-100 text-teal-700",
  Pricing: "bg-purple-100 text-purple-700",
  Technical: "bg-blue-100 text-blue-700",
  Support: "bg-orange-100 text-orange-700",
  Security: "bg-red-100 text-red-700",
  Content: "bg-green-100 text-green-700",
  Organization: "bg-indigo-100 text-indigo-700",
  General: "bg-gray-100 text-gray-600",
};

const ALL_CATEGORIES = Object.keys(CATEGORY_COLORS);

/** Strip leading/trailing brackets and quotes from a pattern string */
function cleanPattern(s: string): string {
  return s.replace(/^\[+|^\"+|"+$|\]+$/g, "").trim();
}

/* ─── main page ─── */

export default function LibraryPage() {
  const { t, locale } = useI18n();

  const methodLabel = (m: string) =>
    t(`library.method${m.charAt(0).toUpperCase() + m.slice(1)}` as never) || m;

  function formatLogTime(iso: string): string {
    const d = new Date(iso + "Z"); // UTC
    return d.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  function relativeTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("common.justNow");
    if (mins < 60) return t("common.minsAgo", { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("common.hoursAgo", { n: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t("common.daysAgo", { n: days });
    return d.toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US");
  }

  /* --- knowledge list state --- */
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 20;

  /* --- import state --- */
  const [importOpen, setImportOpen] = useState(true);
  const [importTab, setImportTab] = useState<"file" | "text" | "feishu">("file");
  const [pasteText, setPasteText] = useState("");
  const [feishuUrl, setFeishuUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [previewEntries, setPreviewEntries] = useState<Array<{
    question_patterns: string[];
    answer: string;
    tags: string[];
    category?: string;
    confirmed: boolean;
  }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* --- file queue state --- */
  interface FileQueueItem {
    file: File;
    status: "pending" | "extracting" | "done" | "error";
    entriesCount: number;
    error?: string;
  }
  const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
  const [fileQueueDone, setFileQueueDone] = useState(0);

  /* --- edit state --- */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestions, setEditQuestions] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  /* --- view modal state --- */
  // viewingEntry removed — click now enters edit mode directly

  /* --- batch select state --- */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  /* --- JSON import state --- */
  const [jsonImporting, setJsonImporting] = useState(false);
  const [jsonImportDone, setJsonImportDone] = useState(0);
  const [jsonImportTotal, setJsonImportTotal] = useState(0);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  /* --- Excel import state --- */
  const [excelImporting, setExcelImporting] = useState(false);
  const [excelImportDone, setExcelImportDone] = useState(0);
  const [excelImportTotal, setExcelImportTotal] = useState(0);
  const excelFileInputRef = useRef<HTMLInputElement>(null);

  /* --- paste image state --- */
  const [pasteImageProcessing, setPasteImageProcessing] = useState(false);

  /* --- growth log state --- */
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<KnowledgeLogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logActionFilter, setLogActionFilter] = useState<string | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const logDropdownRef = useRef<HTMLDivElement>(null);

  // Close growth log dropdown on click outside
  useEffect(() => {
    if (!logOpen) return;
    const handler = (e: MouseEvent) => {
      if (logDropdownRef.current && !logDropdownRef.current.contains(e.target as Node)) {
        setLogOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [logOpen]);

  /* --- debounced search --- */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  /* --- reset list when search or category changes --- */
  useEffect(() => {
    setEntries([]);
    setPage(1);
    setHasMore(true);
  }, [debouncedSearch, activeCategory]);

  /* --- fetch entries (append mode) --- */
  const fetchEntries = useCallback(
    async (p: number, append: boolean) => {
      if (loading) return;
      setLoading(true);
      try {
        const data = await listKnowledge({
          page: p,
          page_size: PAGE_SIZE,
          search: debouncedSearch || undefined,
          locale: locale !== "en" ? locale : undefined,
          category: activeCategory || undefined,
        });
        setTotal(data.total);
        setEntries((prev) => {
          if (!append) return data.items;
          // Deduplicate by id when appending pages
          const existingIds = new Set(prev.map((e) => e.id));
          const newItems = data.items.filter((e) => !existingIds.has(e.id));
          return [...prev, ...newItems];
        });
        setHasMore(data.items.length === PAGE_SIZE);
      } catch (err) {
        console.error("Failed to load knowledge:", err);
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, loading, activeCategory],
  );

  /* load first page */
  useEffect(() => {
    fetchEntries(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, activeCategory]);

  /* re-fetch when locale changes (backend returns correct language) */
  useEffect(() => {
    if (entries.length === 0) return;
    fetchEntries(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  /* --- infinite scroll via IntersectionObserver --- */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          const next = page + 1;
          setPage(next);
          fetchEntries(next, true);
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, page, fetchEntries]);

  /* --- extract handler --- */
  const handleExtract = async () => {
    setExtracting(true);
    setPreviewEntries([]);
    setExtractError(null);
    try {
      if (importTab === "file") {
        // Per-file sequential extraction with queue progress
        const queue = fileQueue.length > 0 ? fileQueue : (uploadedFile ? [{ file: uploadedFile, status: "pending" as const, entriesCount: 0 }] : []);
        if (queue.length === 0) return;

        // Reset queue status to pending
        const resetQueue = queue.map((item) => ({ ...item, status: "pending" as const, entriesCount: 0, error: undefined }));
        setFileQueue(resetQueue);
        setFileQueueDone(0);
        let doneCount = 0;

        for (let i = 0; i < resetQueue.length; i++) {
          // Mark current file as extracting
          setFileQueue((prev) => prev.map((item, idx) => idx === i ? { ...item, status: "extracting" } : item));

          const file = resetQueue[i].file;
          const isImage = file.type.startsWith("image/");
          try {
            const result: { entries?: Array<{ question_patterns?: string[]; answer?: string; tags?: string[]; category?: string }> } = isImage
              ? await extractKnowledge(file)
              : await importDocument(file);

            const entries = result.entries || [];
            const count = entries.length;

            // Mark file as done
            setFileQueue((prev) => prev.map((item, idx) => idx === i ? { ...item, status: "done", entriesCount: count } : item));
            doneCount++;
            setFileQueueDone(doneCount);

            // Append extracted entries to preview
            if (count > 0) {
              setPreviewEntries((prev) => [
                ...prev,
                ...entries.map((e) => ({
                  question_patterns: e.question_patterns || ["Unknown"],
                  answer: e.answer || "",
                  tags: e.tags || [],
                  category: e.category,
                  confirmed: false,
                })),
              ]);
            }
          } catch (err) {
            setFileQueue((prev) => prev.map((item, idx) => idx === i ? { ...item, status: "error", error: err instanceof Error ? err.message : "Unknown error" } : item));
            doneCount++;
            setFileQueueDone(doneCount);
          }
        }
      } else if (importTab === "text" && pasteText.trim()) {
        const result = await extractKnowledge(undefined, pasteText);
        if (result.entries && result.entries.length > 0) {
          setPreviewEntries(
            result.entries.map((e: { question_patterns?: string[]; answer?: string; tags?: string[]; category?: string }) => ({
              question_patterns: e.question_patterns || ["Unknown"],
              answer: e.answer || "",
              tags: e.tags || [],
              category: e.category,
              confirmed: false,
            })),
          );
        }
      } else if (importTab === "feishu" && feishuUrl.trim()) {
        const result = await extractFromFeishu(feishuUrl.trim());
        if (result.entries && result.entries.length > 0) {
          setPreviewEntries(
            result.entries.map((e: { question_patterns?: string[]; answer?: string; tags?: string[]; category?: string }) => ({
              question_patterns: (e.question_patterns as string[]) || ["Unknown"],
              answer: (e.answer as string) || "",
              tags: (e.tags as string[]) || [],
              category: e.category as string | undefined,
              confirmed: false,
            })),
          );
        }
      } else {
        return;
      }
    } catch (err) {
      console.error("Extraction error:", err);
      setExtractError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  /* --- confirm one entry → remove from preview --- */
  const confirmEntry = async (idx: number) => {
    const e = previewEntries[idx];
    if (e.confirmed) return;
    try {
      await createKnowledge({
        question_patterns: e.question_patterns,
        answer: e.answer,
        tags: e.tags,
      });
      // Remove the entry from preview list after successful import
      setPreviewEntries((prev) => prev.filter((_, i) => i !== idx));
    } catch (err) {
      console.error("Failed to confirm entry:", err);
    }
  };

  /* --- confirm all entries with progress --- */
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [confirmAllDone, setConfirmAllDone] = useState(0);
  const [confirmAllTotal, setConfirmAllTotal] = useState(0);
  const confirmAll = async () => {
    const pendingEntries = previewEntries.filter((e) => !e.confirmed);
    if (pendingEntries.length === 0) return;
    setConfirmingAll(true);
    setConfirmAllDone(0);
    setConfirmAllTotal(pendingEntries.length);
    try {
      await createKnowledgeBatch(pendingEntries.map((e) => ({
        question_patterns: e.question_patterns,
        answer: e.answer,
        tags: e.tags,
      })));
      setPreviewEntries([]);
      setConfirmAllDone(pendingEntries.length);
    } catch { /* skip failed */ }
    // Refresh list once at end
    try {
      const data = await listKnowledge({ page: 1, page_size: PAGE_SIZE, search: debouncedSearch || undefined, locale: locale !== "en" ? locale : undefined });
      setEntries(data.items);
      setTotal(data.total);
      setPage(1);
      setHasMore(data.items.length === PAGE_SIZE);
    } catch { /* ignore */ }
    setConfirmingAll(false);
  };

  /* --- edit preview entry --- */
  const [editingPreviewIdx, setEditingPreviewIdx] = useState<number | null>(null);
  const [editPreviewQ, setEditPreviewQ] = useState("");
  const [editPreviewA, setEditPreviewA] = useState("");
  const [editPreviewTags, setEditPreviewTags] = useState("");

  const startEditingPreview = (idx: number) => {
    const e = previewEntries[idx];
    setEditingPreviewIdx(idx);
    setEditPreviewQ(e.question_patterns.join("\n"));
    setEditPreviewA(e.answer);
    setEditPreviewTags(e.tags.join(", "));
  };

  const savePreviewEdit = (idx: number) => {
    setPreviewEntries((prev) =>
      prev.map((p, i) =>
        i === idx
          ? {
              ...p,
              question_patterns: editPreviewQ.split("\n").map((s) => s.trim()).filter(Boolean),
              answer: editPreviewA,
              tags: editPreviewTags.split(",").map((s) => s.trim()).filter(Boolean),
            }
          : p,
      ),
    );
    setEditingPreviewIdx(null);
  };

  const removePreviewEntry = (idx: number) => {
    setPreviewEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  /* --- delete entry --- */
  const handleDelete = async (id: string) => {
    try {
      await deleteKnowledge(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  /* --- fetch logs --- */
  useEffect(() => {
    if (logOpen) {
      setLogs([]);
      setLogPage(1);
      getKnowledgeLogs(1, 30, logActionFilter || undefined).then((res) => {
        setLogs(res.items);
        setLogsTotal(res.total);
      }).catch(console.error);
    }
  }, [logOpen, logActionFilter]);

  const loadMoreLogs = () => {
    const nextPage = logPage + 1;
    getKnowledgeLogs(nextPage, 30, logActionFilter || undefined).then((res) => {
      setLogs((prev) => [...prev, ...res.items]);
      setLogPage(nextPage);
    }).catch(console.error);
  };

  /* --- drag/drop --- */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      setUploadedFiles((prev) => [...prev, ...droppedFiles]);
      setUploadedFile(droppedFiles[0]);
      setFileQueue((prev) => [
        ...prev,
        ...droppedFiles.map((f) => ({ file: f, status: "pending" as const, entriesCount: 0 })),
      ]);
    }
  }, []);

  /* --- sorted entries (newest first) --- */
  const sortedEntries = [...entries].sort((a, b) => {
    const ta = a.updated_at || a.created_at || "";
    const tb = b.updated_at || b.created_at || "";
    return tb.localeCompare(ta);
  });

  /* --- edit handlers --- */
  const startEditing = (entry: KnowledgeEntry) => {
    setEditingId(entry.id);
    setEditQuestions(entry.question_patterns.join("\n"));
    setEditAnswer(entry.answer);
    setEditTags(entry.tags.join(", "));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditQuestions("");
    setEditAnswer("");
    setEditTags("");
  };

  const saveEdit = async (id: string) => {
    setEditSaving(true);
    try {
      const updated = await updateKnowledge(id, {
        question_patterns: editQuestions.split("\n").map((s) => s.trim()).filter(Boolean),
        answer: editAnswer,
        tags: editTags.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
      cancelEditing();
    } catch (err) {
      console.error("Failed to update:", err);
    } finally {
      setEditSaving(false);
    }
  };

  /* --- batch select handlers --- */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedEntries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedEntries.map((e) => e.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    try {
      for (const id of selectedIds) {
        await deleteKnowledge(id);
      }
      setEntries((prev) => prev.filter((e) => !selectedIds.has(e.id)));
      setTotal((prev) => prev - selectedIds.size);
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Batch delete failed:", err);
    } finally {
      setBatchDeleting(false);
    }
  };

  /* --- export JSON --- */
  const handleExportJson = () => {
    const data = sortedEntries.map((e) => ({
      question_patterns: e.question_patterns,
      answer: e.answer,
      tags: e.tags,
      conditions: e.conditions || undefined,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knowledge-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* --- import JSON --- */
  const handleImportJson = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Array<{ question_patterns: string[]; answer: string; tags?: string[]; conditions?: string }>;
      if (!Array.isArray(data)) return;
      setJsonImporting(true);
      setJsonImportTotal(data.length);
      setJsonImportDone(0);
      for (const item of data) {
        try {
          await createKnowledge({
            question_patterns: item.question_patterns,
            answer: item.answer,
            tags: item.tags,
            conditions: item.conditions,
          });
          setJsonImportDone((prev) => prev + 1);
        } catch {
          // continue with next
        }
      }
      // Refresh list
      const res = await listKnowledge({ page: 1, page_size: PAGE_SIZE, search: debouncedSearch || undefined, locale: locale !== "en" ? locale : undefined });
      setEntries(res.items);
      setTotal(res.total);
      setPage(1);
      setHasMore(res.items.length === PAGE_SIZE);
    } catch (err) {
      console.error("JSON import failed:", err);
    } finally {
      setJsonImporting(false);
    }
  };

  /* --- export Excel --- */
  const handleExportExcel = async () => {
    await exportKnowledgeExcel(sortedEntries);
  };

  /* --- import Excel --- */
  const handleImportExcel = async (file: File) => {
    try {
      const rows = await importKnowledgeExcel(file);
      if (!rows.length) return;
      setExcelImporting(true);
      setExcelImportTotal(rows.length);
      setExcelImportDone(0);
      for (const item of rows) {
        try {
          await createKnowledge({
            question_patterns: item.question_patterns,
            answer: item.answer,
            tags: item.tags,
            conditions: item.conditions,
          });
          setExcelImportDone((prev) => prev + 1);
        } catch {
          // continue
        }
      }
      const res = await listKnowledge({ page: 1, page_size: PAGE_SIZE, search: debouncedSearch || undefined, locale: locale !== "en" ? locale : undefined });
      setEntries(res.items);
      setTotal(res.total);
      setPage(1);
      setHasMore(res.items.length === PAGE_SIZE);
    } catch (err) {
      console.error("Excel import failed:", err);
    } finally {
      setExcelImporting(false);
    }
  };

  /* --- paste image handler --- */
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          setPasteImageProcessing(true);
          try {
            const result = await extractKnowledge(file);
            if (result.entries && result.entries.length > 0) {
              setPreviewEntries(
                result.entries.map((en: { question_patterns?: string[]; answer?: string; tags?: string[]; category?: string }) => ({
                  question_patterns: en.question_patterns || ["Unknown"],
                  answer: en.answer || "",
                  tags: en.tags || [],
                  category: en.category,
                  confirmed: false,
                })),
              );
            }
          } catch (err) {
            console.error("Paste image extraction error:", err);
            setExtractError(err instanceof Error ? err.message : "Image extraction failed");
          } finally {
            setPasteImageProcessing(false);
          }
        }
        break;
      }
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-on-surface">{t("library.title")}</h1>
          <p className="text-on-surface-variant text-sm mt-1">
            {t("library.totalEntries", { n: total })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Growth Log dropdown toggle */}
          <div className="relative" ref={logDropdownRef}>
            <button
              onClick={() => setLogOpen(!logOpen)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors border ${
                logOpen
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-surface-container-low text-on-surface-variant border-outline-variant/15 hover:bg-surface-container"
              }`}
            >
              <span className="material-symbols-outlined text-base">timeline</span>
              {logsTotal > 0 && (
                <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-semibold">{logsTotal}</span>
              )}
            </button>
            {logOpen && (
              <div className="absolute right-0 top-full mt-2 w-[380px] bg-surface-container-lowest rounded-xl shadow-xl border border-outline-variant/15 z-50 overflow-hidden">
                <div className="p-3 border-b border-outline-variant/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-on-surface">{t("library.growthLog")}</span>
                    <button onClick={() => setLogOpen(false)} className="text-on-surface-variant hover:text-on-surface">
                      <span className="material-symbols-outlined text-base">close</span>
                    </button>
                  </div>
                  {/* Action filter chips */}
                  <div className="flex gap-1 flex-wrap">
                    {["All", "Created", "Extracted", "Updated", "Deleted", "Imported", "Learned"].map((a) => (
                      <button
                        key={a}
                        onClick={() => setLogActionFilter(a === "All" ? null : a.toLowerCase())}
                        className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                          (a === "All" && !logActionFilter) || logActionFilter === a.toLowerCase()
                            ? "bg-primary text-white border-primary"
                            : "bg-white text-on-surface-variant border-outline-variant/30 hover:bg-surface-container"
                        }`}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-[320px] overflow-y-auto p-3 space-y-0">
                  {logs.length === 0 ? (
                    <p className="text-xs text-on-surface-variant/40 py-4 text-center">{t("library.noLogs")}</p>
                  ) : (
                    <div className="border-l-2 border-primary/15 space-y-0">
                      {logs.map((log) => {
                        const details = log.details ? (() => { try { return JSON.parse(log.details); } catch { return null; } })() : null;
                        const entryNames: string[] = details?.entries || [];
                        return (
                        <div key={log.id} className="relative pl-5 py-2">
                          <div className="absolute -left-[5px] top-3 w-2.5 h-2.5 rounded-full bg-primary/20 border-2 border-primary" />
                          <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-sm text-primary/60 mt-0.5">
                              {ACTION_ICON[log.action] || "info"}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-on-surface leading-tight">
                                {t("library.logVia")} <span className="font-semibold">{methodLabel(log.method)}</span>
                                {log.action === "created" && ` ${t("library.logCreated", { n: log.count })}`}
                                {log.action === "extracted" && ` ${t("library.logExtracted", { n: log.count })}`}
                                {log.action === "updated" && ` ${t("library.logUpdated", { n: log.count })}`}
                                {log.action === "deleted" && ` ${t("library.logDeleted", { n: log.count })}`}
                                {log.action === "imported" && ` ${t("library.logImported", { n: log.count })}`}
                                {log.action === "learned" && ` 🧠 learned ${log.count} entr${log.count === 1 ? "y" : "ies"}`}
                              </p>
                              {entryNames.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {entryNames.slice(0, expandedLogIds.has(log.id) ? entryNames.length : 3).map((name, idx) => (
                                    <p key={idx} className="text-[10px] text-on-surface-variant/70 truncate leading-tight">
                                      • {name}
                                    </p>
                                  ))}
                                  {entryNames.length > 3 && (
                                    <button
                                      onClick={() => setExpandedLogIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(log.id)) next.delete(log.id); else next.add(log.id);
                                        return next;
                                      })}
                                      className="text-[10px] text-primary hover:text-primary/70 font-medium cursor-pointer"
                                    >
                                      {expandedLogIds.has(log.id) ? "Show less" : `+${entryNames.length - 3} more`}
                                    </button>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-on-surface-variant/50">{formatLogTime(log.created_at)}</span>
                                {log.source_filename && (
                                  <span className="text-[10px] text-on-surface-variant/40 truncate max-w-[140px]">📄 {log.source_filename}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                  {logs.length < logsTotal && (
                    <div className="pt-2 text-center">
                      <button onClick={loadMoreLogs} className="text-[11px] font-semibold text-primary hover:text-primary/80">
                        Load more ({logs.length} / {logsTotal})
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-surface-container-low text-on-surface font-semibold rounded-full hover:bg-surface-container transition-colors text-sm border border-outline-variant/15"
          >
            <span className="material-symbols-outlined text-lg">download</span>
            {t("library.exportExcel")}
          </button>
          <button
            onClick={() => setImportOpen(!importOpen)}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary font-semibold rounded-full hover:opacity-90 transition-opacity text-sm"
          >
            <span className="material-symbols-outlined text-lg">
              {importOpen ? "expand_less" : "add"}
            </span>
            {importOpen ? t("library.collapseImport") : t("library.importKnowledge")}
          </button>
        </div>
      </div>

      {/* ═══ IMPORT SECTION (collapsible) ═══ */}
      {importOpen && (
        <section className="bg-surface-container-lowest rounded-xl shadow-card p-6 space-y-5 border border-outline-variant/10">
          {/* tabs */}
          <div className="flex gap-1 bg-surface-container-low p-1 rounded-full w-fit">
            {(["file", "text", "feishu"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setImportTab(tab); setPreviewEntries([]); setExtractError(null); }}
                className={`px-5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  importTab === tab
                    ? "bg-surface-container-lowest shadow-sm text-on-surface"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span className="material-symbols-outlined text-sm align-middle mr-1">
                  {tab === "file" ? "upload_file" : tab === "text" ? "content_paste" : "link"}
                </span>
                {tab === "file" ? t("library.uploadFile") : tab === "text" ? t("library.pasteText") : t("library.feishuLink")}
              </button>
            ))}
          </div>

          {/* file tab */}
          {importTab === "file" && (
            <div className="space-y-3">
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  isDragging ? "border-primary bg-primary/5" : "border-outline-variant/30 hover:border-primary/50"
                }`}
              >
                <span className="material-symbols-outlined text-primary/40 text-3xl mb-2">cloud_upload</span>
                <p className="text-sm font-semibold text-on-surface">{t("library.dragFileHint")}</p>
                <p className="text-xs text-on-surface-variant mt-1">{t("library.supportedFormats")}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.txt,.md,.xlsx,.xls"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const selected = Array.from(e.target.files || []);
                    if (selected.length > 0) {
                      setUploadedFiles((prev) => [...prev, ...selected]);
                      setUploadedFile(selected[0]);
                      setFileQueue((prev) => [
                        ...prev,
                        ...selected.map((f) => ({ file: f, status: "pending" as const, entriesCount: 0 })),
                      ]);
                    }
                    if (e.target) e.target.value = "";
                  }}
                />
              </div>

              {/* File queue list */}
              {fileQueue.length > 0 && (
                <div className="bg-surface-container-low/30 rounded-xl border border-outline-variant/10 divide-y divide-outline-variant/10">
                  {fileQueue.map((item, idx) => (
                    <div key={`${item.file.name}-${idx}`} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="material-symbols-outlined text-base text-on-surface-variant/60">
                        {item.file.type.startsWith("image/") ? "image" : "description"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{item.file.name}</p>
                        <p className="text-[11px] text-on-surface-variant/50">
                          {item.file.size < 1024 * 1024
                            ? `${(item.file.size / 1024).toFixed(0)} KB`
                            : `${(item.file.size / (1024 * 1024)).toFixed(1)} MB`}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {item.status === "pending" && (
                          <span className="text-xs text-on-surface-variant/50">⏳ {t("library.fileQueuePending")}</span>
                        )}
                        {item.status === "extracting" && (
                          <>
                            <span className="material-symbols-outlined text-primary animate-spin text-base">autorenew</span>
                            <span className="text-xs text-primary font-medium">{t("library.fileQueueExtracting")}</span>
                          </>
                        )}
                        {item.status === "done" && (
                          <span className="text-xs text-green-600 font-medium">✅ {t("library.fileQueueDone", { n: item.entriesCount })}</span>
                        )}
                        {item.status === "error" && (
                          <span className="text-xs text-red-500 font-medium" title={item.error}>❌ {t("library.fileQueueError")}</span>
                        )}
                      </div>
                      {!extracting && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setFileQueue((prev) => prev.filter((_, i) => i !== idx));
                            setUploadedFiles((prev) => prev.filter((_, i) => i !== idx));
                          }}
                          className="shrink-0 p-1 rounded hover:bg-surface-container text-on-surface-variant/40 hover:text-on-surface-variant transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* text tab */}
          {importTab === "text" && (
            <div className="relative">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                onPaste={handlePaste}
                placeholder={t("library.textPlaceholder")}
                className="w-full bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 rounded-xl p-4 text-sm leading-relaxed text-on-surface resize-none h-40"
              />
              {pasteImageProcessing && (
                <div className="absolute inset-0 bg-surface-container-lowest/80 rounded-xl flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary animate-spin text-2xl mr-2">autorenew</span>
                  <span className="text-sm text-on-surface-variant">{t("library.pasteImageProcessing")}</span>
                </div>
              )}
            </div>
          )}

          {/* feishu tab */}
          {importTab === "feishu" && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <span className="material-symbols-outlined text-on-surface-variant/50 absolute left-4 top-1/2 -translate-y-1/2 text-lg">link</span>
                  <input
                    type="url"
                    value={feishuUrl}
                    onChange={(e) => setFeishuUrl(e.target.value)}
                    placeholder={t("library.feishuPlaceholder")}
                    className="w-full bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 rounded-xl pl-11 pr-4 py-3 text-sm text-on-surface"
                  />
                </div>
              </div>
              <p className="text-xs text-on-surface-variant/60">
                {t("library.feishuHint")}
              </p>
            </div>
          )}

          {/* extract button */}
            <div className="space-y-2">
              <button
                onClick={handleExtract}
                disabled={extracting || (importTab === "file" ? (fileQueue.length === 0 && !uploadedFile) : importTab === "feishu" ? !feishuUrl.trim() : !pasteText.trim())}
                className="flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary font-semibold rounded-xl hover:opacity-90 transition-opacity text-sm disabled:opacity-40"
              >
                <span className={`material-symbols-outlined text-lg ${extracting ? "animate-spin" : ""}`}>
                  {extracting ? "autorenew" : "auto_awesome"}
                </span>
                {extracting
                  ? (fileQueue.length > 0
                      ? t("library.fileQueueOverallProgress", { done: fileQueueDone, total: fileQueue.length })
                      : t("library.extracting"))
                  : t("library.extractKnowledge")}
              </button>
              {extractError && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-error/10 border border-error/20 rounded-xl text-sm text-error">
                  <span className="material-symbols-outlined text-base shrink-0">error</span>
                  <span>{extractError}</span>
                  <button onClick={() => setExtractError(null)} className="ml-auto shrink-0">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              )}
            </div>

          {/* preview entries */}
          {previewEntries.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-on-surface">
                  {t("library.extractedCount", { n: previewEntries.length })}
                  {confirmingAll && (
                    <span className="ml-2 text-xs font-normal text-primary">
                      — {t("library.importingProgress", { done: confirmAllDone, total: previewEntries.filter((e) => !e.confirmed).length + confirmAllDone })}
                    </span>
                  )}
                </p>
                <button
                  onClick={confirmAll}
                  disabled={previewEntries.every((e) => e.confirmed) || confirmingAll}
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-40"
                >
                  {confirmingAll && <span className="material-symbols-outlined text-sm animate-spin">autorenew</span>}
                  {confirmingAll ? t("library.importingProgress", { done: confirmAllDone, total: confirmAllTotal }) : t("library.confirmAllImport")}
                </button>
              </div>

              {/* Progress bar during batch import */}
              {confirmingAll && (
                <div className="w-full bg-surface-container-low rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-300"
                    style={{ width: `${((confirmAllDone) / Math.max(confirmAllTotal, 1)) * 100}%` }}
                  />
                </div>
              )}

              {previewEntries.map((e, i) => (
                <div
                  key={i}
                  className="p-4 rounded-xl border transition-colors bg-surface-container-low/30 border-outline-variant/10"
                >
                  {editingPreviewIdx === i ? (
                    /* ── Inline edit for preview entry ── */
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{t("library.editQuestionsLabel")}</label>
                        <textarea
                          value={editPreviewQ}
                          onChange={(ev) => setEditPreviewQ(ev.target.value)}
                          rows={2}
                          className="w-full bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 rounded-lg p-2.5 text-sm text-on-surface resize-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{t("library.editAnswerLabel")}</label>
                        <textarea
                          value={editPreviewA}
                          onChange={(ev) => setEditPreviewA(ev.target.value)}
                          rows={3}
                          className="w-full bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 rounded-lg p-2.5 text-sm text-on-surface resize-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{t("library.editTagsLabel")}</label>
                        <input
                          type="text"
                          value={editPreviewTags}
                          onChange={(ev) => setEditPreviewTags(ev.target.value)}
                          className="w-full bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 rounded-lg px-2.5 py-1.5 text-sm text-on-surface"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => savePreviewEdit(i)}
                          className="px-4 py-1.5 bg-primary text-on-primary text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity"
                        >
                          {t("library.editSave")}
                        </button>
                        <button
                          onClick={() => setEditingPreviewIdx(null)}
                          className="px-4 py-1.5 bg-surface-container text-on-surface-variant text-xs font-semibold rounded-lg hover:bg-surface-container-low transition-colors"
                        >
                          {t("library.editCancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Display mode ── */
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface truncate">
                          {e.question_patterns[0]}
                        </p>
                        <p className="text-xs text-on-surface-variant line-clamp-2 mt-1">{e.answer}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {e.category && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${CATEGORY_COLORS[e.category] || CATEGORY_COLORS.General}`}>
                              {e.category}
                            </span>
                          )}
                          {e.tags.map((tag) => (
                            <span key={tag} className="px-2 py-0.5 bg-surface-container rounded-full text-[10px] font-bold text-on-surface-variant">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!e.confirmed && (
                          <>
                            <button
                              onClick={() => startEditingPreview(i)}
                              disabled={confirmingAll}
                              className="p-1.5 rounded-lg hover:bg-primary/10 text-on-surface-variant hover:text-primary transition-colors disabled:opacity-30"
                              title={t("library.editTooltip")}
                            >
                              <span className="material-symbols-outlined text-base">edit</span>
                            </button>
                            <button
                              onClick={() => removePreviewEntry(i)}
                              disabled={confirmingAll}
                              className="p-1.5 rounded-lg hover:bg-error/10 text-on-surface-variant hover:text-error transition-colors disabled:opacity-30"
                              title={t("library.deleteTooltip")}
                            >
                              <span className="material-symbols-outlined text-base">close</span>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => confirmEntry(i)}
                          disabled={confirmingAll}
                          className="shrink-0 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-primary text-on-primary hover:opacity-90 disabled:opacity-40"
                        >
                          {t("library.confirmImport")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ═══ SEARCH BAR ═══ */}
      <div className="relative">
        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-xl">
          search
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("library.searchPlaceholder")}
          className="w-full pl-12 pr-4 py-3 bg-surface-container-lowest border border-outline-variant/15 rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        )}
      </div>

      {/* ═══ CATEGORY FILTER PILLS ═══ */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all ${
            activeCategory === null
              ? "bg-primary text-on-primary shadow-sm"
              : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-highest"
          }`}
        >
          {t("library.allCategories")}
        </button>
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all ${
              activeCategory === cat
                ? "ring-2 ring-primary/40 shadow-sm " + (CATEGORY_COLORS[cat] || CATEGORY_COLORS.General)
                : (CATEGORY_COLORS[cat] || CATEGORY_COLORS.General) + " opacity-60 hover:opacity-100"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* ═══ KNOWLEDGE LIST (infinite scroll) ═══ */}
      <section>
        {/* Batch action bar */}
        {sortedEntries.length > 0 && (
          <div className="flex items-center gap-3 mb-3">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-on-surface-variant">
              <input
                type="checkbox"
                checked={selectedIds.size === sortedEntries.length && sortedEntries.length > 0}
                onChange={toggleSelectAll}
                className="w-3.5 h-3.5 accent-primary rounded"
              />
              {selectedIds.size === sortedEntries.length ? t("library.deselectAll") : t("library.selectAll")}
            </label>
            {selectedIds.size > 0 && (
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="flex items-center gap-1 px-3 py-1 bg-error/10 text-error text-xs font-semibold rounded-lg hover:bg-error/20 transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
                {batchDeleting ? t("library.batchDeleting") : t("library.deleteSelected", { n: selectedIds.size })}
              </button>
            )}
          </div>
        )}

        {entries.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-on-surface-variant/40 text-3xl">menu_book</span>
            </div>
            <p className="text-sm font-medium text-on-surface-variant/60 mb-1">
              {debouncedSearch ? t("library.noResultsTitle") : t("library.emptyTitle")}
            </p>
            <p className="text-xs text-on-surface-variant/40 max-w-[280px]">
              {debouncedSearch
                ? t("library.noResultsHint")
                : t("library.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedEntries.map((entry) => (
              <div
                key={entry.id}
                className="group bg-surface-container-lowest p-5 rounded-xl border border-transparent hover:border-primary/10 hover:shadow-card transition-all"
              >
                {editingId === entry.id ? (
                  /* ── Inline Edit Form ── */
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{t("library.editQuestionsLabel")}</label>
                      <textarea
                        value={editQuestions}
                        onChange={(e) => setEditQuestions(e.target.value)}
                        rows={3}
                        className="w-full bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 rounded-lg p-3 text-sm text-on-surface resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{t("library.editAnswerLabel")}</label>
                      <textarea
                        value={editAnswer}
                        onChange={(e) => setEditAnswer(e.target.value)}
                        rows={4}
                        className="w-full bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 rounded-lg p-3 text-sm text-on-surface resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">{t("library.editTagsLabel")}</label>
                      <input
                        type="text"
                        value={editTags}
                        onChange={(e) => setEditTags(e.target.value)}
                        className="w-full bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 rounded-lg px-3 py-2 text-sm text-on-surface"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => saveEdit(entry.id)}
                        disabled={editSaving}
                        className="px-4 py-1.5 bg-primary text-on-primary text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                      >
                        {editSaving ? t("common.loading") : t("library.editSave")}
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="px-4 py-1.5 bg-surface-container text-on-surface-variant text-xs font-semibold rounded-lg hover:bg-surface-container-low transition-colors"
                      >
                        {t("library.editCancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Display Mode ── */
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleSelect(entry.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 w-3.5 h-3.5 accent-primary rounded shrink-0"
                    />
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => startEditing(entry)}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        {entry.category && (
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full ${CATEGORY_COLORS[entry.category] || CATEGORY_COLORS.General}`}
                          >
                            {entry.category}
                          </span>
                        )}
                        {entry.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 bg-primary/5 text-primary text-[10px] font-bold uppercase tracking-wider rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                        <span className="text-[10px] text-on-surface-variant/40">{entry.source_type}</span>
                        {(entry.updated_at || entry.created_at) && (
                          <span className="text-[10px] text-on-surface-variant/40 ml-auto">
                            {t("library.updatedAt", { time: relativeTime(entry.updated_at || entry.created_at || "") })}
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-bold text-on-surface leading-snug">
                        {cleanPattern(entry.question_patterns[0] || "") || t("library.untitled")}
                      </h4>
                      {entry.question_patterns.length > 1 && (
                        <p className="text-xs text-on-surface-variant/60 mt-0.5">
                          +{entry.question_patterns.length - 1} {t("library.altPatterns")}
                        </p>
                      )}
                      <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed line-clamp-3 whitespace-pre-line">
                        {entry.answer}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEditing(entry); }}
                        className="p-1.5 rounded-lg hover:bg-primary/10 text-on-surface-variant hover:text-primary transition-colors"
                        title={t("library.editTooltip")}
                      >
                        <span className="material-symbols-outlined text-lg">edit</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                        className="p-1.5 rounded-lg hover:bg-error/10 text-on-surface-variant hover:text-error transition-colors"
                        title={t("library.deleteTooltip")}
                      >
                        <span className="material-symbols-outlined text-lg">delete</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* sentinel for infinite scroll */}
            <div ref={sentinelRef} className="h-1" />

            {loading && (
              <div className="flex items-center justify-center py-6">
                <span className="material-symbols-outlined text-primary animate-spin text-2xl">autorenew</span>
              </div>
            )}

            {!hasMore && entries.length > 0 && (
              <p className="text-center text-xs text-on-surface-variant/40 py-4">
                {t("library.loadedAll", { n: total })}
              </p>
            )}
          </div>
        )}
      </section>

    </div>
  );
}
