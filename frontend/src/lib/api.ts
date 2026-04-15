function getApiBase(): string {
  // Use env var if set (for production/Railway deployment)
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  // In browser: use current hostname so LAN access works automatically
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8000`;
  }
  // Server-side fallback
  return "http://localhost:8000";
}

const API_BASE = getApiBase();

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Ask API
export interface ClarificationQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface AskResponse {
  id: string;
  query: string;
  draft_reply: string | null;
  draft_reply_en: string | null;
  draft_reply_zh: string | null;
  confidence: number;
  sources: Array<{
    id: string;
    question_patterns: string[];
    answer: string;
    score: number;
    tags: string[];
  }>;
  status: "auto_reply" | "draft" | "low_confidence" | "clarification";
  elapsed_ms: number;
  clarification_questions?: ClarificationQuestion[];
}

export interface ImageAskResponse {
  id: string;
  detected_question: string;
  tags: string[];
  image_url: string | null;
  draft_reply: string;
  draft_reply_en: string | null;
  draft_reply_zh: string | null;
  confidence: number;
  sources: Array<{
    id: string;
    question_patterns: string[];
    answer: string;
    score: number;
    tags: string[];
  }>;
  status: string;
  elapsed_ms?: number;
}

export async function askQuestion(
  query: string,
  options?: { channel?: string; reply_lang?: string; reply_format?: string }
): Promise<AskResponse> {
  return fetchAPI<AskResponse>("/api/ask/", {
    method: "POST",
    body: JSON.stringify({
      query,
      channel: options?.channel || "manual",
      reply_lang: options?.reply_lang || "en",
      reply_format: options?.reply_format || "chat",
    }),
  });
}

export interface FollowupAnswer {
  question_id: string;
  question_text: string;
  answer: string;
}

export async function askFollowup(
  interactionId: string,
  originalQuery: string,
  answers: FollowupAnswer[],
  options?: { reply_lang?: string; reply_format?: string }
): Promise<AskResponse> {
  return fetchAPI<AskResponse>("/api/ask/followup", {
    method: "POST",
    body: JSON.stringify({
      interaction_id: interactionId,
      original_query: originalQuery,
      answers,
      reply_lang: options?.reply_lang || "en",
      reply_format: options?.reply_format || "chat",
    }),
  });
}

export async function askWithImage(file: File, context?: string): Promise<ImageAskResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (context) formData.append("context", context);

  const res = await fetch(`${API_BASE}/api/ask/image`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface HistoryItem {
  id: string;
  query: string;
  draft_reply: string | null;
  final_reply: string | null;
  confidence: number;
  edit_ratio: number | null;
  status: string;
  channel: string;
  created_at: string | null;
  resolved_at: string | null;
}

export async function getHistory(limit: number = 5, offset: number = 0): Promise<{
  items: HistoryItem[];
  total: number;
}> {
  return fetchAPI(`/api/ask/history?limit=${limit}&offset=${offset}`);
}

export interface LearningSuggestion {
  action: "update" | "add";
  entry_id?: string;
  reason: string;
  suggested_answer?: string;
  question_patterns?: string[];
  answer?: string;
  tags?: string[];
  category?: string;
}

export async function confirmReply(interactionId: string, editedReply?: string): Promise<{
  status: string;
  interaction_id: string;
  edit_ratio: number;
  learning_suggestions: LearningSuggestion[];
}> {
  return fetchAPI("/api/ask/reply/confirm", {
    method: "POST",
    body: JSON.stringify({ interaction_id: interactionId, edited_reply: editedReply }),
  });
}

export async function applyLearningSuggestion(suggestion: LearningSuggestion) {
  return fetchAPI("/api/knowledge/apply-learning", {
    method: "POST",
    body: JSON.stringify(suggestion),
  });
}

export async function suggestMerges(): Promise<{
  suggestions: Array<{
    ids: string[];
    reason: string;
    merged_question_patterns: string[];
    merged_answer: string;
    merged_tags: string[];
    merged_category: string;
  }>;
  total_entries: number;
}> {
  return fetchAPI("/api/knowledge/suggest-merges", { method: "POST" });
}

export async function mergeEntries(request: {
  source_ids: string[];
  merged_question_patterns: string[];
  merged_answer: string;
  merged_tags: string[];
  merged_category: string;
}) {
  return fetchAPI("/api/knowledge/merge", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// Knowledge API
export interface KnowledgeEntry {
  id: string;
  question_patterns: string[];
  answer: string;
  conditions: string | null;
  tags: string[];
  category?: string;
  confidence: number;
  source_type: string;
  source_ref: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface KnowledgeListResponse {
  items: KnowledgeEntry[];
  total: number;
  page: number;
  page_size: number;
}

export async function listKnowledge(params?: {
  page?: number;
  page_size?: number;
  tag?: string;
  status?: string;
  search?: string;
  locale?: string;
  category?: string;
}): Promise<KnowledgeListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.page_size) searchParams.set("page_size", String(params.page_size));
  if (params?.tag) searchParams.set("tag", params.tag);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.search) searchParams.set("search", params.search);
  if (params?.locale) searchParams.set("locale", params.locale);
  if (params?.category) searchParams.set("category", params.category);

  const qs = searchParams.toString();
  return fetchAPI<KnowledgeListResponse>(`/api/knowledge/${qs ? `?${qs}` : ""}`);
}

export async function translateKnowledge(entryIds: string[], locale: string): Promise<{ translated: number }> {
  return fetchAPI<{ translated: number }>("/api/knowledge/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry_ids: entryIds, locale }),
  });
}

export async function createKnowledge(data: {
  question_patterns: string[];
  answer: string;
  conditions?: string;
  tags?: string[];
}): Promise<KnowledgeEntry> {
  return fetchAPI<KnowledgeEntry>("/api/knowledge/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateKnowledge(id: string, data: { question_patterns: string[]; answer: string; tags: string[]; conditions?: string }): Promise<KnowledgeEntry> {
  return fetchAPI<KnowledgeEntry>(`/api/knowledge/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteKnowledge(id: string) {
  return fetchAPI(`/api/knowledge/${id}`, { method: "DELETE" });
}

export async function importDocument(file: File): Promise<{
  status: string;
  filename: string;
  text_length: number;
  entries: Array<{
    question_patterns: string[];
    answer: string;
    tags: string[];
    conditions?: string;
  }>;
}> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/knowledge/import-document`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error: ${res.status}`);
  }
  return res.json();
}

export async function extractKnowledge(file?: File, text?: string) {
  const formData = new FormData();
  if (file) {
    formData.append("file", file);
  } else {
    formData.append("text", text || "");
  }
  const res = await fetch(`${API_BASE}/api/knowledge/extract`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error: ${res.status}`);
  }
  return res.json();
}

export async function exportKnowledgeExcel(entries: KnowledgeEntry[]): Promise<void> {
  const { utils, writeFile } = await import("xlsx");
  const rows = entries.map((e) => ({
    question_patterns: e.question_patterns.join(" | "),
    answer: e.answer,
    tags: e.tags.join(", "),
    category: e.category || "",
    conditions: e.conditions || "",
    source_type: e.source_type,
    status: e.status,
  }));
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Knowledge");
  writeFile(wb, `knowledge-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function importKnowledgeExcel(file: File): Promise<Array<{
  question_patterns: string[];
  answer: string;
  tags: string[];
  conditions?: string;
}>> {
  const { read, utils } = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json<Record<string, string>>(ws);
  return rows
    .filter((row) => row.answer || row.question_patterns)
    .map((row) => ({
      question_patterns: row.question_patterns
        ? row.question_patterns.split("|").map((s: string) => s.trim()).filter(Boolean)
        : ["Unknown"],
      answer: row.answer || "",
      tags: row.tags ? row.tags.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
      conditions: row.conditions || undefined,
    }));
}

export interface BatchExtractResponse {
  total_files: number;
  successful: number;
  failed: number;
  entries: Array<{
    question_patterns?: string[];
    answer?: string;
    tags?: string[];
    conditions?: string;
  }>;
}

export async function extractKnowledgeBatch(files: File[]): Promise<BatchExtractResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const res = await fetch(`${API_BASE}/api/knowledge/extract-batch`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error: ${res.status}`);
  }
  return res.json();
}

export async function extractFromFeishu(url: string): Promise<{ status: string; entries: Array<Record<string, unknown>> }> {
  return fetchAPI("/api/knowledge/extract-feishu", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

// Stats API
export interface StatsOverview {
  total_knowledge_entries: number;
  total_interactions: number;
  adoption_rate: number;    // average edit_ratio * 100 (0-100%)
  adopted_count: number;    // number of interactions with copy action
  avg_confidence: number;
  auto_reply_count: number;
  draft_reply_count: number;
  low_confidence_count: number;
  confirmed_count: number;
}

export interface TrendDataPoint {
  label: string;
  interactions: number;
  confirmed: number;
}

export interface TrendsResponse {
  period: string;
  data: TrendDataPoint[];
  prev_data: TrendDataPoint[];
  summary: {
    current_total: number;
    current_confirmed: number;
    prev_total: number;
    prev_confirmed: number;
    total_change_pct: number | null;
    confirmed_change_pct: number | null;
  };
}

export async function getStatsOverview(): Promise<StatsOverview> {
  return fetchAPI<StatsOverview>("/api/stats/overview");
}

export async function getTrends(period = "week"): Promise<TrendsResponse> {
  return fetchAPI<TrendsResponse>(`/api/stats/trends?period=${period}`);
}

// Settings API
export interface AppSettings {
  claude_model: string;
  claude_api_base: string;
  confidence_auto_reply: number;
  confidence_draft_min: number;
  knowledge_stale_days: number;
  max_upload_size_mb: number;
  dark_mode: boolean;
  smart_notifications: boolean;
  ai_summaries: boolean;
  storage_limit_gb: number;
  storage_used_mb: number;
}

export async function getSettings(): Promise<AppSettings> {
  return fetchAPI<AppSettings>("/api/settings/");
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return fetchAPI<AppSettings>("/api/settings/", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

// Knowledge Logs
export interface KnowledgeLogEntry {
  id: string;
  action: string;
  method: string;
  count: number;
  details: string | null;
  source_filename: string | null;
  created_at: string;
}

export interface KnowledgeLogsResponse {
  items: KnowledgeLogEntry[];
  total: number;
  page: number;
  page_size: number;
}

export async function getKnowledgeLogs(page = 1, pageSize = 50): Promise<KnowledgeLogsResponse> {
  return fetchAPI<KnowledgeLogsResponse>(`/api/knowledge/logs?page=${page}&page_size=${pageSize}`);
}
