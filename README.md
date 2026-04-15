# 🤖 AskOnce — 海外业务 AI 智能应答与活知识库平台

> **为海外业务团队，解决知识分散、传递衰减导致的客户咨询回复效率瓶颈，用 AI RAG + 活知识库，将单条咨询回复时间从 15 分钟缩短至 2 分钟。**

---

## 📋 目录

- [项目简介](#-项目简介)
- [核心功能](#-核心功能)
- [技术架构](#-技术架构)
- [项目结构](#-项目结构)
- [快速启动](#-快速启动)
- [产品截图](#-产品截图)
- [License](#-license)

---

## 🎯 项目简介

**AskOnce** 是一款面向海外业务团队的 AI 智能应答平台。通过 RAG（检索增强生成）技术 + 活知识库机制，让业务人员在面对客户技术咨询时，只需「问一次」即可获得专业、精准、可追溯的回复建议。

### 🔥 解决的核心痛点

| 痛点 | 现状 | AskOnce 方案 |
|------|------|-------------|
| 知识分散 | 产品知识散落在文档、聊天记录、个人经验中 | 统一知识库，AI 自动检索 |
| 传递衰减 | 新人需要反复请教老员工，老员工被频繁打断 | AI 替代人工传递，知识永不衰减 |
| 回复效率低 | 单条咨询平均需要 15 分钟查找 + 组织回复 | AI 生成建议回复，2 分钟完成 |
| 经验难沉淀 | 优秀回复无法被复用，每次都从零开始 | 编辑即学习，每次回复都让知识库更聪明 |

---

## ✨ 核心功能

### 🧠 智能问答（AI Smart Reply）
- 粘贴客户咨询内容，AI 基于知识库自动生成专业回复建议
- 支持中英双语输入输出，自动识别语言并匹配
- 展示引用来源，回复可追溯

### 📚 知识库管理（Living Knowledge Base）
- 支持手动创建知识条目
- 支持批量导入文档（Word / PDF / Excel）
- 按渠道（Channel）分类管理知识

### 🔄 多轮澄清（Clarification Flow）
- 当用户问题不够明确时，AI 主动提出澄清问题
- 多轮对话逐步收窄问题范围，提升回复精准度

### ✅ 采纳率追踪（Adoption Tracking）
- 用户可对 AI 回复进行「采纳」「编辑后采纳」「拒绝」操作
- 系统自动统计采纳率，量化 AI 产出质量

### ✏️ 编辑即学习（Edit-to-Learn）
- 用户编辑 AI 回复后采纳，编辑内容自动回流知识库
- 知识库持续进化，越用越聪明

### 📊 数据统计（Analytics Dashboard）
- 实时统计总咨询数、采纳率、平均响应时间
- 按渠道、按时间维度分析使用情况
- 数据导出功能

### 🖼️ 图片问答（Image Q&A）
- 支持上传图片（产品截图、错误界面等）
- AI 结合图片内容与知识库生成回复

### 🌐 中英双语（Bilingual Support）
- 界面支持中英文
- AI 回复自动适配客户语言

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────┐
│                   Frontend                       │
│       Next.js 16 + React 19 + TypeScript         │
│           Tailwind CSS + Heroicons                │
├─────────────────────────────────────────────────┤
│                    REST API                       │
├─────────────────────────────────────────────────┤
│                   Backend                         │
│         FastAPI + SQLAlchemy + aiosqlite          │
│              Anthropic SDK (Claude)               │
├─────────────────────────────────────────────────┤
│                   AI Engine                       │
│          Claude Sonnet 4.6 (via Anthropic)        │
│          RAG: 知识检索 + 上下文增强生成             │
└─────────────────────────────────────────────────┘
```

### 技术栈详情

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | Next.js 16 + React 19 | App Router, Server Components |
| **前端样式** | Tailwind CSS | 响应式设计，深色/浅色主题 |
| **前端语言** | TypeScript | 类型安全，开发体验优秀 |
| **后端框架** | FastAPI | 高性能异步 Python Web 框架 |
| **ORM** | SQLAlchemy 2.0 (async) | 异步数据库操作 |
| **数据库** | SQLite + aiosqlite | 轻量级，零配置，适合单机部署 |
| **AI 模型** | Claude Sonnet 4.6 | Anthropic 最新模型，推理能力强 |
| **文档解析** | python-docx / PyPDF2 / openpyxl | 支持 Word、PDF、Excel 导入 |

---

## 📁 项目结构

```
askonce/
├── backend/                    # 后端服务
│   ├── app/
│   │   ├── api/                # API 路由层
│   │   │   ├── ask.py          # 智能问答接口
│   │   │   ├── knowledge.py    # 知识库管理接口
│   │   │   ├── channels.py     # 渠道管理接口
│   │   │   ├── stats.py        # 数据统计接口
│   │   │   └── settings.py     # 系统设置接口
│   │   ├── services/           # 业务逻辑层
│   │   │   ├── claude_service.py      # AI 调用服务
│   │   │   ├── retrieval_service.py   # 知识检索服务 (RAG)
│   │   │   ├── knowledge_service.py   # 知识库服务
│   │   │   ├── document_service.py    # 文档解析服务
│   │   │   ├── image_service.py       # 图片处理服务
│   │   │   └── feishu_service.py      # 飞书集成服务
│   │   ├── models/             # 数据模型层
│   │   │   ├── knowledge.py    # 知识条目模型
│   │   │   └── interaction.py  # 交互记录模型
│   │   ├── db/                 # 数据库配置
│   │   ├── config.py           # 应用配置
│   │   └── main.py             # 应用入口
│   ├── data/                   # 初始数据
│   ├── scripts/                # 工具脚本
│   ├── uploads/                # 上传文件目录
│   └── requirements.txt        # Python 依赖
├── frontend/                   # 前端应用
│   ├── src/
│   │   ├── app/                # Next.js App Router
│   │   │   ├── ask/            # 智能问答页面
│   │   │   ├── library/        # 知识库页面
│   │   │   ├── stats/          # 数据统计页面
│   │   │   └── settings/       # 系统设置页面
│   │   ├── components/         # 可复用组件
│   │   │   ├── layout/         # 布局组件
│   │   │   ├── ui/             # 通用 UI 组件
│   │   │   ├── ask/            # 问答相关组件
│   │   │   └── library/        # 知识库相关组件
│   │   └── lib/                # 工具函数与 API 客户端
│   ├── public/                 # 静态资源
│   ├── package.json            # Node.js 依赖
│   └── tailwind.config.ts      # Tailwind 配置
├── docs/                       # 项目文档
├── docker-compose.yml          # Docker 编排
├── .env.example                # 环境变量模板
└── README.md                   # 项目说明（本文件）
```

---

## 🚀 快速启动

### 环境要求

- **Python** 3.11+
- **Node.js** 20+
- **Anthropic API Key**（Claude 模型访问）

### 1. 克隆项目

```bash
git clone <repo-url>
cd askonce
```

### 2. 配置环境变量

```bash
cp .env.example backend/.env
# 编辑 backend/.env，填入你的 Anthropic API Key
```

`.env` 文件内容：
```env
ASKONCE_CLAUDE_API_KEY=your-api-key-here
ASKONCE_CLAUDE_API_BASE=https://api.anthropic.com
ASKONCE_CLAUDE_MODEL=claude-sonnet-4-20250514
```

### 3. 启动后端

```bash
cd backend

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动服务（默认端口 8000）
uvicorn app.main:app --reload --port 8000
```

### 4. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器（默认端口 3000）
npm run dev
```

### 5. 访问应用

打开浏览器访问 **http://localhost:3000**，即可开始使用 AskOnce。

---

## 📸 产品截图

> 📌 截图待补充

| 功能 | 截图 |
|------|------|
| 智能问答主界面 | *待补充* |
| 知识库管理 | *待补充* |
| 数据统计面板 | *待补充* |
| 多轮澄清对话 | *待补充* |
| 编辑即学习 | *待补充* |

---

## 📄 License

本项目仅供内部使用（Internal Use Only）。未经授权，不得对外分发或商用。

---

<p align="center">
  <b>AskOnce</b> — 问一次，就够了。<br/>
  Built with ❤️ by MAXHUB 海外业务团队
</p>
