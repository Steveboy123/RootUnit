import type { ReactNode } from 'react';
import { NAV_MUSIC_TABS, type NavConfig, type NavMusicTab, type NavRoute, type NavTarget } from '@headunit/shared';
import { MAX_BUTTONS, canAdd, isFull, type AddRefusal } from '../../../lib/navEdit';
import type { NavContext } from '../../../lib/nav';
import { Banner } from '../../../components/ui';
import { describeTarget } from './describe';

export interface NavAddPickerProps {
  config: NavConfig;
  ctx: NavContext;
  onAdd(to: NavTarget, name: string): void;
}

/** The built-in pages that can be on the rail (Settings is always there, so it is not offered). */
const PAGES: Array<{ route: Exclude<NavRoute, 'settings'>; hint: string }> = [
  { route: 'home', hint: 'Your dashboard' },
  { route: 'drive', hint: 'Speed and trip' },
  { route: 'media', hint: 'Spotify, TIDAL, YouTube Music, radio' },
  { route: 'aa', hint: 'Android Auto' },
  { route: 'apps', hint: 'All your apps' },
];

const MUSIC_HINT: Record<NavMusicTab, string> = {
  spotify: 'Opens Music on Spotify',
  tidal: 'Opens Music on TIDAL',
  'youtube-music': 'Opens Music on YouTube Music',
  radio: 'Opens Music on the radio',
};

const WHY: Record<AddRefusal, string> = { pinned: 'Already on the navigation', full: 'Navigation is full', fixed: 'Always there' };

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="ne-group">
      <h3 className="ne-h">{title}</h3>
      {note && <p className="ne-hint">{note}</p>}
      <div className="ne-picks">{children}</div>
    </section>
  );
}

/**
 * Everything that can go on the rail, in four groups: apps (the launcher's own list, with their usual pictures), the four music
 * sources, the person's scenes and actions, and the built-in pages (last: most are already there; they are here so a page that was taken off can come back). What is already on the rail is greyed out and says so; when the rail is
 * full everything is. Scenes and actions say once that they ask for a second tap.
 */
export function NavAddPicker({ config, ctx, onAdd }: NavAddPickerProps) {
  const full = isFull(config);

  const pick = (to: NavTarget, key: string, hint: string, name?: string) => {
    const info = describeTarget(to, ctx);
    const shown = name ?? info.label;
    const why = canAdd(config, to);
    return (
      <button key={key} type="button" className="ne-pick" disabled={why !== null} onClick={() => onAdd(to, shown)}>
        <info.Icon size={22} className="ne-row-icon" />
        <span className="ne-row-text">
          <b>{shown}</b>
          <small>{why ? WHY[why] : hint}</small>
        </span>
      </button>
    );
  };

  const scenes = ctx.scenes;
  const actions = ctx.actions;

  return (
    <div className="ne-picker">
      {full && (
        <Banner tone="warn">
          Navigation is full: it holds {MAX_BUTTONS} buttons besides Settings. Remove one to add another.
        </Banner>
      )}
      <Group title="Apps">
        {ctx.apps.map((a) => {
          const on = describeTarget({ kind: 'app', app: a.id }, ctx).label;
          // The picker names an app as the launcher does; the rail may use a shorter name, and that is said here so it is no surprise.
          return pick({ kind: 'app', app: a.id }, `app-${a.id}`, on !== a.name ? `Shown as “${on}”` : 'App', a.name);
        })}
      </Group>
      <Group title="Music">{NAV_MUSIC_TABS.map((tab) => pick({ kind: 'music', tab }, `music-${tab}`, MUSIC_HINT[tab]))}</Group>
      <Group title="Scenes & actions" note="Scenes and actions change things in the car, so they ask for a second tap before they run.">
        {scenes === undefined || actions === undefined ? <p className="ne-hint">Waiting for the head unit…</p> : null}
        {scenes?.map((s) => pick({ kind: 'scene', scene: s.id }, `scene-${s.id}`, 'Scene'))}
        {actions?.map((a) => pick({ kind: 'action', action: a.id }, `action-${a.id}`, 'Action'))}
        {scenes && actions && scenes.length + actions.length === 0 && <p className="ne-hint">You have no scenes or actions yet. Make some in the Scenes and Quick actions apps.</p>}
      </Group>
      {/* Last: most of them are already on the rail, and they are only here so that a page that was taken off can be put back. */}
      <Group title="Pages">{PAGES.map((p) => pick({ kind: 'route', route: p.route }, `route-${p.route}`, p.hint))}</Group>
    </div>
  );
}
