import { Link } from 'react-router';
import { useSessions } from '@/lib/sessions';

/** 엑셀 업로드는 통합 양식 한 곳에서: 가장 최근 시험 프로젝트의 개요로 안내한다 */
export function BundleHint({ what }: { what: string }) {
  const { data: sessions } = useSessions();
  const latest = sessions[0];
  return (
    <div className="mb-4 rounded-xl border border-primary bg-primary-soft px-4 py-3">
      <span className="font-semibold">엑셀로 한 번에 입력하려면</span>{' '}
      {latest ? (
        <>
          <Link to={`/admin/sessions/${latest.id}`} className="font-bold text-primary-strong underline underline-offset-4">
            시험 프로젝트 개요 → 기초 자료 한 번에 입력
          </Link>
          에서 통합 양식을 쓰세요. {what}도 통합 양식에 함께 들어 있습니다.
        </>
      ) : (
        <>
          <Link to="/admin" className="font-bold text-primary-strong underline underline-offset-4">
            대시보드
          </Link>
          에서 시험 프로젝트를 만든 뒤, 개요의 "기초 자료 한 번에 입력"에서 통합 양식을 쓰세요.
        </>
      )}
    </div>
  );
}
