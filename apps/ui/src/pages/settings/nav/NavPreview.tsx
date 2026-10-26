import { useMemo } from 'react';
import type { NavConfig } from '@headunit/shared';
import { APPS } from '../../../apps/registry';
import { resolveNav } from '../../../lib/nav';
import { useHeadUnit } from '../../../store';
import { DockView } from '../../../shell/Dock';

/**
 * A small picture of a rail (the saved one, in Settings): the real rail drawn at a fixed screen height and scaled down, next to a blank
 * page on the side the rail is on. It is a picture only: hidden from assistive technology, not focusable, not tappable, and not a
 * second navigation landmark. The size and label keys sit on a wrapper because the rail's CSS reads them from any ancestor.
 */
export function NavPreview({ config }: { config: NavConfig }) {
  const scenes = useHeadUnit((s) => s.svc.scenes);
  const actions = useHeadUnit((s) => s.svc.actions);
  const items = useMemo(() => resolveNav(config, { apps: APPS, scenes, actions }), [config, scenes, actions]);
  // The first real button stands in for "the page you are on", so the preview shows the rail's highlight too.
  const activeId = items.find((i) => i.kind === 'go' && i.state === 'ok')?.id ?? null;
  const rail = (
    <div className="nvp-rail">
      <DockView preview items={items} activeId={activeId} />
    </div>
  );
  const page = <div className="nvp-page" />;
  return (
    <div className="nvp" aria-hidden="true" data-nav-pos={config.position} data-nav-size={config.size} data-nav-labels={config.labels}>
      {config.position === 'right' ? (
        <>
          {page}
          {rail}
        </>
      ) : (
        <>
          {rail}
          {page}
        </>
      )}
    </div>
  );
}
