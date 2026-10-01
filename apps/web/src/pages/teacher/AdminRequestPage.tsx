import { AccessRequestForm } from '@/components/AccessRequestForm';
import { Card, PageTitle } from '@/components/ui';

/** 교사가 관리자 권한을 신청하는 화면 */
export function AdminRequestPage() {
  return (
    <>
      <PageTitle sub="시험 일정·배정을 관리하려면 관리자 권한을 신청하세요. 기존 관리자가 승인하면 바로 관리자 화면으로 바뀝니다.">관리자 권한 신청</PageTitle>
      <Card className="max-w-xl">
        <AccessRequestForm kinds={['ADMIN']} />
      </Card>
    </>
  );
}
