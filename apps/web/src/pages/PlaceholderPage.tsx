import { Card, PageTitle } from '@/components/ui';

export function PlaceholderPage({ title, sprint, description }: { title: string; sprint: string; description: string }) {
  return (
    <>
      <PageTitle>{title}</PageTitle>
      <Card>
        <p className="font-semibold">{sprint}에서 구현 예정입니다.</p>
        <p className="mt-1 text-muted">{description}</p>
      </Card>
    </>
  );
}
