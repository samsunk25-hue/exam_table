// AI 기능 (Claude API): 학교 문서에서 시험 일정·교사 명단 읽기, 배정 이유 설명, 글로 쓴 고려사항 → 배정 규칙.
// API 키는 관리자마다 자기 것을 넣는다 → aiKeys/{uid} (보안 규칙상 함수만 읽고 쓴다. 코드·저장소·배포 파일에 없음).
// AI 기능은 모두 관리자만 쓴다. 에뮬레이터에서 키가 없으면 가짜 응답으로 흐름만 점검한다.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { DEFAULT_ROLE_WEIGHTS, buildEngineInput, buildSeats, type Seat } from '@sim/engine';
import { SEAT_ROLE_LABEL, makePseudonyms, type SessionStatus } from '@sim/shared';
import { db, requireAdmin, serverTimestamp } from './common';
import { loadData } from './runs';

const MODEL = 'claude-opus-5-5';
const AI_OPTIONS = { timeoutSeconds: 300, memory: '512MiB' as const };
const API = 'https://api.anthropic.com/v1';
const headers = (key: string) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });
const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true';

/** 관리자 본인의 키 (없으면 null) */
async function keyOf(uid: string | undefined | null): Promise<string | null> {
  if (!uid) return null;
  const snap = await db().doc(`aiKeys/${uid}`).get();
  return (snap.get('key') as string | undefined) ?? null;
}

/** 관리자: 내 AI 키 등록·바꾸기. 키를 실제로 확인한 뒤 비공개 저장소에 둔다 (화면에는 끝 4자리만). */
export const setMyAiKey = onCall({ timeoutSeconds: 30 }, async (req) => {
  const uid = requireAdmin(req);
  const { key } = (req.data ?? {}) as { key?: unknown };
  const k = typeof key === 'string' ? key.trim() : '';
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw new HttpsError('invalid-argument', 'Claude API 키 형식이 아닙니다 (sk-ant-로 시작).');
  // 에뮬레이터 점검용 가짜 키(sk-ant-test-…)는 확인을 건너뛴다
  if (!(isEmulator() && k.startsWith('sk-ant-test-'))) {
    const res = await fetch(`${API}/models?limit=1`, { headers: headers(k) });
    if (res.status === 401 || res.status === 403) throw new HttpsError('permission-denied', '키가 맞지 않습니다. Anthropic 콘솔에서 키를 다시 확인해 주세요.');
    if (!res.ok) throw new HttpsError('unavailable', `키를 확인하지 못했습니다 (${res.status}). 잠시 뒤 다시 시도해 주세요.`);
  }
  await db().doc(`aiKeys/${uid}`).set({ key: k, email: (req.auth?.token.email as string | undefined) ?? null, updatedAt: serverTimestamp() });
  await db().doc(`users/${uid}`).set({ ai: { last4: k.slice(-4), updatedAt: serverTimestamp() } }, { merge: true });
  return { last4: k.slice(-4) };
});

/** 관리자: 내 AI 키 삭제 */
export const clearMyAiKey = onCall(async (req) => {
  const uid = requireAdmin(req);
  await db().doc(`aiKeys/${uid}`).delete();
  await db().doc(`users/${uid}`).set({ ai: null }, { merge: true });
  return { cleared: true };
});

type Block = Record<string, unknown>;
interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** 키가 없을 때: 에뮬레이터면 가짜 응답(null), 아니면 안내 오류 */
function needKey(key: string | null): string | null {
  // 에뮬레이터 점검용 가짜 키는 실제로 부르지 않는다
  if (key && isEmulator() && key.startsWith('sk-ant-test-')) return null;
  if (key) return key;
  if (isEmulator()) return null;
  throw new HttpsError(
    'failed-precondition',
    '내 AI 키가 없습니다. 관리자 관리 > 내 AI 키에서 Claude API 키를 등록하세요.',
  );
}

/**
 * Claude 호출. tool을 주면 그 도구 입력(JSON)을, 아니면 글을 돌려준다.
 * Opus 5.5는 도구 강제 지정(tool_choice tool/any)을 받지 않으므로 auto + 지시문으로 도구를 쓰게 한다.
 * 생각(thinking)도 max_tokens 안에서 쓰므로 넉넉히 준다 (답 길이는 지시문으로 정한다).
 */
async function claude(key: string, o: { system: string; content: Block[]; tool?: Tool }): Promise<unknown> {
  const res = await fetch(`${API}/messages`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: o.tool ? `${o.system}
반드시 ${o.tool.name} 도구를 한 번 호출해서 답하고, 글로만 답하지 마세요.` : o.system,
      messages: [{ role: 'user', content: o.content }],
      ...(o.tool ? { tools: [o.tool], tool_choice: { type: 'auto' } } : {}),
    }),
  });
  if (res.status === 401 || res.status === 403) throw new HttpsError('permission-denied', 'AI 키가 맞지 않거나 만료되었습니다. 관리자 관리 > 내 AI 키를 확인하세요.');
  if (res.status === 402 || res.status === 429) throw new HttpsError('resource-exhausted', 'AI 사용 한도나 잔액이 부족합니다. Anthropic 콘솔의 결제(Billing)를 확인하세요.');
  if (!res.ok) {
    const body = await res.text();
    throw new HttpsError('unavailable', `AI 응답 오류 (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { stop_reason?: string; content: { type: string; text?: string; input?: unknown }[] };
  if (json.stop_reason === 'refusal') throw new HttpsError('failed-precondition', 'AI가 이 요청에 답하지 않았습니다. 내용을 바꿔 다시 시도해 주세요.');
  if (json.stop_reason === 'max_tokens') throw new HttpsError('resource-exhausted', '내용이 너무 길어 AI가 끝까지 답하지 못했습니다. 문서를 나눠서 다시 시도해 주세요.');
  if (o.tool) {
    const used = json.content.find((c) => c.type === 'tool_use');
    if (!used) throw new HttpsError('internal', 'AI가 결과를 정해진 형식으로 주지 않았습니다. 다시 시도해 주세요.');
    return used.input;
  }
  return json.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
}

// ───────────────────────── 3. 학교 문서에서 자료 읽기 ─────────────────────────

const EXTRACT_TOOL: Tool = {
  name: 'record_school_data',
  description: '문서에서 읽은 시험 일정·교사 명단·기초시간표를 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      slots: {
        type: 'array',
        description: '시험 1건 = 날짜·교시·학년 하나. 같은 교시에 학년이 여러 개면 학년마다 한 줄.',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            period: { type: 'integer' },
            startTime: { type: ['string', 'null'], description: 'HH:MM (없으면 null)' },
            endTime: { type: ['string', 'null'], description: 'HH:MM (없으면 null)' },
            grade: { type: 'integer' },
            subject: { type: 'string' },
            type: { type: 'string', enum: ['시험', '자습'] },
          },
          required: ['date', 'period', 'grade', 'subject', 'type'],
        },
      },
      teachers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            subject: { type: ['string', 'null'] },
            homeroomGrade: { type: ['integer', 'null'] },
            homeroomClass: { type: ['integer', 'null'] },
            email: { type: ['string', 'null'] },
          },
          required: ['name'],
        },
      },
      timetable: {
        type: 'array',
        description: '기초시간표 (평소 주간 수업). 교사 1명 = 한 줄.',
        items: {
          type: 'object',
          properties: {
            teacher: { type: 'string', description: '교사 이름' },
            lessons: { type: 'array', items: { type: 'string' }, description: '수업 하나 = "요일교시 학년-반 과목" 예: "월1 1-3 국어", "목5 2-1" (과목 생략 가능, 월~금만)' },
          },
          required: ['teacher', 'lessons'],
        },
      },
      notes: { type: 'array', items: { type: 'string' }, description: '읽기 어려웠던 부분, 확인이 필요한 점 (한국어, 짧게)' },
    },
    required: ['slots', 'teachers', 'timetable', 'notes'],
  },
};

type Part = 'schedule' | 'teachers' | 'timetable';
const PART_TASK: Record<Part, string> = {
  schedule: '시험 일정',
  teachers: '교사 명단',
  timetable: '기초시간표',
};

interface ExtractResult {
  slots: { date: string; period: number; startTime?: string | null; endTime?: string | null; grade: number; subject: string; type: '시험' | '자습' }[];
  teachers: { name: string; subject?: string | null; homeroomGrade?: number | null; homeroomClass?: number | null; email?: string | null }[];
  timetable: { teacher: string; lessons: string[] }[];
  notes: string[];
}

const MEDIA = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/csv']);

/** 교육계획서·시험 시간표·업무 분장표·시간표 등(PDF·사진·글)에서 시험 일정·교사 명단·기초시간표를 읽는다 */
export const aiExtract = onCall(AI_OPTIONS, async (req) => {
  const key = needKey(await keyOf(requireAdmin(req)));
  const { kind, parts, files, text, year } = (req.data ?? {}) as {
    kind?: unknown;
    parts?: unknown;
    files?: { name?: unknown; mediaType?: unknown; data?: unknown }[];
    text?: unknown;
    year?: unknown;
  };
  // parts: 읽을 자료 목록. kind는 예전 화면용 (both / schedule / teachers)
  const want = new Set<Part>(
    Array.isArray(parts)
      ? parts.filter((p): p is Part => p === 'schedule' || p === 'teachers' || p === 'timetable')
      : kind === 'schedule' || kind === 'teachers'
        ? [kind]
        : ['schedule', 'teachers'],
  );
  if (!want.size) throw new HttpsError('invalid-argument', '읽을 자료를 하나 이상 골라 주세요.');
  const list = Array.isArray(files) ? files.slice(0, 4) : [];
  const content: Block[] = [];
  for (const f of list) {
    const mediaType = String(f.mediaType);
    const data = String(f.data ?? '');
    if (!MEDIA.has(mediaType) || !data) throw new HttpsError('invalid-argument', `읽을 수 없는 파일 형식입니다: ${String(f.name)}`);
    if (mediaType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: mediaType, data } });
    else if (mediaType.startsWith('image/')) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    else content.push({ type: 'text', text: Buffer.from(data, 'base64').toString('utf8').slice(0, 100_000) });
  }
  if (typeof text === 'string' && text.trim()) content.push({ type: 'text', text: text.slice(0, 100_000) });
  if (!content.length) throw new HttpsError('invalid-argument', '읽을 파일이나 글을 넣어 주세요.');

  const y = typeof year === 'number' ? year : new Date().getFullYear();
  const chosen = (['schedule', 'teachers', 'timetable'] as const).filter((p) => want.has(p));
  const skipped = { schedule: 'slots', teachers: 'teachers', timetable: 'timetable' } as const;
  const task = `${chosen.map((p) => PART_TASK[p]).join('·')}을(를) 읽으세요${
    chosen.length < 3 ? ` (${(['schedule', 'teachers', 'timetable'] as const).filter((p) => !want.has(p)).map((p) => skipped[p]).join('·')}는 빈 배열)` : ''
  }.`;
  content.push({
    type: 'text',
    text: `위 학교 문서에서 ${task}
- 학년도는 ${y}학년도입니다. 날짜에 연도가 없으면 3~12월은 ${y}년, 1~2월은 ${y + 1}년으로 쓰세요.
- 시험 일정: 날짜·교시·학년마다 한 줄. "자습"·"자율학습"은 type을 자습으로. 시간이 적혀 있으면 HH:MM으로.
- 교사 명단: 교사(담임·교과 교사)만. 행정직원은 빼세요. 담임은 "1-3" 같은 표기를 학년·반 숫자로.
- 기초시간표: 평소 주간 수업 시간표를 교사별로. 수업 하나를 "월1 1-3 국어"처럼 (요일 한 글자 + 교시, 학년-반, 과목). 학급별 시간표라면 각 칸의 교사 이름을 보고 교사별로 모으세요. 칸에 교사 이름이 없으면 과목만 보고 교사를 짐작하지 말고 notes에 적으세요. 창체·동아리처럼 학년-반이 없는 수업은 빼세요.
- 문서에 없는 값은 지어내지 말고 null로 두고, 애매한 점은 notes에 적으세요.`,
  });

  const out = !key
    ? fakeExtract(y)
    : ((await claude(key, {
        system: '당신은 한국 중·고등학교 교무 문서를 정확히 표로 옮기는 도우미입니다. 반드시 record_school_data 도구로만 답합니다.',
        content,
        tool: EXTRACT_TOOL,
      })) as ExtractResult);
  return {
    slots: want.has('schedule') ? (out.slots ?? []) : [],
    teachers: want.has('teachers') ? (out.teachers ?? []) : [],
    timetable: want.has('timetable') ? (out.timetable ?? []).filter((t) => t.teacher && Array.isArray(t.lessons) && t.lessons.length) : [],
    notes: out.notes ?? [],
  };
});

function fakeExtract(y: number): ExtractResult {
  return {
    slots: [
      { date: `${y}-10-12`, period: 1, startTime: '09:00', endTime: '09:45', grade: 1, subject: '국어', type: '시험' },
      { date: `${y}-10-12`, period: 1, startTime: '09:00', endTime: '09:45', grade: 2, subject: '수학', type: '시험' },
      { date: `${y}-10-12`, period: 2, startTime: '10:00', endTime: '10:45', grade: 1, subject: '자습', type: '자습' },
    ],
    teachers: [
      { name: '문서교사가', subject: '국어', homeroomGrade: 1, homeroomClass: 5, email: null },
      { name: '문서교사나', subject: '수학', homeroomGrade: null, homeroomClass: null, email: 'doc.b@test.kr' },
    ],
    timetable: [{ teacher: '문서교사가', lessons: ['월1 1-5 국어', '화2 1-5 국어', '수3 1-4'] }],
    notes: ['(에뮬레이터 가짜 응답) 실제 AI 키가 없어서 예시 자료를 돌려줍니다.'],
  };
}

// ───────────────────────── 2. 배정 설명 ─────────────────────────

const round = (n: number) => Math.round(n * 10) / 10;
const seatLabel = (s: Seat) => `${Number(s.date.slice(5, 7))}/${Number(s.date.slice(8, 10))} ${s.period}교시 ${s.roomName} ${SEAT_ROLE_LABEL[s.role]}`;

/** 관리자용: 세션·배정·감독 자리 */
async function loadSession(sessionId: string) {
  const snap = await db().doc(`sessions/${sessionId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', '시험 프로젝트를 찾을 수 없습니다.');
  const { data, current } = await loadData(sessionId, true);
  const input = buildEngineInput(data);
  const seats = new Map(buildSeats(input, DEFAULT_ROLE_WEIGHTS).map((s) => [s.id, s]));
  return { snap, status: snap.get('status') as SessionStatus, data, current, input, seats };
}

/** 교사별 이번 시험 점수·학년도 누적·연속·하루 최다 */
function loadStats(L: Awaited<ReturnType<typeof loadSession>>) {
  const confirmed = L.status === 'CONFIRMED' || L.status === 'LOCKED';
  return L.data.teachers
    .filter((t) => t.active)
    .map((t) => {
      const mine = L.current.filter((a) => a.teacherId === t.id);
      const load = round(mine.reduce((s, a) => s + a.weight, 0));
      const prior = round(confirmed ? (t.cumulativeLoad ?? 0) - load : (t.cumulativeLoad ?? 0));
      const times = new Set(mine.map((a) => `${a.date}|${a.period}`));
      const consecutive = [...times].filter((k) => times.has(`${k.split('|')[0]}|${Number(k.split('|')[1]) + 1}`)).length;
      const perDay = new Map<string, number>();
      for (const a of mine) perDay.set(a.date, (perDay.get(a.date) ?? 0) + 1);
      return { id: t.id, name: t.name, count: mine.length, load, total: round(prior + load), consecutive, maxDay: Math.max(0, ...perDay.values()) };
    });
}

/** 관리자: 교사 한 명의 "왜 이렇게 배정됐나요?" — 감독과 점수 이유를 쉬운 말로 (다른 교사 정보는 이름 없이 통계만). 교사 화면에서는 쓰지 않는다 */
export const aiExplainDuties = onCall(AI_OPTIONS, async (req) => {
  const uid = requireAdmin(req);
  const { sessionId, teacherId } = (req.data ?? {}) as { sessionId?: unknown; teacherId?: unknown };
  if (typeof sessionId !== 'string' || typeof teacherId !== 'string' || !teacherId) throw new HttpsError('invalid-argument', '시험과 교사를 확인해 주세요.');
  const L = await loadSession(sessionId);
  // 내 키가 없으면 시험을 만든 관리자의 키
  const key = needKey((await keyOf(uid)) ?? (await keyOf(L.snap.get('createdBy') as string | undefined)) ?? (await keyOf(L.snap.get('updatedBy') as string | undefined)));
  const me = L.data.teachers.find((t) => t.id === teacherId);
  if (!me) throw new HttpsError('not-found', '교사 명단에 없습니다.');
  const stats = loadStats(L);
  const mine = stats.find((s) => s.id === teacherId);
  const loads = stats.map((s) => s.total).sort((a, b) => a - b);
  const mean = round(loads.reduce((s, x) => s + x, 0) / (loads.length || 1));
  const rank = loads.filter((x) => x > (mine?.total ?? 0)).length + 1;
  const duties = L.current
    .filter((a) => a.teacherId === teacherId)
    .map((a) => `- ${L.seats.get(a.id) ? seatLabel(L.seats.get(a.id)!) : a.id}: 점수 이유 ${a.reason || '(수동 배정)'}`);
  const unavailable = L.data.availability.filter((a) => a.teacherId === teacherId && a.status !== 'REJECTED').map((a) => `${a.date} ${a.period}교시`);

  // 이름은 AI로 보내지 않는다 ("선생님"으로만 부르게 함)
  const facts = `교사: (이름 생략) (${me.subject ?? '교과 미상'}${me.homeroom ? `, ${me.homeroom.grade}-${me.homeroom.classNo} 담임` : ''})
이번 시험 감독 ${mine?.count ?? 0}회, 이번 업무 점수 ${mine?.load ?? 0}, 학년도 누적 ${mine?.total ?? 0}
학교 전체 학년도 누적: 평균 ${mean}, 최저 ${loads[0] ?? 0}, 최고 ${loads[loads.length - 1] ?? 0} (교사 ${loads.length}명 중 높은 순 ${rank}위)
연속 감독 ${mine?.consecutive ?? 0}쌍, 하루 최다 ${mine?.maxDay ?? 0}회
신청한 불가시간: ${unavailable.join(', ') || '없음'}
감독 목록과 배정 점수 이유:
${duties.join('\n') || '- 없음'}
점수 이유 읽는 법: 기초일치=그 시간 원래 수업하던 반, 부담하위=누적이 적어 우선, 부담상위=누적이 많아 감점, 비담임=그 학년 담임이 아님, 연속=이어지는 교시 감점, 복도전담·출제교사 복도=역할 맞춤.
배정 원칙: 불가시간·동시간 중복·연장 감독 직후는 절대 배정하지 않고, 나머지는 위 점수가 높은 교사를 고르며, 누적이 적은 교사를 먼저 배정해 형평을 맞춘다.`;

  const text = !key
    ? `(에뮬레이터 가짜 응답) ${me.name} 선생님은 이번 시험에서 감독 ${mine?.count ?? 0}회를 맡았습니다. 학년도 누적 ${mine?.total ?? 0}점으로 학교 평균 ${mean}점과 비교됩니다.`
    : ((await claude(key, {
        system:
          '당신은 학교 시험 감독 배정 결과를 교사에게 친절하게 설명하는 도우미입니다. 교사는 이름 없이 "선생님"이라고만 부르세요. 주어진 사실만 쓰고 지어내지 마세요. 다른 교사의 이름이나 개인 사정은 언급하지 마세요. 한국어 존댓말로, 5~8문장, 필요하면 "- "로 시작하는 짧은 목록을 쓰고 마크다운 제목·굵은 글씨는 쓰지 마세요.',
        content: [{ type: 'text', text: `${facts}\n\n이 교사가 "왜 이렇게 배정됐나요?"라고 물었습니다. 감독 횟수와 시간이 정해진 이유, 다른 교사와 비교한 형평성, 바꾸고 싶을 때 할 수 있는 일(교환 요청)을 설명해 주세요.` }],
      })) as string);
  return { text };
});

// ───────────────────────── 4. 글로 쓴 고려사항 → 배정 규칙 ─────────────────────────

type Effect = 'FORBID' | 'AVOID' | 'PREFER';
type Strength = 'WEAK' | 'NORMAL' | 'STRONG';
interface RawRule {
  teacherIds: string[];
  effect: Effect;
  strength?: Strength;
  when?: { dates?: string[]; periods?: number[]; grades?: number[]; roles?: string[]; subjects?: string[]; roomIds?: string[]; ownHomeroom?: boolean };
  label: string;
}

const ROLE_KO: Record<string, string> = { CHIEF: '정감독', ASSISTANT: '부감독', STUDY: '자습감독', EXTENDED: '연장감독', HALLWAY: '복도' };
const POINTS: Record<Strength, number> = { WEAK: 30, NORMAL: 60, STRONG: 120 };

const RULES_TOOL: Tool = {
  name: 'record_rules',
  description: '관리자가 쓴 고려사항을 감독 배정 규칙으로 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            teacherIds: { type: 'array', items: { type: 'string' }, description: '교사 id 목록. 모든 교사에게 해당하면 ["*"]' },
            effect: { type: 'string', enum: ['FORBID', 'AVOID', 'PREFER'], description: 'FORBID=절대 배정 안 함, AVOID=가능하면 피함, PREFER=가능하면 맡김' },
            strength: { type: 'string', enum: ['WEAK', 'NORMAL', 'STRONG'], description: 'AVOID·PREFER의 세기 (기본 NORMAL)' },
            when: {
              type: 'object',
              description: '해당하는 날짜·교시·자리. 적지 않은 항목은 "모두". 여러 값은 그중 하나면 해당.',
              properties: {
                dates: { type: 'array', items: { type: 'string' }, description: 'YYYY-MM-DD, 시험 일정에 있는 날짜만' },
                periods: { type: 'array', items: { type: 'integer' } },
                grades: { type: 'array', items: { type: 'integer' } },
                roles: { type: 'array', items: { type: 'string', enum: ['CHIEF', 'ASSISTANT', 'STUDY', 'EXTENDED', 'HALLWAY'] } },
                subjects: { type: 'array', items: { type: 'string' }, description: '시험 과목명 (일정에 있는 이름 그대로)' },
                roomIds: { type: 'array', items: { type: 'string' } },
                ownHomeroom: { type: 'boolean', description: '담임이 자기 반 교실 감독일 때만' },
              },
            },
            label: { type: 'string', description: '사람이 읽는 한 줄 설명 (한국어, 예: "김국어: 11/3 1교시 감독 금지")' },
          },
          required: ['teacherIds', 'effect', 'label'],
        },
      },
      notes: { type: 'array', items: { type: 'string' }, description: '규칙으로 바꾸지 못한 부분, 모호해서 확인이 필요한 점 (한국어, 짧게)' },
    },
    required: ['rules', 'notes'],
  },
};

/** 관리자: 글로 쓴 고려사항을 규칙으로 바꾼 미리보기 (저장은 화면에서 확인 후) */
export const aiRules = onCall(AI_OPTIONS, async (req) => {
  const key = needKey(await keyOf(requireAdmin(req)));
  const { sessionId, text } = (req.data ?? {}) as { sessionId?: unknown; text?: unknown };
  if (typeof sessionId !== 'string' || typeof text !== 'string' || !text.trim()) throw new HttpsError('invalid-argument', '고려사항을 적어 주세요.');
  if (text.length > 4000) throw new HttpsError('invalid-argument', '4000자 이내로 적어 주세요.');
  const L = await loadSession(sessionId);
  const teachers = L.data.teachers.filter((t) => t.active);
  const dates = [...new Set(L.data.slots.map((s) => s.date))].sort();
  const subjects = [...new Set(L.data.slots.map((s) => s.subject))];
  const roomIds = new Set(L.data.rooms.map((r) => r.id));

  // 교사 이름은 가명(교사1…)으로 보내고, 돌아온 설명에서 원래 이름으로 되돌린다
  const ps = makePseudonyms(teachers.map((t) => t.name));
  const masked: { rules: RawRule[]; notes: string[] } = !key
    ? fakeRules(text, teachers, dates)
    : ((await claude(key, {
        system:
          '당신은 학교 시험 감독 배정 규칙을 만드는 도우미입니다. 관리자가 쓴 고려사항을 record_rules 도구로만 답합니다. 주어진 교사 id·날짜·과목·시험실 id만 쓰고 지어내지 마세요. 한 문장에 여러 교사·조건이 있으면 규칙을 나누세요. "빼 달라·안 된다·불가"는 FORBID, "가급적 빼 달라·적게"는 AVOID, "맡겨 달라·우선"은 PREFER. 하루 횟수 제한처럼 날짜·교시·자리로 나타낼 수 없는 것은 규칙을 만들지 말고 notes에 적으세요.',
        content: [
          {
            type: 'text',
            text: `교사 (id: 이름, 과목, 담임):
${teachers.map((t) => `${t.id}: ${ps.mask(t.name)}, ${t.subject ?? '-'}, ${t.homeroom ? `${t.homeroom.grade}-${t.homeroom.classNo}` : '-'}`).join('\n')}
시험 일정 (날짜 교시 학년 과목):
${L.data.slots.map((s) => `${s.date} ${s.period}교시 ${s.grade}학년 ${s.subject}`).join('\n')}
시험실 (id: 이름): ${L.data.rooms.map((r) => `${r.id}: ${r.name}`).join(', ')}
감독 자리 종류: CHIEF=정감독, ASSISTANT=부감독, STUDY=자습감독, EXTENDED=연장감독, HALLWAY=복도

관리자 고려사항:
${ps.mask(text)}`,
          },
        ],
        tool: RULES_TOOL,
      })) as { rules: RawRule[]; notes: string[] });
  const raw = {
    rules: (masked.rules ?? []).map((r) => ({ ...r, label: ps.unmask(String(r.label ?? '')) })),
    notes: (masked.notes ?? []).map((n) => ps.unmask(String(n))),
  };

  // 받은 규칙을 검사하고 교사별 문서로 펼친다
  const ids = new Set(teachers.map((t) => t.id));
  const notes = [...(raw.notes ?? [])];
  const rules: Record<string, unknown>[] = [];
  for (const r of raw.rules ?? []) {
    const who = (r.teacherIds ?? []).includes('*') ? ['*'] : (r.teacherIds ?? []).filter((id) => ids.has(id));
    if (!who.length || !['FORBID', 'AVOID', 'PREFER'].includes(r.effect)) {
      notes.push(`확인 필요: "${r.label}" — 교사를 찾지 못해 뺐습니다.`);
      continue;
    }
    const w = r.when ?? {};
    const when = {
      ...(w.dates?.length ? { dates: w.dates.filter((d) => dates.includes(d)) } : {}),
      ...(w.periods?.length ? { periods: w.periods.filter((p) => Number.isInteger(p) && p >= 1 && p <= 10) } : {}),
      ...(w.grades?.length ? { grades: w.grades.filter((g) => Number.isInteger(g) && g >= 1 && g <= 6) } : {}),
      ...(w.roles?.length ? { roles: w.roles.filter((x) => x in ROLE_KO) } : {}),
      ...(w.subjects?.length ? { subjects: w.subjects.filter((x) => subjects.includes(x)) } : {}),
      ...(w.roomIds?.length ? { roomIds: w.roomIds.filter((x) => roomIds.has(x)) } : {}),
      ...(w.ownHomeroom ? { ownHomeroom: true } : {}),
    };
    // 조건 값이 모두 걸러져 빈 목록이 되면 "모든 자리"로 넓어지므로 뺀다
    if (Object.values(when).some((v) => Array.isArray(v) && v.length === 0)) {
      notes.push(`확인 필요: "${r.label}" — 일정에 없는 날짜·과목·시험실이 있어 뺐습니다.`);
      continue;
    }
    const pts = POINTS[r.strength ?? 'NORMAL'] ?? 60;
    for (const t of who) {
      rules.push({
        teacherId: t,
        type: 'RULE',
        when,
        priority: r.effect === 'FORBID' ? 'HARD' : 'SOFT',
        ...(r.effect === 'FORBID' ? {} : { penalty: r.effect === 'AVOID' ? -pts : pts }),
        label: String(r.label ?? '').slice(0, 200),
      });
    }
  }
  return { rules, notes };
});

/** 에뮬레이터 점검용: 문장에서 교사 이름·날짜(M/D)·교시를 찾아 규칙 하나 */
function fakeRules(text: string, teachers: { id: string; name: string }[], dates: string[]): { rules: RawRule[]; notes: string[] } {
  const t = teachers.find((x) => text.includes(x.name));
  if (!t) return { rules: [], notes: ['(가짜 응답) 교사 이름을 찾지 못했습니다.'] };
  const md = text.match(/(\d{1,2})\s*[/월.]\s*(\d{1,2})/);
  const date = md ? dates.find((d) => Number(d.slice(5, 7)) === Number(md[1]) && Number(d.slice(8, 10)) === Number(md[2])) : undefined;
  const p = text.match(/(\d)\s*교시/);
  const effect: Effect = /가급적|가능하면|되도록|적게/.test(text) ? 'AVOID' : /빼|안\s?되|불가|금지|제외/.test(text) ? 'FORBID' : 'PREFER';
  const when = { ...(date ? { dates: [date] } : {}), ...(p ? { periods: [Number(p[1])] } : {}) };
  const what = { FORBID: '감독 금지', AVOID: '가급적 피하기', PREFER: '우선 배정' }[effect];
  const md2 = date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ` : '';
  return {
    rules: [{ teacherIds: [t.id], effect, when, label: `${t.name}: ${md2}${p ? `${p[1]}교시 ` : ''}${what}` }],
    notes: ['(에뮬레이터 가짜 응답) 실제 AI 대신 간단히 읽었습니다.'],
  };
}
