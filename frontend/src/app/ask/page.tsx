"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { askQuestion, askWithImage, askFollowup, getHistory, streamAsk, translateText } from "@/lib/api";
import type { ClarificationQuestion, FollowupAnswer, HistoryItem, StreamCompleteData, StreamClarificationData } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type InputTab = "text" | "image" | "file";

interface AskState {
  isProcessing: boolean;
  interactionId: string | null;
  detectedQuestion: string | null;
  tags: string[];
  imagePreviewUrl: string | null;
  draftReply: string | null;
  draftReplyEn: string | null;
  draftReplyZh: string | null;
  confidence: number;
  sources: Array<{ id: string; question_patterns: string[]; answer: string; score: number }>;
  status: string | null;
  error: string | null;
  // Clarification state
  clarificationQuestions: ClarificationQuestion[];
  followupHistory: FollowupAnswer[];
}

interface HistoryEntry {
  id: string;
  query: string;
  reply: string;
  timestamp: Date;
  elapsed_ms: number;
  lang: string;
  format: string;
}

const INITIAL_STATE: AskState = {
  isProcessing: false,
  interactionId: null,
  detectedQuestion: null,
  tags: [],
  imagePreviewUrl: null,
  draftReply: null,
  draftReplyEn: null,
  draftReplyZh: null,
  confidence: 0,
  sources: [],
  status: null,
  error: null,
  clarificationQuestions: [],
  followupHistory: [],
};

export default function AskPage() {
  const [state, setState] = useState<AskState>(INITIAL_STATE);
  const { t, locale } = useI18n();
  const [inputTab, setInputTab] = useState<InputTab>("text");
  const [queryText, setQueryText] = useState("");
  const [editedReplyEn, setEditedReplyEn] = useState("");
  const [editedReplyZh, setEditedReplyZh] = useState("");
  const [editedReply, setEditedReply] = useState(""); // backward compat alias
  const [isRetranslating, setIsRetranslating] = useState(false);
  const retranslateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedLang, setCopiedLang] = useState<"en" | "zh" | null>(null);
  const [replyLang, setReplyLang] = useState<"en" | "zh">(locale.startsWith("zh") ? "zh" : "en");
  const [replyFormat, setReplyFormat] = useState<"chat" | "email" | "other">("chat");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Clarification answers (keyed by question id)
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [progressPercent, setProgressPercent] = useState(0);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Conversation messages for clarification flow
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const [followupInput, setFollowupInput] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const clarifyRef = useRef<HTMLDivElement>(null);
  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clarificationRound, setClarificationRound] = useState(0);
  const [originalQuery, setOriginalQuery] = useState("");

  // Typewriter buffer: tokens arrive in chunks, we render char-by-char
  const tokenBufferRef = useRef("");
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTypewriter = useCallback(() => {
    if (typewriterTimerRef.current) return; // already running
    typewriterTimerRef.current = setInterval(() => {
      if (tokenBufferRef.current.length === 0) return;
      // Drain up to 3 chars per tick for natural speed
      const chars = tokenBufferRef.current.slice(0, 3);
      tokenBufferRef.current = tokenBufferRef.current.slice(3);
      setStreamingText((prev) => prev + chars);
    }, 20);
  }, []);

  const stopTypewriter = useCallback((flush?: boolean) => {
    if (typewriterTimerRef.current) {
      clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
    if (flush && tokenBufferRef.current.length > 0) {
      // Flush remaining buffer
      const remaining = tokenBufferRef.current;
      tokenBufferRef.current = "";
      setStreamingText((prev) => prev + remaining);
    }
  }, []);

  // Textarea typewriter: types text into EN/ZH textareas char-by-char
  const textareaTypewriterRef = useRef<{ en: string; zh: string; timer: ReturnType<typeof setInterval> | null }>({ en: "", zh: "", timer: null });
  const [isTranslating, setIsTranslating] = useState(false);

  const startTextareaTypewriter = useCallback((enText: string, zhText: string) => {
    // Stop any running textarea typewriter
    if (textareaTypewriterRef.current.timer) {
      clearInterval(textareaTypewriterRef.current.timer);
    }
    textareaTypewriterRef.current = { en: enText, zh: zhText, timer: null };
    setEditedReplyEn("");
    setEditedReplyZh("");
    setEditedReply("");
    const charsPerTick = 5;
    let enPos = 0;
    let zhPos = 0;
    textareaTypewriterRef.current.timer = setInterval(() => {
      const buf = textareaTypewriterRef.current;
      let enDone = enPos >= buf.en.length;
      let zhDone = zhPos >= buf.zh.length;
      if (!enDone) {
        const nextEn = Math.min(enPos + charsPerTick, buf.en.length);
        const enSlice = buf.en.slice(0, nextEn);
        enPos = nextEn;
        setEditedReplyEn(enSlice);
        setEditedReply(enSlice);
        enDone = enPos >= buf.en.length;
      }
      if (!zhDone) {
        const nextZh = Math.min(zhPos + charsPerTick, buf.zh.length);
        zhPos = nextZh;
        setEditedReplyZh(buf.zh.slice(0, nextZh));
        zhDone = zhPos >= buf.zh.length;
      }
      if (enDone && zhDone) {
        clearInterval(buf.timer!);
        buf.timer = null;
      }
    }, 15);
  }, []);

  const appendTranslation = useCallback((zhText: string) => {
    // When translation arrives, typewriter it into ZH
    setIsTranslating(false);
    const buf = textareaTypewriterRef.current;
    buf.zh = zhText;
    // If timer already stopped (EN finished), start new one for ZH
    if (!buf.timer) {
      let zhPos = 0;
      buf.timer = setInterval(() => {
        const nextZh = Math.min(zhPos + 5, buf.zh.length);
        zhPos = nextZh;
        setEditedReplyZh(buf.zh.slice(0, nextZh));
        if (zhPos >= buf.zh.length) {
          clearInterval(buf.timer!);
          buf.timer = null;
        }
      }, 15);
    }
  }, []);
  const [learningSuggestions, setLearningSuggestions] = useState<Array<{
    action: string;
    reason: string;
    entry_id?: string;
    suggested_answer?: string;
    question_patterns?: string[];
    answer?: string;
    tags?: string[];
    category?: string;
  }>>([]);

  // Server-side history
  const [serverHistory, setServerHistory] = useState<HistoryItem[]>([]);
  const [serverHistoryTotal, setServerHistoryTotal] = useState(0);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [allHistory, setAllHistory] = useState<HistoryItem[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string | null>(null);

  // Fetch recent history on mount
  useEffect(() => {
    getHistory(5, 0).then((res) => {
      setServerHistory(res.items);
      setServerHistoryTotal(res.total);
    }).catch(() => {});
  }, []);

  // Refresh recent history after each new query
  const refreshHistory = useCallback(() => {
    getHistory(5, 0).then((res) => {
      setServerHistory(res.items);
      setServerHistoryTotal(res.total);
    }).catch(() => {});
  }, []);

  // Load all history when panel opens
  const openHistoryPanel = useCallback(async () => {
    setShowHistoryPanel(true);
    try {
      const res = await getHistory(100, 0, historySearch || undefined, historyStatusFilter || undefined);
      setAllHistory(res.items);
      if (res.items.length > 0 && !selectedHistoryItem) {
        setSelectedHistoryItem(res.items[0]);
      }
    } catch { /* ignore */ }
  }, [selectedHistoryItem, historySearch, historyStatusFilter]);

  // Re-fetch history when search/filter changes
  useEffect(() => {
    if (showHistoryPanel) {
      getHistory(100, 0, historySearch || undefined, historyStatusFilter || undefined)
        .then((res) => { setAllHistory(res.items); })
        .catch(() => {});
    }
  }, [historySearch, historyStatusFilter, showHistoryPanel]);

  // Keep editedReply in sync with draftReply
  const updateDraft = (replyEn: string | null, replyZh: string | null) => {
    if (replyEn !== null) { setEditedReplyEn(replyEn); setEditedReply(replyEn); }
    if (replyZh !== null) setEditedReplyZh(replyZh);
  };

  // Auto-translate: when user edits Chinese, debounce and re-translate to English (and vice versa)
  const handleZhEdit = useCallback((newText: string) => {
    setEditedReplyZh(newText);
    if (retranslateTimerRef.current) clearTimeout(retranslateTimerRef.current);
    retranslateTimerRef.current = setTimeout(async () => {
      if (!newText.trim()) return;
      setIsRetranslating(true);
      try {
        const result = await translateText(newText, "en");
        setEditedReplyEn(result.translated);
        setEditedReply(result.translated);
      } catch { /* ignore */ }
      setIsRetranslating(false);
    }, 1200);
  }, []);

  const handleEnEdit = useCallback((newText: string) => {
    setEditedReplyEn(newText);
    setEditedReply(newText);
    if (retranslateTimerRef.current) clearTimeout(retranslateTimerRef.current);
    retranslateTimerRef.current = setTimeout(async () => {
      if (!newText.trim()) return;
      setIsRetranslating(true);
      try {
        const result = await translateText(newText, "zh");
        setEditedReplyZh(result.translated);
      } catch { /* ignore */ }
      setIsRetranslating(false);
    }, 1200);
  }, []);

  // Auto-resize both textareas when content changes
  const replyZhTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const taEn = replyTextareaRef.current;
    const taZh = replyZhTextareaRef.current;
    if (taEn) {
      taEn.style.height = "auto";
      taEn.style.height = `${taEn.scrollHeight}px`;
    }
    if (taZh) {
      taZh.style.height = "auto";
      taZh.style.height = `${taZh.scrollHeight}px`;
    }
  }, [editedReplyEn, editedReplyZh]);

  // Auto-scroll conversation to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, thinkingStatus, streamingText]);

  // Auto-scroll to clarification options
  useEffect(() => {
    if (state.clarificationQuestions.length > 0)
      clarifyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [state.clarificationQuestions]);

  // Simulated progress bar for loading state
  const startProgress = useCallback(() => {
    setProgressPercent(0);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    let p = 0;
    progressTimerRef.current = setInterval(() => {
      p += Math.random() * 8 + 2;
      if (p > 90) p = 90;
      setProgressPercent(Math.round(p));
    }, 300);
  }, []);

  const stopProgress = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setProgressPercent(100);
    setTimeout(() => setProgressPercent(0), 400);
  }, []);

  // Add to history when a result comes in
  const addToHistory = useCallback((query: string, reply: string, elapsed: number) => {
    setHistory((prev) => [{
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      query,
      reply,
      timestamp: new Date(),
      elapsed_ms: elapsed,
      lang: replyLang,
      format: replyFormat,
    }, ...prev.slice(0, 49)]);
    refreshHistory();
  }, [replyLang, replyFormat, refreshHistory]);

  const handleImageUpload = useCallback(async (file: File) => {
    const imageUrl = URL.createObjectURL(file);
    setImagePreview(imageUrl);
    setState((prev) => ({
      ...prev,
      isProcessing: true,
      error: null,
      imagePreviewUrl: imageUrl,
      detectedQuestion: null,
      draftReply: null,
      draftReplyEn: null,
      draftReplyZh: null,
    }));

    try {
      const response = await askWithImage(file);
      setState({
        isProcessing: false,
        interactionId: response.id,
        detectedQuestion: response.detected_question,
        tags: response.tags || [],
        imagePreviewUrl: imageUrl,
        draftReply: response.draft_reply,
        draftReplyEn: response.draft_reply_en || response.draft_reply,
        draftReplyZh: response.draft_reply_zh || "",
        confidence: response.confidence,
        sources: response.sources || [],
        status: response.status,
        error: null,
        clarificationQuestions: [],
        followupHistory: [],
      });
      updateDraft(response.draft_reply_en || response.draft_reply, response.draft_reply_zh || "");
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: err instanceof Error ? err.message : t("ask.failedProcessImage"),
      }));
    }
  }, [t]);

  const handleTextSubmit = useCallback(async () => {
    const text = queryText.trim();
    if (!text) return;
    setOriginalQuery(text);
    setState((prev) => ({
      ...prev,
      isProcessing: true,
      error: null,
      detectedQuestion: null,
      draftReply: null,
      draftReplyEn: null,
      draftReplyZh: null,
      imagePreviewUrl: null,
      clarificationQuestions: [],
      followupHistory: [],
    }));
    setClarifyAnswers({});
    setSelectedOptions(new Set());
    stopTypewriter();
    tokenBufferRef.current = "";
    setStreamingText("");
    setIsStreaming(true);
    setThinkingStatus("analyzing");
    startProgress();

    // Add user message to chat
    setChatMessages((prev) => [...prev, { role: "user" as const, text }]);

    try {
      await streamAsk(text, {
        onThinking: (status) => {
          setThinkingStatus(status);
        },
        onSession: (sid) => {
          setSessionId(sid);
        },
        onToken: (token) => {
          setThinkingStatus(null);
          // Check for raw JSON clarification tokens
          const testBuf = tokenBufferRef.current + token;
          if (testBuf.trimStart().startsWith('{"type":"clarification"') || testBuf.trimStart().startsWith('{\"type\":\"clarification\"')) {
            tokenBufferRef.current = "";
            return; // Don't show raw JSON to user
          }
          tokenBufferRef.current += token;
          startTypewriter();
        },
        onTranslating: () => {
          setThinkingStatus("translating");
        },
        onClarification: (data: StreamClarificationData) => {
          stopTypewriter();
          tokenBufferRef.current = "";
          setStreamingText("");
          stopProgress();
          setIsStreaming(false);
          setThinkingStatus(null);
          setClarificationRound(data.round);
          const aiText = data.questions.map((q) => q.text).join("\n");
          setChatMessages((prev) => [...prev, { role: "ai" as const, text: aiText }]);
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            interactionId: data.interaction_id,
            detectedQuestion: text,
            confidence: 0,
            sources: [],
            status: "clarification",
            clarificationQuestions: data.questions,
          }));
        },
        onComplete: (data: StreamCompleteData) => {
          stopTypewriter(true); // flush remaining buffer
          tokenBufferRef.current = "";
          stopProgress();
          setIsStreaming(false);
          setStreamingText("");
          setThinkingStatus(null);
          setChatMessages((prev) => [...prev, { role: "ai" as const, text: data.reply_en || data.reply_zh }]);
          setState({
            isProcessing: false,
            interactionId: data.id,
            detectedQuestion: data.query,
            tags: [],
            imagePreviewUrl: null,
            draftReply: data.reply_en,
            draftReplyEn: data.reply_en,
            draftReplyZh: data.reply_zh,
            confidence: data.confidence,
            sources: (data.sources || []) as AskState["sources"],
            status: data.status,
            error: null,
            clarificationQuestions: [],
            followupHistory: [],
          });
          addToHistory(originalQuery || text, data.reply_en, data.elapsed_ms || 0);

          // Typewriter for bilingual textareas
          const replyText = data.reply_en || data.reply_zh;
          const cjkCount = (replyText || "").match(/[\u4e00-\u9fff]/g)?.length || 0;
          const isChinese = cjkCount / Math.max((replyText || "").length, 1) > 0.3;

          if (data.reply_zh && data.reply_en) {
            // Both available — typewriter both
            startTextareaTypewriter(data.reply_en, data.reply_zh);
          } else if (replyText) {
            // Only one language — typewriter it, lazy-translate the other
            setIsTranslating(true);
            if (isChinese) {
              startTextareaTypewriter("", replyText);
            } else {
              startTextareaTypewriter(replyText, "");
            }
            const targetLang = isChinese ? "en" : "zh";
            translateText(replyText, targetLang).then((res) => {
              if (isChinese) {
                appendTranslation(""); // EN side
                setEditedReplyEn(res.translated);
                setEditedReply(res.translated);
                setState((prev) => ({ ...prev, draftReplyEn: res.translated }));
              } else {
                appendTranslation(res.translated);
                setState((prev) => ({ ...prev, draftReplyZh: res.translated }));
              }
            }).catch(() => { setIsTranslating(false); });
          }
        },
        onTranslation: (data: { reply_en: string; reply_zh: string }) => {
          // Update bilingual columns when translation arrives
          updateDraft(data.reply_en, data.reply_zh);
        },
        onError: (err) => {
          stopProgress();
          setIsStreaming(false);
          setStreamingText("");
          setThinkingStatus(null);
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            error: err.message,
          }));
        },
      }, {
        reply_lang: replyLang,
        reply_format: replyFormat,
        session_id: sessionId || undefined,
      });
    } catch (err) {
      stopProgress();
      setIsStreaming(false);
      setStreamingText("");
      setThinkingStatus(null);
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: err instanceof Error ? err.message : t("ask.failedProcessQuery"),
      }));
    }
  }, [queryText, replyLang, replyFormat, sessionId, t, addToHistory, startProgress, stopProgress]);

  const handleReset = useCallback(() => {
    setState(INITIAL_STATE);
    setEditedReply("");
    setEditedReplyEn("");
    setEditedReplyZh("");
    setQueryText("");
    setChatMessages([]);
    setFollowupInput("");
    setImagePreview(null);
    setIsStreaming(false);
    setStreamingText("");
    setThinkingStatus(null);
    setSessionId(null);
    setClarificationRound(0);
    setOriginalQuery("");
    setHistorySearch("");
    setHistoryStatusFilter(null);
  }, []);

  const handleCopy = async (lang?: "en" | "zh") => {
    const textToCopy = lang === "zh" ? editedReplyZh : editedReplyEn;
    navigator.clipboard.writeText(textToCopy);
    setCopiedLang(lang || "en");
    setCopied(true);
    setTimeout(() => { setCopied(false); setCopiedLang(null); }, 2000);
    // Track adoption: mark interaction as confirmed/edited
    if (state.interactionId) {
      try {
        const { confirmReply } = await import("@/lib/api");
        const originalEn = state.draftReplyEn || state.draftReply || "";
        const edited = editedReplyEn !== originalEn ? editedReplyEn : undefined;
        const result = await confirmReply(state.interactionId, edited);
        // Show learning suggestions if user made significant edits
        if (result.learning_suggestions && result.learning_suggestions.length > 0) {
          setLearningSuggestions(result.learning_suggestions);
        }
      } catch { /* silent */ }
    }
  };

  // Submit clarification answers and get final reply
  const handleClarifySubmit = useCallback(async () => {
    if (!state.interactionId || state.clarificationQuestions.length === 0) return;
    // Build answers array
    const answers: FollowupAnswer[] = state.clarificationQuestions.map((q) => ({
      question_id: q.id,
      question_text: q.text,
      answer: clarifyAnswers[q.id] || q.options[0] || "",
    }));

    setState((prev) => ({ ...prev, isProcessing: true, error: null }));
    startProgress();

    try {
      const response = await askFollowup(
        state.interactionId,
        queryText.trim(),
        answers,
        { reply_lang: replyLang, reply_format: replyFormat }
      );
      stopProgress();

      if (response.status === "clarification" && response.clarification_questions?.length) {
        // Another round of clarification
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          clarificationQuestions: response.clarification_questions || [],
          followupHistory: [...prev.followupHistory, ...answers],
        }));
        setClarifyAnswers({});
        setSelectedOptions(new Set());
      } else {
        // Got final reply
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          draftReply: response.draft_reply,
          draftReplyEn: response.draft_reply_en || response.draft_reply,
          draftReplyZh: response.draft_reply_zh || "",
          status: response.status,
          clarificationQuestions: [],
          followupHistory: [...prev.followupHistory, ...answers],
        }));
        updateDraft(response.draft_reply_en || response.draft_reply || "", response.draft_reply_zh || "");
        addToHistory(queryText.trim(), response.draft_reply || "", response.elapsed_ms || 0);
      }
    } catch (err) {
      stopProgress();
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: err instanceof Error ? err.message : t("ask.failedProcessQuery"),
      }));
    }
  }, [state.interactionId, state.clarificationQuestions, clarifyAnswers, queryText, replyLang, replyFormat, t, startProgress, stopProgress, addToHistory]);

  // Conversational follow-up: user types a free-text reply to AI's clarification
  const handleConversationSend = useCallback(async () => {
    const text = followupInput.trim();
    if (!text) return;

    setChatMessages((prev) => [...prev, { role: "user" as const, text }]);
    setFollowupInput("");
    setSelectedOptions(new Set());
    setStreamingText("");
    setIsStreaming(true);
    setThinkingStatus("analyzing");
    setState((prev) => ({ ...prev, isProcessing: true, error: null }));

    try {
      await streamAsk(text, {
        onThinking: (status) => setThinkingStatus(status),
        onSession: (sid) => setSessionId(sid),
        onToken: (token) => {
          setThinkingStatus(null);
          const testBuf = tokenBufferRef.current + token;
          if (testBuf.trimStart().startsWith('{"type":"clarification"') || testBuf.trimStart().startsWith('{\"type\":\"clarification\"')) {
            tokenBufferRef.current = "";
            return;
          }
          tokenBufferRef.current += token;
          startTypewriter();
        },
        onTranslating: () => setThinkingStatus("translating"),
        onClarification: (data: StreamClarificationData) => {
          stopTypewriter();
          tokenBufferRef.current = "";
          setIsStreaming(false);
          setThinkingStatus(null);
          setClarificationRound(data.round);
          const aiText = data.questions.map((q) => q.text).join("\n");
          setChatMessages((prev) => [...prev, { role: "ai" as const, text: aiText }]);
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            interactionId: data.interaction_id,
            clarificationQuestions: data.questions,
          }));
        },
        onComplete: (data: StreamCompleteData) => {
          stopTypewriter(true);
          tokenBufferRef.current = "";
          setIsStreaming(false);
          setStreamingText("");
          setThinkingStatus(null);
          setChatMessages((prev) => [...prev, { role: "ai" as const, text: data.reply_en || data.reply_zh }]);
          setState({
            isProcessing: false,
            interactionId: data.id,
            detectedQuestion: data.query,
            tags: [],
            imagePreviewUrl: null,
            draftReply: data.reply_en,
            draftReplyEn: data.reply_en,
            draftReplyZh: data.reply_zh,
            confidence: data.confidence,
            sources: (data.sources || []) as AskState["sources"],
            status: data.status,
            error: null,
            clarificationQuestions: [],
            followupHistory: [],
          });
          addToHistory(originalQuery || queryText.trim(), data.reply_en, data.elapsed_ms || 0);

          // Typewriter for bilingual textareas (same as initial ask)
          const replyText = data.reply_en || data.reply_zh;
          const cjkCount = (replyText || "").match(/[\u4e00-\u9fff]/g)?.length || 0;
          const isChinese = cjkCount / Math.max((replyText || "").length, 1) > 0.3;

          if (data.reply_zh && data.reply_en) {
            startTextareaTypewriter(data.reply_en, data.reply_zh);
          } else if (replyText) {
            setIsTranslating(true);
            if (isChinese) {
              startTextareaTypewriter("", replyText);
            } else {
              startTextareaTypewriter(replyText, "");
            }
            const targetLang = isChinese ? "en" : "zh";
            translateText(replyText, targetLang).then((res) => {
              if (isChinese) {
                appendTranslation("");
                setEditedReplyEn(res.translated);
                setEditedReply(res.translated);
              } else {
                appendTranslation(res.translated);
              }
            }).catch(() => { setIsTranslating(false); });
          }
        },
        onTranslation: (data: { reply_en: string; reply_zh: string }) => {
          updateDraft(data.reply_en, data.reply_zh);
        },
        onError: () => {
          stopTypewriter();
          tokenBufferRef.current = "";
          setIsStreaming(false);
          setStreamingText("");
          setThinkingStatus(null);
          setState((prev) => ({ ...prev, isProcessing: false }));
          setChatMessages((prev) => [...prev, { role: "ai" as const, text: "Failed to process. Please try again." }]);
        },
      }, {
        reply_lang: replyLang,
        reply_format: replyFormat,
        session_id: sessionId || undefined,
      });
    } catch {
      setIsStreaming(false);
      setState((prev) => ({ ...prev, isProcessing: false }));
      setChatMessages((prev) => [...prev, { role: "ai" as const, text: "Failed to process. Please try again." }]);
    }
  }, [followupInput, queryText, replyLang, replyFormat, sessionId, addToHistory]);

  const hasClarification = state.status === "clarification" && state.clarificationQuestions.length > 0;
  const hasResult = !!state.draftReply && !state.isProcessing;

  // Language switch: re-ask with different language hint
  const handleLangSwitch = async (lang: "en" | "zh") => {
    setReplyLang(lang);
    if (!state.detectedQuestion && !queryText.trim()) return;
    const text = state.detectedQuestion || queryText.trim();
    if (!text) return;
    setState((prev) => ({ ...prev, isProcessing: true, error: null }));
    try {
      const response = await askQuestion(text, {
        reply_lang: lang,
        reply_format: replyFormat,
      });
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        draftReply: response.draft_reply,
        draftReplyEn: response.draft_reply_en || response.draft_reply,
        draftReplyZh: response.draft_reply_zh || "",
        confidence: response.confidence,
        sources: response.sources || [],
      }));
      updateDraft(response.draft_reply_en || response.draft_reply, response.draft_reply_zh || "");
    } catch {
      setState((prev) => ({ ...prev, isProcessing: false }));
    }
  };

  const handleFormatSwitch = async (fmt: "chat" | "email" | "other") => {
    setReplyFormat(fmt);
    if (!state.detectedQuestion && !queryText.trim()) return;
    const text = state.detectedQuestion || queryText.trim();
    if (!text) return;
    setState((prev) => ({ ...prev, isProcessing: true, error: null }));
    try {
      const response = await askQuestion(text, {
        reply_lang: replyLang,
        reply_format: fmt,
      });
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        draftReply: response.draft_reply,
        draftReplyEn: response.draft_reply_en || response.draft_reply,
        draftReplyZh: response.draft_reply_zh || "",
        confidence: response.confidence,
        sources: response.sources || [],
      }));
      updateDraft(response.draft_reply_en || response.draft_reply, response.draft_reply_zh || "");
    } catch {
      setState((prev) => ({ ...prev, isProcessing: false }));
    }
  };

  const confidenceColor = state.confidence >= 0.9
    ? "text-emerald-600"
    : state.confidence >= 0.6
    ? "text-amber-600"
    : "text-red-500";

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page header — compact */}
      <div className="mb-6">
        <h2 className="text-2xl font-extrabold text-on-surface tracking-tight mb-1">
          {t("ask.title")}
        </h2>
        <p className="text-on-surface-variant text-sm">{t("ask.subtitle")}</p>
      </div>

      {state.error && (
        <div className="mb-4 p-3 bg-error-container/10 border border-error/20 rounded-xl text-error text-sm">
          {state.error}
        </div>
      )}

      {/* ═══ LEFT: INPUT CARD (transitions to result summary) ═══ */}
      <div className="bg-surface-container-lowest rounded-2xl border border-primary/5 shadow-sm mb-6">
        {hasResult ? (
          /* ── Result Summary (compact, replaces input) ── */
          <div className="p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-primary text-xl">psychology</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-on-surface mb-1">
                {state.detectedQuestion || queryText}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {state.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 bg-secondary-container text-on-secondary-container text-[10px] font-bold rounded-full">
                    {tag}
                  </span>
                ))}
                <span className={`text-[11px] font-bold ${confidenceColor}`}>
                  {Math.round(state.confidence * 100)}% {t("ask.confidence")}
                </span>
                {state.sources.length > 0 && (
                  <span className="text-[11px] text-on-surface-variant">
                    · {state.sources.length} {t("ask.sourcesFound")}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleReset}
              className="shrink-0 px-3 py-1.5 bg-surface-container-high text-on-surface-variant text-xs font-bold rounded-lg hover:bg-surface-container-highest transition-colors"
            >
              <span className="material-symbols-outlined text-sm align-middle mr-1">refresh</span>
              {t("ask.newQuery")}
            </button>
          </div>
        ) : (
          /* ── Input Mode ── */
          <div className="p-5">
            {/* Tab switcher */}
            <div className="flex items-center gap-1 mb-4">
              {(["text", "image", "file"] as InputTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setInputTab(tab)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                    inputTab === tab
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  <span className="material-symbols-outlined text-sm align-middle mr-1">
                    {tab === "text" ? "edit_note" : tab === "image" ? "image" : "upload_file"}
                  </span>
                  {tab === "text" ? t("ask.tabText") : tab === "image" ? t("ask.tabImage") : t("ask.tabFile")}
                </button>
              ))}
            </div>

            {/* Text input */}
            {inputTab === "text" && (
              <div className="flex gap-3">
                <textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleTextSubmit(); } }}
                  className="flex-1 bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 rounded-xl px-4 py-3 text-sm text-on-surface resize-none"
                  rows={2}
                  placeholder={t("ask.textQueryPlaceholder")}
                  disabled={state.isProcessing}
                />
                <button
                  onClick={handleTextSubmit}
                  disabled={!queryText.trim() || state.isProcessing}
                  className="self-end px-5 py-3 bg-primary text-on-primary text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
                >
                  {state.isProcessing ? (
                    <span className="material-symbols-outlined text-sm animate-spin">autorenew</span>
                  ) : (
                    <span className="material-symbols-outlined text-sm">send</span>
                  )}
                </button>
              </div>
            )}

            {/* Image input */}
            {inputTab === "image" && (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file?.type.startsWith("image/")) handleImageUpload(file);
                }}
                onPaste={(e) => {
                  for (const item of Array.from(e.clipboardData?.items || [])) {
                    if (item.type.startsWith("image/")) {
                      const file = item.getAsFile();
                      if (file) { handleImageUpload(file); break; }
                    }
                  }
                }}
                onClick={() => !imagePreview && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 flex items-center justify-center gap-4 cursor-pointer transition-all ${
                  isDragging ? "border-primary bg-primary/5" : "border-outline-variant/30 hover:border-primary/50"
                }`}
              >
                {imagePreview ? (
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagePreview} alt="Preview" className="h-16 w-16 rounded-lg object-cover" />
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{state.isProcessing ? t("ask.processing") : t("ask.imageUploaded")}</p>
                      {state.isProcessing && <span className="material-symbols-outlined text-primary text-sm animate-spin ml-2">autorenew</span>}
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-primary text-2xl">cloud_upload</span>
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{t("ask.uploadScreenshot")}</p>
                      <p className="text-xs text-on-surface-variant">{t("ask.dragHint")}</p>
                    </div>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file);
                }} className="hidden" />
              </div>
            )}

            {/* File input (same as image for now) */}
            {inputTab === "file" && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-xl p-6 flex items-center justify-center gap-4 cursor-pointer border-outline-variant/30 hover:border-primary/50 transition-colors"
              >
                <span className="material-symbols-outlined text-primary text-2xl">upload_file</span>
                <div>
                  <p className="text-sm font-semibold text-on-surface">{t("ask.uploadFile")}</p>
                  <p className="text-xs text-on-surface-variant">{t("ask.fileHint")}</p>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.doc,.docx" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file);
                }} className="hidden" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ CONVERSATION / CLARIFICATION ═══ */}
      {hasClarification && (
        <div className="bg-surface-container-lowest rounded-2xl border border-primary/10 shadow-xl overflow-hidden">
          {/* Chat messages area */}
          <div className="max-h-[400px] overflow-y-auto p-4 space-y-3">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-on-primary rounded-br-md"
                    : "bg-amber-50 text-on-surface border border-amber-200/50 rounded-bl-md"
                }`}>
                  {msg.role === "ai" && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="material-symbols-outlined text-amber-600 text-sm">smart_toy</span>
                      <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Need more info</span>
                      {clarificationRound > 0 && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-2">
                          Round {clarificationRound}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            ))}
            {/* Thinking animation */}
            {thinkingStatus && (
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs">🤖</div>
                <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-gray-600">
                  <span className="inline-flex items-center gap-1">
                    {thinkingStatus === "analyzing" ? "Analyzing your question" :
                     thinkingStatus === "summarizing" ? "Summarizing conversation" :
                     thinkingStatus === "translating" ? "Translating reply" : "Thinking"}
                    <span className="inline-flex gap-0.5">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: "0ms"}} />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: "150ms"}} />
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: "300ms"}} />
                    </span>
                  </span>
                </div>
              </div>
            )}
            {/* Streaming text bubble */}
            {isStreaming && streamingText && (
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs">🤖</div>
                <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-gray-800 max-w-[85%]">
                  {streamingText}
                  <span className="inline-block w-0.5 h-4 bg-blue-500 ml-0.5 animate-pulse" />
                </div>
              </div>
            )}
            {state.isProcessing && (
              <div className="flex justify-start">
                <div className="bg-surface-container rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-xs text-on-surface-variant">{t("ask.generatingResponse")}</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick option buttons (multi-select) */}
          {!state.isProcessing && state.clarificationQuestions.some((q) => q.options?.length > 0) && (
            <div ref={clarifyRef} className="px-4 pb-2">
              <p className="text-[10px] text-on-surface-variant/60 mb-1.5">Select one or more options:</p>
              <div className="flex flex-wrap gap-1.5">
                {state.clarificationQuestions.flatMap((q) =>
                  (q.options || []).map((opt) => {
                    const isSelected = selectedOptions.has(opt);
                    return (
                      <button
                        key={`${q.id}-${opt}`}
                        onClick={() => {
                          setSelectedOptions(prev => {
                            const next = new Set(prev);
                            if (next.has(opt)) next.delete(opt); else next.add(opt);
                            const joined = Array.from(next).join(", ");
                            setFollowupInput(joined);
                            return next;
                          });
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                          isSelected
                            ? "bg-primary text-on-primary border-primary"
                            : "bg-surface-container border-outline-variant/20 hover:border-primary/40 hover:bg-primary/5"
                        }`}
                      >
                        {isSelected && <span className="mr-1">✓</span>}
                        {opt}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Input area */}
          {!state.isProcessing && (
            <div className="border-t border-outline-variant/10 p-3 flex items-center gap-2">
              <input
                type="text"
                value={followupInput}
                onChange={(e) => setFollowupInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleConversationSend(); } }}
                placeholder="Type your answer..."
                className="flex-1 px-4 py-2.5 text-sm border border-outline-variant/20 rounded-xl bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none"
                autoFocus
              />
              <button
                onClick={handleConversationSend}
                disabled={!followupInput.trim()}
                className="p-2.5 rounded-xl bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-lg">send</span>
              </button>
              <button
                onClick={() => {
                  // Skip — generate with what we have
                  setChatMessages([]);
                  setState((prev) => ({ ...prev, clarificationQuestions: [], status: null }));
                }}
                className="p-2.5 rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors"
                title={t("ask.skipAndReply")}
              >
                <span className="material-symbols-outlined text-lg">skip_next</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ RIGHT: REPLY AREA (main focus) ═══ */}
      {(hasResult || state.isProcessing) && (
        <div className="bg-surface-container-lowest rounded-2xl border border-primary/10 shadow-xl">
          {/* Top toolbar: format selector + dual copy buttons */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-outline-variant/10">
            {/* Format selector */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mr-2">{t("ask.replyFormat")}</span>
              {(["chat", "email", "other"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => handleFormatSwitch(fmt)}
                  disabled={state.isProcessing}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    replyFormat === fmt ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  {t(`ask.format_${fmt}`)}
                </button>
              ))}
            </div>
            {/* Dual copy buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopy("en")}
                disabled={!hasResult}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-br from-primary to-primary-dim text-on-primary text-xs font-bold rounded-xl shadow-md shadow-primary/20 hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-sm">{copied && copiedLang === "en" ? "check" : "content_copy"}</span>
                {copied && copiedLang === "en" ? t("ask.copied") : "Copy EN"}
              </button>
              <button
                onClick={() => handleCopy("zh")}
                disabled={!hasResult || !editedReplyZh}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-br from-tertiary to-tertiary-dim text-on-tertiary text-xs font-bold rounded-xl shadow-md shadow-tertiary/20 hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-sm">{copied && copiedLang === "zh" ? "check" : "content_copy"}</span>
                {copied && copiedLang === "zh" ? t("ask.copied") : "Copy 中文"}
              </button>
            </div>
          </div>

          {/* Bilingual reply content — two columns */}
          <div className="p-6">
            {state.isProcessing ? (
              <div className="py-8">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-on-surface">{t("ask.generatingResponse")}</p>
                  <span className="text-xs text-on-surface-variant">{progressPercent}%</span>
                </div>
                <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-primary-dim rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-on-surface-variant mt-2">{t("ask.analyzingKnowledge")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {/* English column */}
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-outline-variant/10">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest bg-primary/10 px-2 py-0.5 rounded">EN</span>
                    <span className="text-[11px] text-on-surface-variant">English</span>
                    {isRetranslating && <span className="text-[10px] text-primary animate-pulse">syncing...</span>}
                    <button
                      onClick={async () => {
                        if (!editedReplyZh.trim()) return;
                        setIsRetranslating(true);
                        try {
                          const result = await translateText(editedReplyZh, "en");
                          setEditedReplyEn(result.translated);
                          setEditedReply(result.translated);
                        } catch { /* ignore */ }
                        setIsRetranslating(false);
                      }}
                      disabled={isRetranslating || !editedReplyZh.trim()}
                      className="ml-auto text-[10px] text-primary hover:text-primary/70 font-medium disabled:opacity-30"
                      title="Translate from Chinese"
                    >
                      ← {t("ask.syncFromZh") || "Sync from 中文"}
                    </button>
                  </div>
                  <textarea
                    ref={replyTextareaRef}
                    value={editedReplyEn}
                    onChange={(e) => handleEnEdit(e.target.value)}
                    className="w-full bg-transparent border-none focus:ring-0 text-sm leading-relaxed text-on-surface resize-none outline-none"
                    rows={4}
                    placeholder="English reply..."
                  />
                </div>
                {/* Chinese column */}
                <div className="flex flex-col border-l border-outline-variant/10 pl-4">
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-outline-variant/10">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest bg-tertiary/10 px-2 py-0.5 rounded">中文</span>
                    <span className="text-[11px] text-on-surface-variant">Chinese</span>
                    {(isRetranslating || isTranslating) && <span className="text-[10px] text-tertiary animate-pulse">{isTranslating ? "Translating..." : "syncing..."}</span>}
                    <button
                      onClick={async () => {
                        if (!editedReplyEn.trim()) return;
                        setIsRetranslating(true);
                        try {
                          const result = await translateText(editedReplyEn, "zh");
                          setEditedReplyZh(result.translated);
                        } catch { /* ignore */ }
                        setIsRetranslating(false);
                      }}
                      disabled={isRetranslating || !editedReplyEn.trim()}
                      className="ml-auto text-[10px] text-primary hover:text-primary/70 font-medium disabled:opacity-30"
                      title="Translate from English"
                    >
                      ← {t("ask.syncFromEn") || "Sync from EN"}
                    </button>
                  </div>
                  <textarea
                    ref={replyZhTextareaRef}
                    value={editedReplyZh}
                    onChange={(e) => handleZhEdit(e.target.value)}
                    className="w-full bg-transparent border-none focus:ring-0 text-sm leading-relaxed text-on-surface resize-none outline-none"
                    rows={4}
                    placeholder="中文回复..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ KNOWLEDGE LEARNING SUGGESTIONS ═══ */}
      {learningSuggestions.length > 0 && (
        <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-emerald-600">psychology</span>
            <h3 className="text-sm font-bold text-emerald-800">{t("ask.knowledgeLearning")}</h3>
            <span className="text-xs text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">{learningSuggestions.length}</span>
          </div>
          <p className="text-xs text-emerald-700 mb-3">{t("ask.knowledgeLearningDesc")}</p>
          <div className="space-y-2">
            {learningSuggestions.map((s, i) => (
              <div key={i} className="bg-white rounded-xl p-3 border border-emerald-100">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.action === "update" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                    {s.action === "update" ? "Update" : "New"}
                  </span>
                  <span className="text-xs text-gray-600">{s.reason}</span>
                </div>
                <p className="text-sm text-gray-800 line-clamp-2">{s.suggested_answer || s.answer}</p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={async () => {
                      try {
                        const { applyLearningSuggestion } = await import("@/lib/api");
                        await applyLearningSuggestion(s as Parameters<typeof applyLearningSuggestion>[0]);
                        setLearningSuggestions((prev) => prev.filter((_, idx) => idx !== i));
                      } catch { /* ignore */ }
                    }}
                    className="text-xs px-3 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                  >
                    {t("ask.applyToKnowledge")}
                  </button>
                  <button
                    onClick={() => setLearningSuggestions((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-xs px-3 py-1 text-gray-500 hover:text-gray-700"
                  >
                    {t("ask.dismiss")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state when no result */}
      {!hasResult && !state.isProcessing && (
        <div className="text-center py-16 text-on-surface-variant/40">
          <span className="material-symbols-outlined text-5xl mb-4 block">smart_toy</span>
          <p className="text-sm font-medium">{t("ask.readyToRespond")}</p>
          <p className="text-xs mt-1">{t("ask.readyToRespondDesc")}</p>
        </div>
      )}

      {/* ═══ RECENT QUERIES (Server history — last 5) ═══ */}
      {serverHistory.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-on-surface-variant flex items-center gap-2">
              <span className="material-symbols-outlined text-base">history</span>
              {t("ask.queryHistory")}
              <span className="text-xs text-on-surface-variant/60 font-normal ml-1">({serverHistoryTotal})</span>
            </h3>
            {serverHistoryTotal > 5 && (
              <button
                onClick={openHistoryPanel}
                className="text-xs text-primary font-bold hover:underline flex items-center gap-1"
              >
                {t("ask.viewAllHistory")}
                <span className="material-symbols-outlined text-sm">chevron_right</span>
              </button>
            )}
          </div>
          <div className="space-y-2">
            {serverHistory.map((item) => (
              <div
                key={item.id}
                className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 cursor-pointer hover:border-primary/20 transition-colors group"
                onClick={() => {
                  setSelectedHistoryItem(item);
                  setShowHistoryPanel(true);
                  // Also load all history
                  getHistory(100, 0, historySearch || undefined, historyStatusFilter || undefined).then((res) => setAllHistory(res.items)).catch(() => {});
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-on-surface truncate flex-1 mr-4">{item.query}</p>
                  <div className="flex items-center gap-3 shrink-0">
                    {item.status === "confirmed" && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">✓ Used</span>
                    )}
                    <span className={`text-xs font-bold ${item.confidence >= 0.9 ? "text-emerald-600" : item.confidence >= 0.6 ? "text-amber-600" : "text-red-500"}`}>
                      {Math.round(item.confidence * 100)}%
                    </span>
                    {item.created_at && (
                      <span className="text-xs text-on-surface-variant/60">
                        {new Date(item.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-on-surface-variant line-clamp-1">{item.draft_reply || item.final_reply || "⏳ Clarification in progress"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ FULL HISTORY DETAIL PANEL (modal overlay) ═══ */}
      {showHistoryPanel && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-8">
          <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden border border-outline-variant/20">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined">history</span>
                {t("ask.queryHistory")}
                <span className="text-sm text-on-surface-variant font-normal">({allHistory.length})</span>
              </h2>
              <button
                onClick={() => setShowHistoryPanel(false)}
                className="p-2 rounded-xl hover:bg-surface-container transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {/* Split layout */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left sidebar: questions list */}
              <div className="w-[340px] border-r border-outline-variant/10 overflow-y-auto">
                {/* Search and filters */}
                <div className="p-3 border-b border-gray-200 space-y-2">
                  <input
                    type="text"
                    placeholder="Search queries..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <div className="flex gap-1 flex-wrap">
                    {["all", "pending", "confirmed", "edited"].map((s) => (
                      <button
                        key={s}
                        onClick={() => setHistoryStatusFilter(s === "all" ? null : s)}
                        className={`px-2 py-0.5 text-xs rounded-full border ${
                          (s === "all" && !historyStatusFilter) || historyStatusFilter === s
                            ? "bg-blue-500 text-white border-blue-500"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                {allHistory.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedHistoryItem(item)}
                    className={`px-4 py-3 cursor-pointer border-b border-outline-variant/5 transition-colors ${
                      selectedHistoryItem?.id === item.id
                        ? "bg-primary/10 border-l-2 border-l-primary"
                        : "hover:bg-surface-container"
                    }`}
                  >
                    <p className="text-sm font-semibold text-on-surface truncate">{item.query}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-bold ${item.confidence >= 0.9 ? "text-emerald-600" : item.confidence >= 0.6 ? "text-amber-600" : "text-red-500"}`}>
                        {Math.round(item.confidence * 100)}%
                      </span>
                      {item.status === "confirmed" && (
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">Used</span>
                      )}
                      {item.edit_ratio !== null && item.edit_ratio < 1 && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">Edited</span>
                      )}
                      {item.created_at && (
                        <span className="text-[10px] text-on-surface-variant/50">
                          {new Date(item.created_at).toLocaleDateString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {allHistory.length === 0 && (
                  <div className="p-8 text-center text-on-surface-variant/40 text-sm">No history yet</div>
                )}
              </div>
              {/* Right panel: detail view */}
              <div className="flex-1 overflow-y-auto p-6">
                {selectedHistoryItem ? (
                  <div>
                    <h3 className="text-base font-bold text-on-surface mb-4">{selectedHistoryItem.query}</h3>
                    {/* Metadata chips */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        selectedHistoryItem.confidence >= 0.9 ? "bg-emerald-100 text-emerald-700"
                        : selectedHistoryItem.confidence >= 0.6 ? "bg-amber-100 text-amber-700"
                        : "bg-red-100 text-red-700"
                      }`}>
                        Confidence: {Math.round(selectedHistoryItem.confidence * 100)}%
                      </span>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                        selectedHistoryItem.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
                      }`}>
                        {selectedHistoryItem.status === "confirmed" ? "✓ Adopted" : selectedHistoryItem.status}
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant">
                        {selectedHistoryItem.channel}
                      </span>
                      {selectedHistoryItem.edit_ratio !== null && (
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          selectedHistoryItem.edit_ratio >= 0.95 ? "bg-emerald-100 text-emerald-700"
                          : selectedHistoryItem.edit_ratio >= 0.7 ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                        }`}>
                          {selectedHistoryItem.edit_ratio >= 0.95 ? "No edits" : `Edit ratio: ${Math.round(selectedHistoryItem.edit_ratio * 100)}%`}
                        </span>
                      )}
                      {selectedHistoryItem.created_at && (
                        <span className="text-xs text-on-surface-variant/60">
                          {new Date(selectedHistoryItem.created_at).toLocaleString(locale)}
                        </span>
                      )}
                    </div>
                    {/* Conversation log */}
                    {selectedHistoryItem?.conversation_log && selectedHistoryItem.conversation_log.length > 0 && (
                      <div className="space-y-2 mb-4">
                        <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Conversation</h4>
                        {selectedHistoryItem.conversation_log.map((msg, i) => (
                          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                              msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {msg.content}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Draft reply */}
                    <div className="mb-4">
                      <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">AI Draft Reply</h4>
                      <div className="bg-surface-container rounded-xl p-4 text-sm leading-relaxed text-on-surface whitespace-pre-wrap">
                        {selectedHistoryItem.draft_reply || selectedHistoryItem.final_reply || "⏳ Clarification in progress — no reply generated yet"}
                      </div>
                    </div>
                    {/* Final reply (if different) */}
                    {selectedHistoryItem.final_reply && selectedHistoryItem.final_reply !== selectedHistoryItem.draft_reply && (
                      <div className="mb-4">
                        <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Final Reply (after edit)</h4>
                        <div className="bg-emerald-50 rounded-xl p-4 text-sm leading-relaxed text-on-surface whitespace-pre-wrap border border-emerald-200">
                          {selectedHistoryItem.final_reply}
                        </div>
                      </div>
                    )}
                    {/* Re-use this reply */}
                    <button
                      onClick={() => {
                        const reply = selectedHistoryItem.final_reply || selectedHistoryItem.draft_reply || "";
                        setQueryText(selectedHistoryItem.query);
                        setEditedReply(reply);
                        setEditedReplyEn(reply);
                        setEditedReplyZh("");
                        setState((prev) => ({
                          ...prev,
                          draftReply: reply,
                          draftReplyEn: reply,
                          draftReplyZh: "",
                          detectedQuestion: selectedHistoryItem.query,
                        }));
                        setShowHistoryPanel(false);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-xl hover:opacity-90 transition-opacity"
                    >
                      <span className="material-symbols-outlined text-sm">replay</span>
                      Re-use this reply
                    </button>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-on-surface-variant/40">
                    <div className="text-center">
                      <span className="material-symbols-outlined text-4xl mb-2 block">arrow_back</span>
                      <p className="text-sm">Select a query to view details</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
