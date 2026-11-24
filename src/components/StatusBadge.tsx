import type { ExpiryStateInfo } from '../types/instrument';

export function ExpiryBadge({
  state,
  showDetail = false
}: {
  state: ExpiryStateInfo;
  showDetail?: boolean;
}) {
  return (
    <span className={`badge badge--${state.code}`}>
      <span className="badge-dot" aria-hidden="true" />
      <span>
        {state.label}
        {showDetail && state.code !== 'unset' ? ` (${state.detailText})` : ''}
      </span>
    </span>
  );
}

export function RegistryStatusTag({ statusText }: { statusText: string }) {
  return (
    <span className="status-tag" translate="no">
      {statusText}
    </span>
  );
}
