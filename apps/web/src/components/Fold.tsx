import type { ReactNode } from 'react';

/** 긴 목록 접기/펼치기 (처음엔 펼침). 제목 줄을 누르면 접힌다 */
export function Fold({ title, children, defaultOpen = true }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl px-2 font-semibold hover:bg-bg [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        {title}
        <span className="ml-1 text-sm font-normal text-muted group-open:hidden">(펼치기)</span>
        <span className="ml-1 hidden text-sm font-normal text-muted group-open:inline">(접기)</span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
