"use client";

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";

export type Locale = "en" | "zh-CN";

type NestedStrings = { [key: string]: string | NestedStrings };
type FlatStrings = Record<string, string>;

function flatten(obj: NestedStrings, prefix = ""): FlatStrings {
  const out: FlatStrings = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  ENGLISH (default)                                                  */
/* ------------------------------------------------------------------ */
const en: NestedStrings = {
  nav: {
    ask: "Ask",
    library: "Library",
    stats: "Analytics",
    settings: "Settings",
    brand: "AskOnce",
    subtitle: "Digital Knowledge Sanctuary",
    collapse: "Collapse",
    expand: "Expand",
  },
  ask: {
    title: "Ask & Smart Reply",
    subtitle: "Input your query or upload a screenshot to generate a sanctuary-grade response.",
    inputZone: "Input Zone",
    processing: "Processing...",
    uploadScreenshot: "Upload Screenshot",
    releaseToUpload: "Release to upload",
    dragHint: "Drag & drop, browse, or Ctrl+V",
    or: "OR",
    directTextQuery: "Direct Text Query",
    textQueryPlaceholder: "Paste or type the customer question here...",
    analyzingText: "Analyzing...",
    analyzeText: "Analyze Text",
    recentDrafts: "RECENT DRAFTS",
    minsAgo: "{n} mins ago",
    hoursAgo: "{n} hours ago",
    // AI Identification
    aiIdentification: "AI Identification",
    analyzingInput: "Analyzing Input...",
    analyzingInputDesc: "AI is identifying the question and context",
    detectedQuestion: "DETECTED QUESTION",
    matchedKnowledge: "Matched {n} knowledge entries",
    tagsContext: "TAGS & CONTEXT",
    scanningCompleted: "SCANNING COMPLETED",
    awaitingInput: "Awaiting Input",
    awaitingInputDesc: "Upload a screenshot or type a query to start AI identification",
    uploadedScreenshot: "Uploaded screenshot",
    // Suggested Answer
    suggestedAnswer: "Suggested Answer",
    generatingResponse: "Generating Response...",
    generatingResponseDesc: "AI is crafting a sanctuary-grade reply",
    confidence: "CONFIDENCE",
    outputLanguage: "Output Language",
    replyChannel: "Reply Channel",
    aiDraftResponse: "AI DRAFT RESPONSE",
    sourcesLabel: "Sources",
    noSourcesWarning: "No matching knowledge entries found. Consider enriching the knowledge base.",
    editDraft: "Edit Draft",
    copyToClipboard: "Copy to Clipboard",
    copied: "Copied!",
    newQuery: "New Query",
    reject: "Reject",
    done: "Done",
    resetDraft: "Reset",
    readyToRespond: "Ready to Respond",
    readyToRespondDesc: "Submit a query to generate an AI-powered response with source verification",
    smartRouting: "Smart Routing Active",
    smartRoutingDesc: "Response verified against knowledge base. Sources are referenced with confidence scoring.",
    // Recent Activity
    draftingHistory: "Drafting Sanctuary History",
    viewFullArchive: "View Full Archive",
    // Status labels
    autoReply: "Auto-replied",
    draft: "Draft pending",
    lowConfidence: "Low confidence",
    // Channels
    channelEmail: "Email",
    channelChat: "Chat/Slack",
    channelLinkedIn: "LinkedIn DM",
    channelIntercom: "Intercom",
    // Languages
    langEnUS: "English (US)",
    langZhCN: "Chinese (Mandarin)",
    langEsES: "Spanish (ES)",
    langFrFR: "French (FR)",
    langJaJP: "Japanese (JP)",
    // Errors
    failedProcessImage: "Failed to process image",
    failedProcessQuery: "Failed to process query",
    failedSendReply: "Failed to send reply",
    // Clarification
    needMoreInfo: "Need more information",
    selectToGetBetterReply: "Please answer these questions so I can give you a more accurate reply",
    previousAnswers: "Previous answers",
    skipAndReply: "Skip",
    submitAnswers: "Submit",
    // Knowledge learning
    knowledgeLearning: "Knowledge Learning",
    knowledgeLearningDesc: "Your edits suggest the knowledge base can be improved. Apply these updates?",
    applyToKnowledge: "Apply",
    dismiss: "Dismiss",
    // Tabs
    tabText: "Text",
    tabImage: "Image",
    tabFile: "File",
    // Reply
    replyLanguage: "Language",
    replyFormat: "Format",
    format_chat: "Chat",
    format_email: "Email",
    format_other: "Other",
    sourcesFound: "sources",
    imageUploaded: "Image uploaded",
    uploadFile: "Upload a file",
    fileHint: "PDF, DOC, TXT, or image files",
    analyzingKnowledge: "Searching knowledge base and generating reply...",
    queryHistory: "Recent Queries",
    viewAllHistory: "View All",
  },
  library: {
    title: "Library",
    subtitle: "Manage your knowledge assets — every entry is a crystallization of team experience.",
    totalEntries: "{n} knowledge entries total",
    addKnowledge: "Add Knowledge",
    collapseImport: "Collapse",
    importKnowledge: "Import Knowledge",
    // Import tabs
    uploadFile: "Upload File",
    pasteText: "Paste Text",
    fileSizeHint: "KB · Click to change",
    dragFileHint: "Drag a file here, or click to browse",
    supportedFormats: "Supports images, PDF, Word, Excel, TXT",
    textPlaceholder: "Paste text content, meeting notes or articles...",
    extracting: "Extracting...",
    extractingProgress: "Extracting {done}/{total} files...",
    extractKnowledge: "Extract Knowledge",
    extractedCount: "Extracted {n} knowledge entries",
    filesSelected: "{n} files selected",
    batchResult: "{successful} succeeded, {failed} failed out of {total} files",
    confirmAllImport: "Confirm Import All",
    importingProgress: "Importing {done}/{total}...",
    imported: "✓ Imported",
    confirmImport: "Confirm Import",
    // Search & filter
    searchPlaceholder: "Search question patterns or answers...",
    allCategories: "All",
    noResultsTitle: "No matching knowledge found",
    noResultsHint: "Try different keywords",
    emptyTitle: "No knowledge yet",
    emptyHint: "Click \"Import Knowledge\" above to start building your knowledge base",
    untitled: "Untitled",
    altPatterns: "Alternate patterns",
    deleteTooltip: "Delete",
    loadedAll: "All {n} knowledge entries loaded",
    // Growth log
    growthLog: "Knowledge Growth Log",
    noLogs: "No logs yet",
    logCreated: "created {n} knowledge entries",
    logExtracted: "extracted {n} knowledge entries",
    logUpdated: "updated {n} knowledge entries",
    logDeleted: "deleted {n} knowledge entries",
    logImported: "imported {n} knowledge entries",
    logVia: "via",
    // Import methods
    methodManual: "manual input",
    methodScreenshot: "screenshot extraction",
    methodDocument: "document import",
    methodApi: "API import",
    methodAuto: "auto extraction",
    methodBatch: "batch extraction",
    // Status
    active: "Active",
    pending: "Pending review",
    stale: "Stale",
    // Edit
    editTooltip: "Edit",
    editSave: "Save",
    editCancel: "Cancel",
    editQuestionsLabel: "Question patterns (one per line)",
    editAnswerLabel: "Answer",
    editTagsLabel: "Tags (comma-separated)",
    // Batch
    selectAll: "Select All",
    deselectAll: "Deselect All",
    deleteSelected: "Delete Selected ({n})",
    deleteSelectedConfirm: "Delete {n} entries?",
    batchDeleting: "Deleting...",
    // Export / Import JSON
    exportJson: "Export JSON",
    importJson: "Import JSON",
    importJsonTab: "JSON File",
    importingJson: "Importing... ({done}/{total})",
    importJsonDone: "Imported {n} entries",
    importJsonError: "Failed to import some entries",
    importJsonHint: "Upload a .json file with an array of knowledge entries",
    // Time
    updatedAt: "Updated {time}",
    // Paste image
    pasteImageProcessing: "Processing pasted image...",
    // File queue
    fileQueuePending: "Pending",
    fileQueueExtracting: "Extracting...",
    fileQueueDone: "{n} entries",
    fileQueueError: "Error",
    fileQueueOverallProgress: "Extracting {done}/{total} files...",
    fileQueueAddMore: "Add more files",
    // Category badges
    categoryProduct: "Product",
    categoryPricing: "Pricing",
    categoryTechnical: "Technical",
    categorySupport: "Support",
    categorySecurity: "Security",
    categoryContent: "Content",
    categoryOrganization: "Organization",
    categoryGeneral: "General",
    // Excel
    exportExcel: "Export Excel",
    importExcelTab: "Excel File",
    importExcelHint: "Upload an Excel file (.xlsx) with knowledge entries",
    importExcelColumns: "Required columns: question_patterns, answer. Optional: tags, category, conditions",
    importingExcel: "Importing... ({done}/{total})",
    feishuLink: "Feishu Link",
    feishuPlaceholder: "Paste a Feishu wiki or document link...",
    feishuHint: "Supports Feishu wiki and docx links. Content will be extracted and converted to knowledge entries.",
    // View modal
    viewTooltip: "View details",
    conditionsLabel: "Conditions / Context",
  },
  stats: {
    title: "Efficiency Analytics",
    subtitle: "Track the impact and accuracy of your AI-powered responses.",
    // Day labels
    mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
    // Activity labels
    autoReplied: "Auto-replied",
    autoRepliedDesc: "{n} queries handled automatically",
    confirmedDrafts: "Confirmed drafts",
    confirmedDraftsDesc: "{n} draft replies approved",
    draftsGenerated: "Drafts generated",
    draftsGeneratedDesc: "{n} drafts awaiting review",
    lowConfidence: "Low confidence",
    lowConfidenceDesc: "{n} queries need attention",
    noActivity: "No activity yet",
    noActivityDesc: "Start asking questions to see activity here",
    // Cards
    timeRecovery: "Time Recovery",
    savedThisPeriod: "saved this period",
    adoptionRate: "Adoption Rate",
    weeklyVolume: "Weekly Interaction Volume",
    volumeTitle: "Interaction Volume",
    interactions: "Interactions",
    confirmed: "Confirmed",
    period_day: "Today",
    period_week: "Week",
    period_month: "Month",
    periodQueries: "Queries",
    periodAdopted: "Adopted",
    adoptionOverview: "Adoption Overview",
    adopted: "adopted",
    knowledgeCoverage: "Knowledge Coverage",
    entries: "entries",
    queries: "queries",
    coverage: "coverage",
    recentActivityLog: "Recent Activity Log",
    saved: "saved",
    // Errors
    failedLoadStats: "Failed to load stats",
    unableToLoad: "Unable to load analytics",
    unexpectedError: "An unexpected error occurred.",
    retry: "Retry",
  },
  settings: {
    title: "Settings",
    subtitle: "Configure your AskOnce environment and AI behavior.",
    // AI Config
    aiConfig: "AI Configuration",
    aiConfigDesc: "Model, endpoint, and confidence settings.",
    claudeModel: "Claude Model",
    apiBaseUrl: "API Base URL",
    autoReplyThreshold: "Auto-Reply Threshold",
    draftThreshold: "Draft Threshold",
    saveAiConfig: "Save AI Config",
    // Data management
    dataManagement: "Data Management",
    dataManagementDesc: "Knowledge retention and upload limits.",
    staleDays: "Knowledge Stale Days",
    maxUploadSize: "Max Upload Size",
    mb: "MB",
    storageUsage: "Storage Usage",
    storageOf: "{used} / {total} MB",
    saveDataSettings: "Save Data Settings",
    // Preferences
    preferences: "Preferences",
    preferencesDesc: "Toggle features on or off.",
    darkMode: "Dark Mode",
    darkModeDesc: "Switch to a darker interface for low-light environments.",
    smartNotifications: "Smart Notifications",
    smartNotificationsDesc: "Only receive alerts when confidence is above threshold.",
    aiSummaries: "AI Summaries",
    aiSummariesDesc: "Generate concise summaries for long knowledge entries.",
    // Footer
    storage: "Storage",
    storageUsed: "{used} MB of {total} MB used",
    storageUsedMb: "{used} MB / {total} GB",
    storageUsedGb: "{used} GB / {total} GB",
    neverExpires: "Permanent — Never Expires",
    signOut: "Sign Out",
    version: "AskOnce v0.1.0",
    // Status
    saving: "Saving...",
    saved: "Saved",
    failedLoadSettings: "Failed to load settings",
    unableToLoad: "Unable to load settings.",
    failedSave: "Failed to save",
    loadingSettings: "Loading settings…",
  },
  common: {
    loading: "Loading...",
    error: "Something went wrong",
    retry: "Retry",
    cancel: "Cancel",
    confirm: "Confirm",
    save: "Save",
    delete: "Delete",
    search: "Search",
    noData: "No data",
    language: "Language",
    justNow: "Just now",
    minsAgo: "{n} min ago",
    hoursAgo: "{n}h ago",
    daysAgo: "{n}d ago",
  },
};

/* ------------------------------------------------------------------ */
/*  SIMPLIFIED CHINESE                                                 */
/* ------------------------------------------------------------------ */
const zhCN: NestedStrings = {
  nav: {
    ask: "智能问答",
    library: "知识库",
    stats: "效率分析",
    settings: "设置",
    brand: "AskOnce",
    subtitle: "数字知识殿堂",
    collapse: "收起",
    expand: "展开",
  },
  ask: {
    title: "智能问答",
    subtitle: "上传截图或输入问题，AI 基于知识库为你生成精准回复",
    inputZone: "输入区",
    processing: "处理中...",
    uploadScreenshot: "上传截图",
    releaseToUpload: "松开即可上传",
    dragHint: "拖拽、浏览或 Ctrl+V 粘贴",
    or: "或",
    directTextQuery: "文字输入",
    textQueryPlaceholder: "粘贴或输入客户问题...",
    analyzingText: "分析中...",
    analyzeText: "分析文本",
    recentDrafts: "最近草稿",
    minsAgo: "{n} 分钟前",
    hoursAgo: "{n} 小时前",
    aiIdentification: "AI 识别结果",
    analyzingInput: "正在分析...",
    analyzingInputDesc: "AI 正在识别问题和上下文",
    detectedQuestion: "检测到的问题",
    matchedKnowledge: "匹配 {n} 条知识",
    tagsContext: "标签与上下文",
    scanningCompleted: "扫描完成",
    awaitingInput: "等待输入",
    awaitingInputDesc: "上传截图或输入问题，开始 AI 识别",
    uploadedScreenshot: "已上传截图",
    suggestedAnswer: "建议回复",
    generatingResponse: "正在生成回复...",
    generatingResponseDesc: "AI 正在为你生成精准回复",
    confidence: "置信度",
    outputLanguage: "输出语言",
    replyChannel: "回复渠道",
    aiDraftResponse: "AI 草稿回复",
    sourcesLabel: "引用来源",
    noSourcesWarning: "未找到相关知识条目，建议补充知识库",
    editDraft: "编辑草稿",
    copyToClipboard: "复制到剪贴板",
    copied: "已复制！",
    newQuery: "新查询",
    reject: "拒绝",
    done: "完成",
    resetDraft: "重置",
    readyToRespond: "准备回复",
    readyToRespondDesc: "提交问题以生成基于知识库的 AI 回复",
    smartRouting: "智能路由已启用",
    smartRoutingDesc: "回复已基于知识库验证，来源已标注置信度评分。",
    draftingHistory: "草稿历史",
    viewFullArchive: "查看完整记录",
    autoReply: "自动回复",
    draft: "草稿待确认",
    lowConfidence: "低置信度",
    channelEmail: "邮件",
    channelChat: "聊天/Slack",
    channelLinkedIn: "LinkedIn 私信",
    channelIntercom: "Intercom",
    langEnUS: "英语 (美国)",
    langZhCN: "中文 (普通话)",
    langEsES: "西班牙语",
    langFrFR: "法语",
    langJaJP: "日语",
    failedProcessImage: "图片处理失败",
    failedProcessQuery: "问题处理失败",
    failedSendReply: "发送回复失败",
    // Clarification
    needMoreInfo: "需要更多信息",
    selectToGetBetterReply: "请回答以下问题，以便给出更准确的回复",
    previousAnswers: "之前的回答",
    skipAndReply: "跳过",
    submitAnswers: "提交",
    // Knowledge learning
    knowledgeLearning: "知识学习",
    knowledgeLearningDesc: "您的修改表明知识库可以改进。是否应用这些更新？",
    applyToKnowledge: "应用",
    dismiss: "忽略",
    tabText: "文字",
    tabImage: "图片",
    tabFile: "文件",
    replyLanguage: "语言",
    replyFormat: "格式",
    format_chat: "聊天",
    format_email: "邮件",
    format_other: "其他",
    sourcesFound: "个来源",
    imageUploaded: "图片已上传",
    uploadFile: "上传文件",
    fileHint: "PDF、DOC、TXT 或图片文件",
    analyzingKnowledge: "正在搜索知识库并生成回复...",
    queryHistory: "最近查询",
    viewAllHistory: "查看全部",
  },
  library: {
    title: "知识库",
    subtitle: "管理你的知识资产，每一条知识都是团队经验的结晶",
    totalEntries: "共 {n} 条知识",
    addKnowledge: "添加知识",
    collapseImport: "收起",
    importKnowledge: "导入知识",
    uploadFile: "上传文件",
    pasteText: "粘贴文本",
    fileSizeHint: "KB · 点击更换",
    dragFileHint: "拖拽文件到这里，或点击浏览",
    supportedFormats: "支持图片、PDF、Word、Excel、TXT",
    textPlaceholder: "粘贴文本内容、会议记录或文章...",
    extracting: "提取中...",
    extractingProgress: "正在提取 {done}/{total} 个文件...",
    extractKnowledge: "提取知识",
    extractedCount: "提取到 {n} 条知识",
    filesSelected: "已选择 {n} 个文件",
    batchResult: "{total} 个文件中 {successful} 个成功，{failed} 个失败",
    confirmAllImport: "全部确认导入",
    importingProgress: "导入中 {done}/{total}...",
    imported: "✓ 已导入",
    confirmImport: "确认导入",
    searchPlaceholder: "搜索问题模式或答案...",
    allCategories: "全部",
    noResultsTitle: "没有找到匹配的知识",
    noResultsHint: "试试其他关键词",
    emptyTitle: "暂无知识",
    emptyHint: "点击上方「导入知识」开始构建知识库",
    untitled: "无标题",
    altPatterns: "其他问法",
    deleteTooltip: "删除",
    loadedAll: "已加载全部 {n} 条知识",
    growthLog: "知识生长日志",
    noLogs: "暂无日志",
    logCreated: "创建了 {n} 条知识",
    logExtracted: "提取了 {n} 条知识",
    logUpdated: "更新了 {n} 条知识",
    logDeleted: "删除了 {n} 条知识",
    logImported: "导入了 {n} 条知识",
    logVia: "通过",
    methodManual: "手动录入",
    methodScreenshot: "截图提取",
    methodDocument: "文档导入",
    methodApi: "API 导入",
    methodAuto: "自动提取",
    methodBatch: "批量提取",
    active: "生效中",
    pending: "待审核",
    stale: "已过期",
    editTooltip: "编辑",
    editSave: "保存",
    editCancel: "取消",
    editQuestionsLabel: "问题模式（每行一个）",
    editAnswerLabel: "答案",
    editTagsLabel: "标签（逗号分隔）",
    selectAll: "全选",
    deselectAll: "取消全选",
    deleteSelected: "删除选中 ({n})",
    deleteSelectedConfirm: "确定删除 {n} 条？",
    batchDeleting: "删除中...",
    exportJson: "导出 JSON",
    importJson: "导入 JSON",
    importJsonTab: "JSON 文件",
    importingJson: "导入中... ({done}/{total})",
    importJsonDone: "已导入 {n} 条",
    importJsonError: "部分导入失败",
    importJsonHint: "上传包含知识条目数组的 .json 文件",
    updatedAt: "{time} 更新",
    pasteImageProcessing: "正在处理粘贴的图片...",
    // File queue
    fileQueuePending: "等待中",
    fileQueueExtracting: "提取中...",
    fileQueueDone: "{n} 条",
    fileQueueError: "出错",
    fileQueueOverallProgress: "正在提取 {done}/{total} 个文件...",
    fileQueueAddMore: "添加更多文件",
    // Category badges
    categoryProduct: "产品",
    categoryPricing: "定价",
    categoryTechnical: "技术",
    categorySupport: "支持",
    categorySecurity: "安全",
    categoryContent: "内容",
    categoryOrganization: "组织",
    categoryGeneral: "通用",
    // Excel
    exportExcel: "导出 Excel",
    importExcelTab: "Excel 文件",
    importExcelHint: "上传包含知识条目的 Excel 文件（.xlsx）",
    importExcelColumns: "必填列：question_patterns、answer。可选列：tags、category、conditions",
    importingExcel: "导入中... ({done}/{total})",
    feishuLink: "飞书链接",
    feishuPlaceholder: "粘贴飞书 Wiki 或文档链接...",
    feishuHint: "支持飞书 Wiki 和文档链接，内容将被提取并转换为知识条目。",
    // View modal
    viewTooltip: "查看详情",
    conditionsLabel: "适用条件 / 上下文",
  },
  stats: {
    title: "效率分析",
    subtitle: "追踪 AI 回复的影响力和准确性",
    mon: "周一", tue: "周二", wed: "周三", thu: "周四", fri: "周五", sat: "周六", sun: "周日",
    autoReplied: "自动回复",
    autoRepliedDesc: "{n} 个查询已自动处理",
    confirmedDrafts: "已确认草稿",
    confirmedDraftsDesc: "{n} 个草稿回复已批准",
    draftsGenerated: "生成草稿",
    draftsGeneratedDesc: "{n} 个草稿等待审核",
    lowConfidence: "低置信度",
    lowConfidenceDesc: "{n} 个查询需要关注",
    noActivity: "暂无活动",
    noActivityDesc: "开始提问以查看活动记录",
    timeRecovery: "时间节省",
    savedThisPeriod: "本期节省",
    adoptionRate: "采纳率",
    weeklyVolume: "每周交互量",
    volumeTitle: "交互量趋势",
    interactions: "交互",
    confirmed: "已确认",
    period_day: "今天",
    period_week: "本周",
    period_month: "本月",
    periodQueries: "查询次数",
    periodAdopted: "已采纳",
    adoptionOverview: "采纳概览",
    adopted: "已采纳",
    knowledgeCoverage: "知识覆盖率",
    entries: "条目",
    queries: "查询",
    coverage: "覆盖率",
    recentActivityLog: "最近活动日志",
    saved: "节省",
    failedLoadStats: "加载统计失败",
    unableToLoad: "无法加载分析数据",
    unexpectedError: "发生意外错误。",
    retry: "重试",
  },
  settings: {
    title: "设置",
    subtitle: "配置你的 AskOnce 环境和 AI 行为",
    aiConfig: "AI 配置",
    aiConfigDesc: "模型、端点和置信度设置。",
    claudeModel: "Claude 模型",
    apiBaseUrl: "API 端点",
    autoReplyThreshold: "自动回复阈值",
    draftThreshold: "草稿阈值",
    saveAiConfig: "保存 AI 配置",
    dataManagement: "数据管理",
    dataManagementDesc: "知识保留期和上传限制。",
    staleDays: "知识过期天数",
    maxUploadSize: "最大上传大小",
    mb: "MB",
    storageUsage: "存储用量",
    storageOf: "{used} / {total} MB",
    saveDataSettings: "保存数据设置",
    preferences: "偏好设置",
    preferencesDesc: "开启或关闭功能。",
    darkMode: "深色模式",
    darkModeDesc: "在低光环境下切换到较暗的界面。",
    smartNotifications: "智能通知",
    smartNotificationsDesc: "仅在置信度超过阈值时推送提醒。",
    aiSummaries: "AI 摘要",
    aiSummariesDesc: "自动为长知识条目生成简要摘要。",
    storage: "存储",
    storageUsed: "已使用 {used} MB / {total} MB",
    storageUsedMb: "{used} MB / {total} GB",
    storageUsedGb: "{used} GB / {total} GB",
    neverExpires: "永久保留 — 永不过期",
    signOut: "退出 AskOnce",
    version: "AskOnce v0.1.0",
    saving: "保存中...",
    saved: "已保存",
    failedLoadSettings: "加载设置失败",
    unableToLoad: "无法加载设置。",
    failedSave: "保存失败",
    loadingSettings: "正在加载设置…",
  },
  common: {
    loading: "加载中...",
    error: "出错了",
    retry: "重试",
    cancel: "取消",
    confirm: "确认",
    save: "保存",
    delete: "删除",
    search: "搜索",
    noData: "暂无数据",
    language: "语言",
    justNow: "刚刚",
    minsAgo: "{n} 分钟前",
    hoursAgo: "{n} 小时前",
    daysAgo: "{n} 天前",
  },
};

/* ------------------------------------------------------------------ */
/*  Flatten & export                                                    */
/* ------------------------------------------------------------------ */
const allTranslations: Record<Locale, FlatStrings> = {
  en: flatten(en),
  "zh-CN": flatten(zhCN),
};

const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  "zh-CN": "中",
};

const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

const LOCALES: Locale[] = ["en", "zh-CN"];

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem("askonce-locale") as Locale;
    if (saved && LOCALES.includes(saved)) {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("askonce-locale", newLocale);
    document.documentElement.lang = newLocale === "en" ? "en" : "zh-Hans";
  }, []);

  const t = useCallback((path: string, vars?: Record<string, string | number>): string => {
    let text = allTranslations[locale]?.[path] ?? allTranslations["en"]?.[path] ?? path;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export { LOCALES, LOCALE_LABELS, LOCALE_NAMES };
export type { Locale as LocaleType };
