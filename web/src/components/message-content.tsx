import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <strong key={key++} className="font-semibold text-zinc-100">
        {match[1]}
      </strong>
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length > 0 ? parts : [text];
}

function renderBlock(block: string, index: number) {
  const trimmed = block.trim();
  if (!trimmed) return null;

  const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const text = headingMatch[2];
    const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
    return (
      <Tag
        key={index}
        className={cn(
          "font-semibold text-zinc-100",
          level === 1 && "mt-4 mb-2 text-base first:mt-0",
          level === 2 && "mt-3 mb-1.5 text-sm",
          level === 3 && "mt-2 mb-1 text-sm"
        )}
      >
        {renderInline(text)}
      </Tag>
    );
  }

  const lines = trimmed.split("\n");
  const isBulletList = lines.every((l) => /^[-*•]\s+/.test(l.trim()) || !l.trim());
  if (isBulletList && lines.some((l) => /^[-*•]\s+/.test(l.trim()))) {
    return (
      <ul key={index} className="my-2 list-none space-y-1.5 pl-0">
        {lines
          .filter((l) => /^[-*•]\s+/.test(l.trim()))
          .map((line, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/80" />
              <span>{renderInline(line.replace(/^[-*•]\s+/, ""))}</span>
            </li>
          ))}
      </ul>
    );
  }

  const isNumberedList = lines.every((l) => /^\d+\.\s+/.test(l.trim()) || !l.trim());
  if (isNumberedList && lines.some((l) => /^\d+\.\s+/.test(l.trim()))) {
    return (
      <ol key={index} className="my-2 list-none space-y-1.5 pl-0">
        {lines
          .filter((l) => /^\d+\.\s+/.test(l.trim()))
          .map((line, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
              <span className="shrink-0 font-medium text-emerald-400/90">{i + 1}.</span>
              <span>{renderInline(line.replace(/^\d+\.\s+/, ""))}</span>
            </li>
          ))}
      </ol>
    );
  }

  return (
    <p key={index} className="text-sm leading-relaxed text-zinc-200 [&+p]:mt-3">
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {renderInline(line)}
        </span>
      ))}
    </p>
  );
}

interface MessageContentProps {
  content: string;
  className?: string;
}

export function MessageContent({ content, className }: MessageContentProps) {
  const blocks = content.split(/\n{2,}/);

  return (
    <div className={cn("space-y-1", className)}>
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}
