import { Suspense, memo, useCallback, useMemo, useState } from 'react';
import { AppWindow, EyeOff, Pin } from 'lucide-react';
import { APPS, APP_GROUPS, appById, type AppBadge, type AppDef } from '../apps/registry';
import { useAppBadges } from '../apps/badges';
import { Badge, DrivingGate, Empty, Page, Spinner } from '../components/ui';
import { EDIT_LOCKED_MESSAGE, useTypingLocked } from '../lib/driving';
import { openAppDef, useLongPress } from '../lib/nav';
import { hiddenApps, visibleApps } from '../lib/surfaces';
import { useHeadUnit } from '../store';
import { AppTileMenu } from './apps/AppTileMenu';

const NONE: readonly string[] = [];

/** One launcher tile. A tap opens the app; a long press opens its menu (and the click that ends the press is swallowed). */
const AppTile = memo(function AppTile({ app, badge, hidden, onNav, canHold, onHold, index }: { app: AppDef; badge: AppBadge | undefined; hidden: boolean; onNav: boolean; canHold: boolean; onHold(app: AppDef): void; index: number }) {
  const gesture = useLongPress({ onLongPress: () => onHold(app), enabled: canHold });
  const Icon = app.icon;
  const hue = app.hue ?? 260;
  return (
    <button type="button" className="card app-tile" onClick={() => openAppDef(app)} data-tone={badge?.tone} data-hidden={hidden || undefined} style={{ ['--i' as string]: index, ['--h' as string]: hue }} {...gesture}>
      <span className="app-icon">
        <Icon />
      </span>
      <span className="app-text">
        <b className="truncate">{app.name}</b>
        <small>{app.description}</small>
      </span>
      {onNav && (
        <span className="app-pin" role="img" aria-label="On the navigation">
          <Pin size={13} aria-hidden="true" />
        </span>
      )}
      {badge && (
        <span className="app-badge">
          <Badge tone={badge.tone}>{badge.text}</Badge>
        </span>
      )}
      {hidden && (
        <span className="app-hidden">
          <EyeOff size={12} /> Hidden
        </span>
      )}
    </button>
  );
});

/**
 * The launcher: every app as a tile, in groups, with a marker where something needs a look. Hold a tile for its menu (pin it to the
 * navigation, hide it). Hidden apps are not drawn, except one that needs a look; the Hidden button shows them again.
 */
export function AppsPage() {
  const badges = useAppBadges();
  const hidden = useHeadUnit((s) => s.settings?.launcher.hidden) ?? NONE;
  const editorOpen = useHeadUnit((s) => s.navEditor !== null);
  const navItems = useHeadUnit((s) => s.settings?.nav.items);
  const onNav = useMemo(() => new Set((navItems ?? []).flatMap((i) => (i.to.kind === 'app' ? [i.to.app] : []))), [navItems]);
  const toast = useHeadUnit((s) => s.showToast);
  const locked = useTypingLocked();
  const [showHidden, setShowHidden] = useState(false);
  const [menuFor, setMenuFor] = useState<AppDef | null>(null);
  const hiddenCount = hiddenApps(APPS, hidden).length;
  const revealed = showHidden && hiddenCount > 0;
  const shown = visibleApps(APPS, hidden, badges, revealed);
  const hold = useCallback((app: AppDef) => (locked ? toast(EDIT_LOCKED_MESSAGE) : setMenuFor(app)), [locked, toast]);
  let index = 0;
  return (
    <Page
      actions={
        hiddenCount > 0 ? (
          <button type="button" className="chip" data-active={revealed} aria-pressed={revealed} onClick={() => setShowHidden(!revealed)}>
            <EyeOff />
            Hidden ({hiddenCount})
          </button>
        ) : undefined
      }
    >
      {APP_GROUPS.map((group) => {
        const apps = shown.filter((a) => a.group === group);
        if (apps.length === 0) return null;
        return (
          <section key={group} className="col" style={{ gap: 8 }}>
            <div className="section-title">{group}</div>
            <div className="apps-grid stagger">
              {apps.map((a) => (
                <AppTile key={a.id} app={a} badge={badges[a.id]} hidden={revealed && hidden.includes(a.id)} onNav={onNav.has(a.id)} canHold={!editorOpen} onHold={hold} index={index++} />
              ))}
            </div>
          </section>
        );
      })}
      {shown.length === 0 && (
        <Empty icon={EyeOff} title="Every app is hidden">
          Tap Hidden above to bring them back.
        </Empty>
      )}
      {menuFor && <AppTileMenu app={menuFor} onClose={() => setMenuFor(null)} />}
    </Page>
  );
}

/** Shows the app named by the store. A parked-only app shows the driving lock instead while the car is moving. */
export function AppHost() {
  const id = useHeadUnit((s) => s.appId);
  const app = appById(id);
  const Component = app?.Component;
  if (!app || !Component)
    return (
      <div className="page">
        <Empty icon={AppWindow} title="That app is not available" />
      </div>
    );
  const body = (
    <Suspense
      fallback={
        <div className="page" style={{ display: 'grid', placeItems: 'center' }}>
          <Spinner />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
  return app.parkedOnly ? <ParkedOnly name={app.name}>{body}</ParkedOnly> : body;
}

function ParkedOnly({ name, children }: { name: string; children: React.ReactNode }) {
  const locked = useTypingLocked();
  if (!locked) return <>{children}</>;
  return (
    <div className="page">
      <DrivingGate what={name}>{children}</DrivingGate>
    </div>
  );
}
