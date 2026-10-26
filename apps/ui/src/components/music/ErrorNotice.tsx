import { SERVICE_INFO } from '@headunit/shared';
import type { ApiError } from '../../lib/api';
import { serviceOfProvider } from '../../lib/connections';
import { useHeadUnit } from '../../store';
import { Banner } from '../ui';

/** A failed library request: says what happened and, where it helps, offers the fix. */
export function ErrorNotice({ error, onRetry }: { error: ApiError; onRetry?(): void }) {
  const provider = useHeadUnit((s) => s.media?.provider);
  const service = serviceOfProvider(provider) ?? 'spotify';
  const reconnect = error.code === 'scope' || error.code === 'auth';
  return (
    <Banner
      tone="warn"
      action={
        reconnect ? (
          <a className="btn small primary" href={`/auth/${service}/login`}>
            Reconnect {SERVICE_INFO[service].label}
          </a>
        ) : onRetry ? (
          <button type="button" className="btn small" onClick={onRetry}>
            Try again
          </button>
        ) : undefined
      }
    >
      {error.message}
    </Banner>
  );
}
