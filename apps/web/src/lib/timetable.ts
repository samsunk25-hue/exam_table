// 최종 시간표·개인 시간표: 화면 표시용 정리, 엑셀·캘린더(.ics) 내보내기
import {
  SEAT_ROLE_LABEL,
  examTimes,
  type AssignmentDoc,
  type RoomDoc,
  type SlotDoc,
  type TeacherDoc,
  type WithId,
} from '@sim/shared';
import { dateLabel } from '@/components/AvailabilityGrid';
import { toast } from '@/components/Toast';
import { downloadWorkbook, type OutCell, type OutSheet } from './xlsx';

export interface TimetableData {
  slots: WithId<SlotDoc>[];
  rooms: WithId<RoomDoc>[];
  teachers: WithId<TeacherDoc>[];
  assignments: WithId<AssignmentDoc>[];
}

/** 개인 시간표 한 줄 */
export interface Duty {
  id: string;
  date: string;
  period: number;
  startTime: string | null;
  endTime: string | null;
  roomName: string;
  role: string;
  grade: number;
  subject: string;
}

export function dutiesOf(teacherId: string, d: TimetableData): Duty[] {
  const slotById = new Map(d.slots.map((s) => [s.id, s]));
  const roomById = new Map(d.rooms.map((r) => [r.id, r]));
  return d.assignments
    .filter((a) => a.teacherId === teacherId)
    .map((a) => {
      const s = slotById.get(a.slotId);
      return {
        id: a.id,
        date: a.date,
        period: a.period,
        startTime: s?.startTime ?? null,
        endTime: s?.endTime ?? null,
        roomName: roomById.get(a.roomId)?.name ?? '',
        role: SEAT_ROLE_LABEL[a.role],
        grade: s?.grade ?? 0,
        subject: s?.subject ?? '',
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
}

export const timeText = (d: Pick<Duty, 'startTime' | 'endTime'>) => (d.startTime ? `${d.startTime}~${d.endTime ?? ''}` : '');

/** 날짜별 표: 행 = 시험실, 열 = 교시, 칸 = "이름(역할)" */
export function fullTimetableSheets(d: TimetableData): OutSheet[] {
  const name = new Map(d.teachers.map((t) => [t.id, t.name]));
  const roomOrder = [...d.rooms].sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99) || (a.classNo ?? 99) - (b.classNo ?? 99) || a.name.localeCompare(b.name, 'ko'));
  const times = examTimes(d.slots);
  const dates = [...new Set(times.map((t) => t.date))];
  const sheets: OutSheet[] = dates.map((date) => {
    const periods = times.filter((t) => t.date === date);
    const used = new Set(d.assignments.filter((a) => a.date === date).map((a) => a.roomId));
    const header: OutCell[] = ['시험실', ...periods.map((p) => `${p.period}교시${p.startTime ? ` (${p.startTime}~${p.endTime ?? ''})` : ''}`)];
    const rows: OutCell[][] = roomOrder
      .filter((r) => used.has(r.id))
      .map((r) => [
        r.name,
        ...periods.map((p) =>
          d.assignments
            .filter((a) => a.date === date && a.period === p.period && a.roomId === r.id)
            .map((a) => `${name.get(a.teacherId) ?? '?'}${a.role === 'CHIEF' ? '' : `(${SEAT_ROLE_LABEL[a.role]})`}`)
            .join(', '),
        ),
      ]);
    return { name: dateLabel(date).replace(/[[\]:*?/\\]/g, ''), rows: [header, ...rows], widths: [14, ...periods.map(() => 22)] };
  });

  // 교사별 목록 시트
  const people: OutCell[][] = [['교사', '날짜', '교시', '시간', '시험실', '역할', '시험']];
  for (const t of [...d.teachers].sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
    for (const duty of dutiesOf(t.id, d)) {
      people.push([t.name, dateLabel(duty.date), `${duty.period}교시`, timeText(duty), duty.roomName, duty.role, `${duty.grade}학년 ${duty.subject}`]);
    }
  }
  sheets.push({ name: '교사별', rows: people });
  return sheets;
}

export function personalSheet(teacherName: string, duties: Duty[]): OutSheet {
  return {
    name: teacherName.slice(0, 31),
    rows: [
      ['날짜', '교시', '시간', '시험실', '역할', '시험'],
      ...duties.map((x) => [dateLabel(x.date), `${x.period}교시`, timeText(x), x.roomName, x.role, `${x.grade}학년 ${x.subject}`]),
    ],
    widths: [18, 8, 14, 14, 10, 16],
  };
}

export function downloadFullTimetable(title: string, d: TimetableData) {
  return downloadWorkbook(`${title}_감독시간표.xlsx`, fullTimetableSheets(d));
}

export function downloadPersonalTimetable(title: string, teacherName: string, duties: Duty[]) {
  return downloadWorkbook(`${title}_${teacherName}_감독시간표.xlsx`, [personalSheet(teacherName, duties)]);
}

/** 휴대폰 캘린더에 넣을 수 있는 .ics 파일 (시간이 없는 교시는 하루 일정으로) */
export function downloadCalendar(title: string, teacherName: string, duties: Duty[]): boolean {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ssaembalance//exam-invigilation//KO', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(`${title} 감독`)}`];
  for (const x of duties) {
    const day = x.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${x.id}@ssaembalance`, `DTSTAMP:${stamp}`);
    if (x.startTime && x.endTime) {
      lines.push(`DTSTART;TZID=Asia/Seoul:${day}T${x.startTime.replace(':', '')}00`, `DTEND;TZID=Asia/Seoul:${day}T${x.endTime.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day}`);
    }
    lines.push(
      `SUMMARY:${esc(`[감독] ${x.period}교시 ${x.roomName} ${x.role}`)}`,
      `DESCRIPTION:${esc(`${x.grade}학년 ${x.subject} · ${teacherName}`)}`,
      `LOCATION:${esc(x.roomName)}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`${x.period}교시 ${x.roomName} 감독`)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  try {
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}_${teacherName}_감독일정.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('캘린더 파일을 저장했습니다. 파일을 열면 휴대폰·PC 캘린더에 감독 일정이 추가됩니다 (10분 전 알림).');
    return true;
  } catch (e) {
    toast(`파일을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'alert');
    return false;
  }
}
