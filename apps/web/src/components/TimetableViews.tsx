import { SEAT_ROLE_LABEL, examTimes, groupByDate } from '@sim/shared';
import { dateLabel } from '@/components/AvailabilityGrid';
import { ownTimeOf, shownPeriods, timeText, type Duty, type TimetableData } from '@/lib/timetable';

/**
 * 최종(전체) 시간표. 컴퓨터: 날짜별 표(행 = 시험실, 열 = 교시) / 휴대폰: 교시별 카드.
 * highlight 교사의 칸은 강조한다 (교사 화면에서 내 감독 찾기).
 */
export function FullTimetable({ data, highlight }: { data: TimetableData; highlight?: string | null }) {
  const name = new Map(data.teachers.map((t) => [t.id, t.name]));
  const rooms = [...data.rooms].sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99) || (a.classNo ?? 99) - (b.classNo ?? 99) || a.name.localeCompare(b.name, 'ko'));
  const slotByKey = new Map(data.slots.map((s) => [`${s.date}|${s.period}|${s.grade}`, s]));

  return (
    <div className="grid gap-6">
      {groupByDate(examTimes(data.slots)).map(([date, times]) => {
        const dayAssign = data.assignments.filter((a) => a.date === date);
        const used = rooms.filter((r) => dayAssign.some((a) => a.roomId === r.id));
        // 별도 시간(연장)으로 다음 교시까지 걸치는 감독은 그 교시 칸에도 보인다
        const cell = (period: number, roomId: string) => dayAssign.filter((a) => a.roomId === roomId && shownPeriods(data.slots, a).includes(period));
        const label = (teacherId: string, role: string) => `${name.get(teacherId) ?? '?'}${role === 'CHIEF' ? '' : `(${SEAT_ROLE_LABEL[role as keyof typeof SEAT_ROLE_LABEL]})`}`;
        return (
          <section key={date} className="print-break-inside-avoid">
            <h3 className="mb-2 text-lg font-bold">{dateLabel(date)}</h3>

            {/* 컴퓨터·인쇄: 표 */}
            <div className="hidden overflow-x-auto md:block print:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b-2 border-line text-sm text-muted">
                    <th className="px-3 py-2">시험실</th>
                    {times.map((t) => (
                      <th key={t.period} className="px-3 py-2 whitespace-nowrap">
                        {t.period}교시 {t.startTime && <span className="font-normal">({timeText(t)})</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {used.map((r) => (
                    <tr key={r.id} className="border-b border-line">
                      <td className="px-3 py-2 font-bold whitespace-nowrap">{r.name}</td>
                      {times.map((t) => (
                        <td key={t.period} className="px-3 py-2">
                          {cell(t.period, r.id).map((a) => (
                            <div key={a.id} className={`font-semibold ${a.teacherId === highlight ? 'rounded-md bg-primary px-1.5 text-white' : ''}`}>
                              {label(a.teacherId, a.role)}
                              {ownTimeOf(data.slots, a.slotId, a.roomId) && <span className="ml-1 text-xs font-normal">({ownTimeOf(data.slots, a.slotId, a.roomId)})</span>}
                              {a.period !== t.period && <span className="ml-1 text-xs font-normal text-muted">이어서</span>}
                            </div>
                          ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 휴대폰: 교시별 카드 */}
            <div className="grid gap-3 md:hidden print:hidden">
              {times.map((t) => (
                <div key={t.period} className="rounded-xl border border-line bg-surface p-3">
                  <div className="mb-2 font-bold">
                    {t.period}교시 <span className="text-sm font-normal text-muted">{timeText(t)}</span>
                  </div>
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    {used
                      .filter((r) => cell(t.period, r.id).length)
                      .map((r) => (
                        <li key={r.id} className="flex justify-between gap-2 border-b border-line py-1">
                          <span className="text-muted">{r.name}</span>
                          <span className="text-right font-semibold">
                            {cell(t.period, r.id).map((a) => (
                              <span key={a.id} className={`block ${a.teacherId === highlight ? 'rounded bg-primary px-1 text-white' : ''}`}>
                                {label(a.teacherId, a.role)}
                                {ownTimeOf(data.slots, a.slotId, a.roomId) && <span className="ml-1 text-xs font-normal">({ownTimeOf(data.slots, a.slotId, a.roomId)})</span>}
                                {a.period !== t.period && <span className="ml-1 text-xs font-normal opacity-70">이어서</span>}
                              </span>
                            ))}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
            {/* 과목 정보: 같은 교시에 학년마다 과목이 다르므로 아래에 요약 */}
            <p className="mt-2 text-sm text-muted">
              {times
                .map((t) =>
                  [1, 2, 3, 4, 5, 6]
                    .map((g) => slotByKey.get(`${date}|${t.period}|${g}`))
                    .filter(Boolean)
                    .map((s) => `${t.period}교시 ${s!.grade}학년 ${s!.subject}`)
                    .join(' · '),
                )
                .join(' / ')}
            </p>
          </section>
        );
      })}
    </div>
  );
}

/** 개인 시간표: 날짜별 카드 (컴퓨터·휴대폰 공통, 화면 폭에 따라 칸 수 자동 조정) */
export function PersonalTimetable({ duties }: { duties: Duty[] }) {
  if (duties.length === 0) return <p className="text-muted">배정된 감독이 없습니다.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-2">
      {groupByDate(duties).map(([date, list]) => (
        <section key={date} className="print-break-inside-avoid rounded-card border border-line bg-surface p-4">
          <h3 className="mb-2 text-lg font-bold">{dateLabel(date)}</h3>
          <ul className="grid gap-2">
            {list.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-xl bg-bg px-3 py-2">
                <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-primary text-white">
                  <span className="text-lg leading-none font-bold">{d.period}</span>
                  <span className="text-[0.65rem]">교시</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-bold">
                    {d.roomName} <span className="text-base font-semibold text-primary-strong">{d.role}</span>
                  </span>
                  <span className="block text-sm text-muted">
                    {timeText(d) || '시간 미정'} · {d.grade}학년 {d.subject}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
