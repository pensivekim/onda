import { useLang } from '../i18n';

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
  expired: 'bg-error-container text-error',
  approved: 'bg-trust-green-bg text-trust-green',
  suspended: 'bg-error-container text-error',
  paid: 'bg-trust-green-bg text-trust-green',
  wallet_paid: 'bg-trust-green-bg text-trust-green',
  gov_covered: 'bg-secondary-container text-secondary',
  sponsor_covered: 'bg-secondary-container text-secondary',
  active: 'bg-trust-green-bg text-trust-green',
};

// Status → i18n key mapping
const STATUS_KEYS: Record<string, string> = {
  pending: 'stepMatching', matched: 'stepAccepted', accepted: 'stepAccepted', offered: 'stepMatching',
  moving: 'stepMoving', arrived: 'stepArrived', in_progress: 'stepCaring', completed: 'stepDone',
  cancelled: 'reject', rejected: 'reject', expired: 'reject',
  approved: 'approve', suspended: 'suspendAction', paid: 'stepDone',
  wallet_paid: 'stepDone', gov_covered: 'stepDone', sponsor_covered: 'stepDone', active: 'approve',
};

export default function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const key = STATUS_KEYS[status];
  const label = key ? t(key as any) : status;
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${STYLES[status] || STYLES.pending}`}>
      {label}
    </span>
  );
}
