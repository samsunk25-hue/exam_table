import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { arrayUnion, collection, doc, onSnapshot, query, updateDoc, where, writeBatch, type Timestamp } from 'firebase/firestore';
import { useAuth } from '@/auth/AuthProvider';
import { auth, db } from '@/lib/firebase';

interface Notice {
  id: string;
  audience: 'TEACHER' | 'ADMIN';
  title: string;
  body: string;
  link: string;
  read?: boolean;
  readBy?: string[];
  createdAt: Timestamp | null;
}

/** 최근 60일 알림을 최신순으로 (교사: 본인 알림, 관리자: 관리자 알림) */
function useNotices() {
  const { role, teacherId } = useAuth();
  const [list, setList] = useState<Notice[]>([]);
  useEffect(() => {
    const col = collection(db, 'notifications');
    const q = role === 'ADMIN' ? query(col, where('audience', '==', 'ADMIN')) : role === 'TEACHER' && teacherId ? query(col, where('teacherId', '==', teacherId)) : null;
    if (!q) return setList([]);
    const since = Date.now() - 60 * 86_400_000;
    return onSnapshot(
      q,
      (snap) =>
        setList(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Notice)
            .filter((n) => (n.createdAt?.toMillis() ?? Date.now()) >= since)
            .sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())),
        ),
      () => setList([]),
    );
  }, [role, teacherId]);
  return list;
}

const isUnread = (n: Notice) => (n.audience === 'ADMIN' ? !(n.readBy ?? []).includes(auth.currentUser?.uid ?? '') : !n.read);

async function markRead(n: Notice) {
  if (!isUnread(n)) return;
  const ref = doc(db, 'notifications', n.id);
  await (n.audience === 'ADMIN' ? updateDoc(ref, { readBy: arrayUnion(auth.currentUser!.uid) }) : updateDoc(ref, { read: true }));
}

function when(t: Timestamp | null) {
  const d = t?.toDate();
  if (!d) return '방금';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 머리글 알림 종: 안 읽은 수, 누르면 목록. 알림을 누르면 읽음 처리하고 해당 화면으로 */
export function NotificationBell() {
  const list = useNotices();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const unread = list.filter(isUnread);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const go = (n: Notice) => {
    void markRead(n).catch(() => {});
    setOpen(false);
    void navigate(n.link);
  };
  const readAll = async () => {
    const batch = writeBatch(db);
    for (const n of unread) {
      const ref = doc(db, 'notifications', n.id);
      if (n.audience === 'ADMIN') batch.update(ref, { readBy: arrayUnion(auth.currentUser!.uid) });
      else batch.update(ref, { read: true });
    }
    await batch.commit().catch(() => {});
  };

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-label={`알림${unread.length ? ` ${unread.length}건 안 읽음` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="relative flex size-12 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface text-xl hover:border-primary hover:bg-primary-soft"
      >
        <span aria-hidden>🔔</span>
        {unread.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-6 rounded-full bg-alert px-1.5 text-center text-xs leading-6 font-bold text-white">
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="알림" className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-card border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-bold">알림</span>
            {unread.length > 0 && (
              <button type="button" className="cursor-pointer text-sm font-semibold text-primary-strong hover:underline" onClick={() => void readAll()}>
                모두 읽음
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <p className="px-4 py-6 text-center text-muted">새 알림이 없습니다.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {list.slice(0, 30).map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => go(n)}
                    className={`block w-full cursor-pointer border-b border-line px-4 py-3 text-left hover:bg-bg ${isUnread(n) ? 'bg-primary-soft/50' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">
                        {isUnread(n) && <span className="mr-1.5 inline-block size-2 rounded-full bg-alert align-middle" aria-label="안 읽음" />}
                        {n.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{when(n.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 text-sm">{n.body}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
