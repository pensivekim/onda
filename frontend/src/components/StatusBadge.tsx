const STYLES: Record<string, string> = {
  pending: 'bg-surface-high text-on-surface-variant',
  matched: 'bg-secondary-container text-secondary',
  accepted: 'bg-secondary-container text-secondary',
  offered: 'bg-secondary-container text-secondary',
  moving: 'bg-orange-grade-bg text-orange-grade',
  arrived: 'bg-orange-grade-bg text-orange-grade',
  in_progress: 'bg-orange-grade-bg text-orange-grade',
  completed: 'bg-trust-green-bg text-trust-green',
  cancelled: 'bg-error-container text-error',
  rejected: 'bg-error-container text-error',
  approved: 'bg-trust-green-bg text-trust-green',
  suspended: 'bg-error-container text-error',
  paid: 'bg-trust-green-bg text-trust-green',
};

const LABELS: Record<string, string> = {
  pending: '대기중', matched: '매칭됨', accepted: '수락', offered: '제안됨',
  moving: '이동중', arrived: '도착', in_progress: '돌봄중', completed: '완료',
  cancelled: '취소됨', rejected: '거절', approved: '승인됨', suspended: '정지',
  paid: '지급완료',
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${STYLES[status] || STYLES.pending}`}>
      {LABELS[status] || status}
    </span>
  );
}
