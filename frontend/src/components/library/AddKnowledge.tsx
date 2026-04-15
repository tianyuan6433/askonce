"use client";

interface AddKnowledgeProps {
  onUploadClick: () => void;
  onPasteClick: () => void;
}

export function AddKnowledge({ onUploadClick, onPasteClick }: AddKnowledgeProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-on-surface">Add Knowledge</h2>
          <p className="text-on-surface-variant mt-1">Capture insights effortlessly into your digital sanctuary.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Upload Screenshot */}
        <div
          onClick={onUploadClick}
          className="group relative overflow-hidden bg-surface-container-lowest p-8 rounded-xl shadow-card border border-white/50 hover:shadow-xl transition-all duration-300 cursor-pointer"
        >
          <div className="flex items-start justify-between">
            <div className="p-4 bg-primary/10 rounded-2xl text-primary">
              <span className="material-symbols-outlined text-4xl">add_a_photo</span>
            </div>
            <span className="material-symbols-outlined text-on-surface-variant/20 group-hover:text-primary transition-colors">
              north_east
            </span>
          </div>
          <div className="mt-12">
            <h3 className="text-2xl font-bold text-on-surface">Upload Screenshot</h3>
            <p className="text-on-surface-variant mt-2 leading-relaxed">
              Turn your captures into searchable, structured data using our AI vision engine.
            </p>
          </div>
          <div className="mt-6 flex gap-2">
            <span className="px-3 py-1 bg-surface-container rounded-full text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              OCR Enabled
            </span>
            <span className="px-3 py-1 bg-surface-container rounded-full text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
              PNG, JPG, HEIC
            </span>
          </div>
          {/* Decorative Gradient */}
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors" />
        </div>

        {/* Card 2: Paste Text */}
        <div
          onClick={onPasteClick}
          className="group relative overflow-hidden bg-gradient-to-br from-primary to-primary-dim p-8 rounded-xl shadow-elevated hover:shadow-2xl transition-all duration-300 cursor-pointer text-on-primary"
        >
          <div className="flex items-start justify-between">
            <div className="p-4 bg-white/20 rounded-2xl">
              <span className="material-symbols-outlined text-4xl">content_paste</span>
            </div>
            <span className="material-symbols-outlined text-on-primary/40 group-hover:text-on-primary transition-colors">
              north_east
            </span>
          </div>
          <div className="mt-12">
            <h3 className="text-2xl font-bold">Paste Text</h3>
            <p className="text-on-primary/80 mt-2 leading-relaxed">
              Instantly index articles, meeting notes, or research papers from your clipboard.
            </p>
          </div>
          <div className="mt-6 flex gap-2">
            <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-wider">
              Auto-Summary
            </span>
            <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-wider">
              Markdown Support
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
