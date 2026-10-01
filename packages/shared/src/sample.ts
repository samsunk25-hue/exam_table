// 통합 양식 샘플: 교사 25명 중학교, 3일 × 하루 3교시(1·2교시 시험, 3교시 자습), 45분 시험 + 15분 휴식
import { slotIdOf, type BaseTimetableDoc, type Placement, type RoomDoc, type SlotDoc, type TeacherDoc, type TimetableEntry, type WithId } from './model';

export interface SampleSchool {
  teachers: WithId<TeacherDoc>[];
  rooms: WithId<RoomDoc>[];
  slots: WithId<SlotDoc>[];
  timetable: WithId<BaseTimetableDoc>[];
  periodTimes: Record<string, { start: string; end: string }>;
}

const GRADES = 3;
const CLASSES = 4;

// 이름 · 과목 (가상 인물)
const STAFF: [string, string][] = [
  ['김민준', '국어'], ['이서연', '국어'], ['박지호', '국어'],
  ['최수아', '수학'], ['정예준', '수학'], ['강하은', '수학'],
  ['조도윤', '영어'], ['윤지우', '영어'], ['장시우', '영어'],
  ['임서윤', '과학'], ['한주원', '과학'], ['오하린', '과학'],
  ['서건우', '사회'], ['신지민', '사회'],
  ['권예린', '역사'], ['황준서', '역사'],
  ['안유나', '도덕'],
  ['송현우', '기술가정'], ['전소윤', '기술가정'],
  ['홍태윤', '체육'], ['유채원', '체육'],
  ['고은호', '음악'],
  ['문다인', '미술'],
  ['양승민', '정보'],
  ['배나연', '진로'],
];

/** 학급 주당 수업 시수 (합 28시간, 주 30칸 중) */
const WEEKLY: [string, number][] = [
  ['국어', 4], ['수학', 4], ['영어', 4], ['과학', 3], ['사회', 2], ['역사', 2], ['도덕', 1],
  ['기술가정', 2], ['체육', 2], ['음악', 1], ['미술', 1], ['정보', 1], ['진로', 1],
];

/** [학년][일차] = [1교시 과목, 2교시 과목] (3교시는 자습) */
const EXAMS: string[][][] = [
  [['국어', '수학'], ['영어', '과학'], ['사회', '기술가정']],
  [['수학', '영어'], ['국어', '역사'], ['과학', '도덕']],
  [['영어', '국어'], ['수학', '사회'], ['역사', '과학']],
];

export const SAMPLE_PERIOD_TIMES = {
  '1': { start: '09:00', end: '09:45' },
  '2': { start: '10:00', end: '10:45' },
  '3': { start: '11:00', end: '11:45' },
};

/** startDate부터 주말을 건너뛴 평일 n일 */
export function nextWeekdays(startDate: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${startDate}T00:00:00Z`);
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function buildSampleSchool(startDate = '2026-10-19'): SampleSchool {
  const teachers: WithId<TeacherDoc>[] = STAFF.map(([name, subject], i) => {
    const n = i + 1;
    // 앞쪽 교과 교사 12명이 담임 (1-1 … 3-4), 정보·진로 교사는 복도전담
    const homeroomIdx = i < 12 ? i : -1;
    return {
      id: `S${String(n).padStart(2, '0')}`,
      name,
      email: `t${String(n).padStart(2, '0')}@sample.school.kr`,
      subject,
      homeroom: homeroomIdx >= 0 ? { grade: (homeroomIdx % GRADES) + 1, classNo: Math.floor(homeroomIdx / GRADES) + 1 } : null,
      defaultRole: subject === '정보' || subject === '진로' ? 'HALLWAY' : 'NORMAL',
      active: true,
      cumulativeLoad: 0,
    };
  });

  const rooms: WithId<RoomDoc>[] = [];
  for (let g = 1; g <= GRADES; g++) {
    for (let c = 1; c <= CLASSES; c++) {
      rooms.push({ id: `SR${g}${c}`, name: `${g}-${c}`, spaceType: 'CLASSROOM', grade: g, classNo: c, chiefCount: 1, assistantCount: 0 });
    }
    rooms.push({ id: `SH${g}`, name: `${g}학년 복도`, spaceType: 'HALLWAY', grade: g, classNo: null, chiefCount: 1, assistantCount: 0 });
  }
  rooms.push({ id: 'SSEP', name: '별도시험장', spaceType: 'SEPARATE', grade: null, classNo: null, chiefCount: 1, assistantCount: 1 });

  const classrooms = (g: number): Placement[] =>
    rooms.filter((r) => r.grade === g && r.spaceType === 'CLASSROOM').map((r) => ({ roomId: r.id, classNo: r.classNo, headcount: 25, roomType: 'NORMAL' as const }));
  const hallway = (g: number): Placement => ({ roomId: `SH${g}`, classNo: null, headcount: null, roomType: 'NORMAL' });

  const slots: WithId<SlotDoc>[] = [];
  nextWeekdays(startDate, 3).forEach((date, day) => {
    for (let g = 1; g <= GRADES; g++) {
      for (const period of [1, 2, 3]) {
        const t = SAMPLE_PERIOD_TIMES[String(period) as '1' | '2' | '3'];
        const study = period === 3;
        const placements = study ? classrooms(g) : [...classrooms(g), hallway(g)];
        // 1학년 1교시 시험은 별도시험장(시간 연장) 함께 운영
        if (!study && g === 1 && period === 1) placements.push({ roomId: 'SSEP', classNo: null, headcount: 2, roomType: 'EXTENDED', startTime: '09:00', endTime: '10:10' }); // 연장 시간이 2교시와 겹치는 예시
        slots.push({
          id: slotIdOf(date, period, g),
          date,
          period,
          startTime: t.start,
          endTime: t.end,
          grade: g,
          subject: study ? '자습' : EXAMS[g - 1]![day]![period - 1]!,
          type: study ? 'STUDY' : 'EXAM',
          rooms: placements,
        });
      }
    }
  });

  return { teachers, rooms, slots, timetable: buildTimetable(teachers), periodTimes: SAMPLE_PERIOD_TIMES };
}

/** 학급 × 요일 × 1~6교시에 교사 겹침 없이 수업을 채운 기초시간표 */
function buildTimetable(teachers: WithId<TeacherDoc>[]): WithId<BaseTimetableDoc>[] {
  const bySubject = new Map<string, string[]>();
  for (const t of teachers) bySubject.set(t.subject!, [...(bySubject.get(t.subject!) ?? []), t.id]);

  const entries = new Map<string, TimetableEntry[]>(teachers.map((t) => [t.id, []]));
  const busy = new Set<string>(); // teacherId|weekday|period
  let classIdx = 0;
  for (let g = 1; g <= GRADES; g++) {
    for (let c = 1; c <= CLASSES; c++, classIdx++) {
      // 과목마다 이 학급을 맡을 교사를 돌아가며 정한다
      const lessons = WEEKLY.flatMap(([subject, hours]) => {
        const list = bySubject.get(subject)!;
        const teacherId = list[classIdx % list.length]!;
        return Array.from({ length: hours }, () => ({ subject, teacherId }));
      });
      // 학급마다 시작 위치를 바꿔 요일·교시가 고르게 섞이게 한다
      const cells = Array.from({ length: 30 }, (_, i) => ({ weekday: (i % 5) + 1, period: Math.floor(i / 5) + 1 }));
      const order = cells.map((_, i) => cells[(i * 7 + classIdx * 3) % 30]!);
      for (const cell of order) {
        const k = lessons.findIndex((l) => !busy.has(`${l.teacherId}|${cell.weekday}|${cell.period}`));
        if (k < 0) continue;
        const [lesson] = lessons.splice(k, 1);
        busy.add(`${lesson!.teacherId}|${cell.weekday}|${cell.period}`);
        entries.get(lesson!.teacherId)!.push({ ...cell, grade: g, classNo: c, subject: lesson!.subject });
      }
    }
  }
  return teachers.map((t) => ({
    id: t.id,
    teacherId: t.id,
    entries: entries.get(t.id)!.sort((a, b) => a.weekday - b.weekday || a.period - b.period),
  }));
}
