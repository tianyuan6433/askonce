"""
Local knowledge extraction from parsed Pivot+ documents.
No Claude API required - uses regex patterns and document structure.
"""
import asyncio, json, os, re, sys, uuid
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PARSED_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "parsed_docs")

# Doc-to-tag mapping
DOC_TAGS = {
    "FAQs": ["faq"],
    "MAXHUB_Pivot_Plus_FAQ": ["faq"],
    "User_Manual": ["user-guide", "features"],
    "Plan_Differences": ["comparison", "pricing"],
    "Competitive_Product": ["competitive-analysis"],
    "Device_Compatibility": ["compatibility", "hardware"],
    "Pioneer_Program": ["pioneer-program", "sales"],
    "Collaboration_Plan": ["sales", "partnership"],
    "Security_Whitepaper": ["security", "compliance"],
    "leaflets": ["marketing", "overview"],
    "Product_Training": ["training", "sales"],
    "Price": ["pricing"],
    "Read_Before_Installation": ["installation", "setup"],
    "SMU": ["case-study", "security"],
    "St.Lukes": ["case-study"],
    "CMS功能对比": ["cms", "competitive-analysis"],
    "DMS功能迁移": ["dms", "migration"],
    "UC分配平台": ["uc-platform", "user-guide"],
    "cvte": ["competitive-analysis"],
    "DMS-UC分配平台": ["uc-platform", "dms"],
    "Feature_list": ["features", "dms"],
    "User_Guide": ["user-guide", "dms"],
    "Install_Bytello": ["installation"],
    "Device_enroll": ["enrollment", "setup"],
    "DLL_File": ["troubleshooting"],
    "Bytello_DMS_Intro": ["overview", "dms"],
    "Prices": ["pricing", "dms"],
    "统一集控套餐": ["pricing", "legacy"],
}

def get_tags_for_file(filename: str) -> list[str]:
    tags = ["pivot-plus"]
    for key, t in DOC_TAGS.items():
        if key.lower() in filename.lower():
            tags.extend(t)
            break
    return list(set(tags))


def extract_qa_pairs(text: str) -> list[dict]:
    """Extract Q&A pairs from FAQ-style documents."""
    entries = []
    # Pattern: Q: or #### Q: followed by answer
    qa_pattern = re.compile(
        r'(?:#{1,4}\s*)?Q:\s*(.+?)(?:\n+)A:\s*(.+?)(?=(?:#{1,4}\s*)?Q:|$)',
        re.DOTALL
    )
    for m in qa_pattern.finditer(text):
        q = m.group(1).strip()
        a = m.group(2).strip()
        if len(a) > 30 and len(q) > 10:
            # Generate question patterns
            patterns = [q]
            # Add simplified version
            simple = re.sub(r'\([^)]*\)', '', q).strip()
            if simple != q and len(simple) > 10:
                patterns.append(simple)
            entries.append({
                "question_patterns": patterns,
                "answer": a[:2000],  # Cap answer length
                "conditions": None,
            })
    return entries


def extract_sections(text: str, min_content_len: int = 100) -> list[dict]:
    """Extract heading-based sections as knowledge entries."""
    entries = []
    # Split on headings
    sections = re.split(r'\n(#{1,3}\s+.+)\n', text)
    
    i = 1  # Skip preamble
    while i < len(sections) - 1:
        heading = sections[i].strip('#').strip()
        content = sections[i + 1].strip()
        i += 2
        
        if len(content) < min_content_len:
            continue
        if heading.lower() in ('table of contents', 'contents', 'toc'):
            continue
            
        # Create Q patterns from heading
        patterns = [
            f"What is {heading}?",
            f"Tell me about {heading}",
            heading,
        ]
        entries.append({
            "question_patterns": patterns,
            "answer": content[:2000],
            "conditions": None,
        })
    return entries


def extract_training_topics(text: str) -> list[dict]:
    """Extract knowledge from training/presentation documents."""
    entries = []
    paragraphs = text.split('\n\n')
    current_topic = None
    current_content = []
    
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        # Detect topic changes (short sentences ending with ':' or starting with keywords)
        if (len(para) < 100 and (para.endswith(':') or para.endswith('：'))) or \
           re.match(r'^(Now |First|Second|Third|Let me|We also|Those are|Here|Key|Important)', para):
            if current_topic and current_content:
                content = '\n'.join(current_content)
                if len(content) > 80:
                    entries.append({
                        "question_patterns": [
                            f"What about {current_topic}?",
                            current_topic,
                        ],
                        "answer": content[:2000],
                        "conditions": None,
                    })
            current_topic = para.rstrip(':：')[:100]
            current_content = []
        else:
            current_content.append(para)
    
    # Last topic
    if current_topic and current_content:
        content = '\n'.join(current_content)
        if len(content) > 80:
            entries.append({
                "question_patterns": [f"What about {current_topic}?", current_topic],
                "answer": content[:2000],
                "conditions": None,
            })
    return entries


def extract_comparison_table(text: str) -> list[dict]:
    """Extract comparison data from spreadsheet exports."""
    entries = []
    lines = text.strip().split('\n')
    
    if len(lines) < 3:
        return entries
    
    # Try to find tabular data
    header = lines[0] if lines else ""
    data_lines = [l for l in lines[1:] if l.strip()]
    
    if len(data_lines) > 5:
        # Summarize as a single entry
        content = '\n'.join(lines[:50])  # First 50 lines
        entries.append({
            "question_patterns": [
                "Show comparison data",
                "Feature comparison table",
            ],
            "answer": content[:2000],
            "conditions": "Tabular comparison data",
        })
    return entries


def smart_extract(text: str, filename: str) -> list[dict]:
    """Route to the best extraction strategy based on document type."""
    entries = []
    
    # FAQ docs
    if 'faq' in filename.lower() or 'Q:' in text[:5000]:
        entries = extract_qa_pairs(text)
        if entries:
            return entries
    
    # Spreadsheet exports (short, tabular)
    if filename.endswith('.xlsx.txt') and len(text) < 50000:
        entries = extract_comparison_table(text)
        if entries:
            return entries
    
    # Training/presentation docs
    if 'training' in filename.lower() or 'program' in filename.lower():
        entries = extract_training_topics(text)
        if entries:
            return entries
    
    # Section-based docs (with headings)
    if '#' in text[:2000]:
        entries = extract_sections(text)
        if entries:
            return entries
    
    # Fallback: chunk into ~500-word paragraphs
    paragraphs = [p.strip() for p in text.split('\n\n') if len(p.strip()) > 100]
    if paragraphs:
        for i, para in enumerate(paragraphs[:20]):  # Max 20 entries per doc
            first_sentence = para.split('.')[0].strip()[:100]
            entries.append({
                "question_patterns": [first_sentence, f"Paragraph {i+1} content"],
                "answer": para[:2000],
                "conditions": None,
            })
    
    return entries


async def main():
    from app.db.database import async_session, engine, Base
    from app.models.knowledge import KnowledgeEntry, KnowledgeLog
    
    # Init DB
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    txt_files = sorted(Path(PARSED_DIR).glob("*.txt"))
    txt_files = [f for f in txt_files if f.name != "_manifest.json"]
    
    total_entries = 0
    total_files = 0
    
    for txt_path in txt_files:
        text = txt_path.read_text()
        if len(text.strip()) < 50:
            print(f"  ⏭ {txt_path.name} — too short")
            continue
        
        # Skip the massive competitive comparison (6.5M chars of garbled spreadsheet data)
        if len(text) > 500000:
            print(f"  ⏭ {txt_path.name} — too large ({len(text):,} chars), skipping")
            continue
        
        entries = smart_extract(text, txt_path.name)
        if not entries:
            print(f"  ⚠️ {txt_path.name} — no entries extracted")
            continue
        
        tags = get_tags_for_file(txt_path.name)
        # Derive source filename
        source = txt_path.name.replace('.txt', '').replace('__', '/').replace('_', ' ')
        
        saved = 0
        async with async_session() as db:
            for entry in entries:
                entry_tags = list(set(tags + entry.get("extra_tags", [])))
                ke = KnowledgeEntry(
                    id=str(uuid.uuid4()),
                    question_patterns=json.dumps(entry["question_patterns"], ensure_ascii=False),
                    answer=entry["answer"],
                    conditions=entry.get("conditions"),
                    tags=json.dumps(entry_tags, ensure_ascii=False),
                    confidence=0.82,
                    source_type="document",
                    source_ref=source,
                    status="active",
                )
                db.add(ke)
                saved += 1
            
            if saved > 0:
                log = KnowledgeLog(
                    id=str(uuid.uuid4()),
                    action="imported",
                    method="document",
                    count=saved,
                    details=f"Local extraction from {source}",
                    source_filename=txt_path.name,
                )
                db.add(log)
            
            await db.commit()
        
        total_entries += saved
        total_files += 1
        print(f"  ✅ {txt_path.name} → {saved} entries (tags: {', '.join(tags)})")
    
    print(f"\n{'='*60}")
    print(f"🎉 Done: {total_entries} knowledge entries from {total_files} files")
    
    # Show DB totals
    async with async_session() as db:
        from sqlalchemy import func, select
        result = await db.execute(select(func.count()).select_from(KnowledgeEntry))
        total = result.scalar()
        print(f"📊 Total knowledge entries in DB: {total}")


if __name__ == "__main__":
    asyncio.run(main())
