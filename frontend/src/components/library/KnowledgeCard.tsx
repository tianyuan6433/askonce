interface KnowledgeCardProps {
  id: string;
  title: string;
  description: string;
  tag: string;
  tagColor: "primary" | "secondary" | "tertiary" | "default";
  timeAgo: string;
  status: "cited" | "draft" | "review";
  featured?: boolean;
  imageUrl?: string;
  onClick?: () => void;
}

const tagColorMap = {
  primary: "text-primary bg-primary/5",
  secondary: "text-secondary bg-secondary/5",
  tertiary: "text-tertiary bg-tertiary/5",
  default: "text-on-surface-variant bg-surface-container",
};

export function KnowledgeCard({
  title,
  description,
  tag,
  tagColor = "default",
  timeAgo,
  status,
  featured = false,
  imageUrl,
  onClick,
}: KnowledgeCardProps) {
  if (featured && imageUrl) {
    return (
      <div
        onClick={onClick}
        className="relative group col-span-1 md:col-span-2 bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm flex flex-col md:flex-row cursor-pointer hover:shadow-lg transition-all"
      >
        <div className="w-full md:w-1/2 h-48 md:h-full bg-surface-container-low flex items-center justify-center">
          <span className="material-symbols-outlined text-on-surface-variant/20 text-6xl">image</span>
        </div>
        <div className="p-8 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <span className={`text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full ${tagColorMap[tagColor]}`}>
              {tag}
            </span>
            <span className="text-xs text-on-surface-variant">4 min read</span>
          </div>
          <h4 className="text-2xl font-bold text-on-surface leading-tight mb-3">{title}</h4>
          <p className="text-sm text-on-surface-variant line-clamp-4 leading-relaxed mb-6">{description}</p>
          <div className="mt-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex -space-x-2">
                <div className="w-6 h-6 rounded-full bg-primary-fixed border-2 border-white" />
                <div className="w-6 h-6 rounded-full bg-secondary-fixed border-2 border-white" />
              </div>
              <span className="text-xs text-on-surface-variant">Shared with 2 others</span>
            </div>
            <button className="bg-primary hover:bg-primary-dim text-on-primary px-4 py-2 rounded-full text-xs font-bold transition-all">
              Read Insight
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="bg-surface-container-lowest p-6 rounded-xl border border-transparent hover:border-primary/10 hover:shadow-lg transition-all group flex flex-col h-full cursor-pointer"
    >
      <div className="flex items-center justify-between mb-4">
        <span className={`text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full ${tagColorMap[tagColor]}`}>
          {tag}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); }}
          className="text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <span className="material-symbols-outlined text-xl">more_vert</span>
        </button>
      </div>

      <h4 className="text-lg font-bold text-on-surface leading-tight mb-2">{title}</h4>
      <p className="text-sm text-on-surface-variant line-clamp-3 mb-6 leading-relaxed">{description}</p>

      <div className="mt-auto flex items-center justify-between pt-4 border-t border-surface-container-low">
        <div className="flex items-center gap-2 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-sm">schedule</span>
          {timeAgo}
        </div>
        {status === "cited" ? (
          <div className="flex items-center gap-1.5 text-xs text-secondary font-semibold">
            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
            Cited
          </div>
        ) : status === "review" ? (
          <div className="flex items-center gap-1.5 text-xs text-tertiary font-semibold">
            <span className="material-symbols-outlined text-sm">pending</span>
            Review
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant/40 italic">
            Draft
          </div>
        )}
      </div>
    </div>
  );
}
