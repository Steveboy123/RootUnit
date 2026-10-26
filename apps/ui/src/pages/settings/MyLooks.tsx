import { useState } from 'react';
import { Bookmark, ClipboardPaste, Share2, Trash2 } from 'lucide-react';
import { BUILTIN_WALLPAPERS, SAVED_LOOK_LIMITS, cleanLookName, lookOf, type BuiltinWallpaper, type LookValues, type SavedLook } from '@headunit/shared';
import { CopyButton } from '../../components/CopyButton';
import { Banner, ConfirmButton, TextField } from '../../components/ui';
import { useTypingLocked } from '../../lib/driving';
import { decodeLook, encodeLook } from '../../lib/lookCode';
import { useHeadUnit } from '../../store';
import { LookThumb } from './LookThumb';
import { SetSection } from './parts';

/** The picture a saved look's tile shows: its own wallpaper when it is a built-in one, otherwise its palette's colours. */
const thumbOf = (look: LookValues): BuiltinWallpaper | undefined =>
  look.background === 'wallpaper' && (BUILTIN_WALLPAPERS as readonly string[]).includes(look.wallpaper) ? (look.wallpaper as BuiltinWallpaper) : undefined;

const newId = () => `look-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`;

/**
 * My looks: the look on screen saved under a name, used again in one tap, shared as a code (paste it into another head unit, or keep it
 * in a note), or added from someone else's code. The list is part of the settings, so it is in every backup.
 */
export function MyLooksSection() {
  const settings = useHeadUnit((s) => s.settings);
  const patch = useHeadUnit((s) => s.patchSettings);
  const toast = useHeadUnit((s) => s.showToast);
  const locked = useTypingLocked();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [sharing, setSharing] = useState<string | null>(null);
  if (!settings) return null;
  const list = settings.myLooks ?? [];
  const full = list.length >= SAVED_LOOK_LIMITS.count;
  const save = (looks: SavedLook[]) => patch({ myLooks: looks });

  const saveCurrent = () => {
    const clean = cleanLookName(name);
    if (!clean || full) return;
    save([...list, { id: newId(), name: clean, look: lookOf(settings) }]);
    setName('');
    toast(`Saved “${clean}”`);
  };
  const addFromCode = () => {
    const found = decodeLook(code);
    if (!found) return setNote('That is not a look code. A code starts with RU1.');
    if (full) return setNote(`My looks is full (${SAVED_LOOK_LIMITS.count}). Delete one first.`);
    save([...list, { id: newId(), name: found.name, look: found.look }]);
    setCode('');
    setNote(`Added “${found.name}”. Tap Use to wear it.`);
  };

  return (
    <SetSection title="My looks" icon={Bookmark} blurb="Save the look you have now under a name, wear it again in one tap, or share it as a code with another head unit.">
      {locked ? (
        <Banner role="status">Park to name or add a look. Saved looks can still be used.</Banner>
      ) : (
        <div className="row wrap my-looks-save">
          <TextField className="grow" value={name} onChange={setName} placeholder="Name the look on screen" maxLength={SAVED_LOOK_LIMITS.name} onEnter={saveCurrent} />
          <button type="button" className="btn primary" disabled={!cleanLookName(name) || full} onClick={saveCurrent}>
            <Bookmark size={16} /> Save this look
          </button>
          <span className="dim small">
            {list.length} of {SAVED_LOOK_LIMITS.count}
          </span>
        </div>
      )}
      {list.length > 0 && (
        <div className="look-grid my-looks">
          {list.map((l) => (
            <div key={l.id} className="look-tile my-look">
              <LookThumb preset={{ patch: l.look, thumb: thumbOf(l.look) }} />
              <b className="truncate">{l.name}</b>
              <div className="row my-look-actions">
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => {
                    patch(l.look);
                    toast(`${l.name} look`);
                  }}
                >
                  Use
                </button>
                <button type="button" className="icon-btn" aria-label={`Share ${l.name}`} aria-expanded={sharing === l.id} onClick={() => setSharing((s) => (s === l.id ? null : l.id))}>
                  <Share2 size={18} />
                </button>
                <ConfirmButton className="icon-btn danger" label={<Trash2 size={18} aria-label={`Delete ${l.name}`} />} confirmLabel="Delete?" onConfirm={() => save(list.filter((x) => x.id !== l.id))} />
              </div>
              {sharing === l.id && (
                <div className="my-look-code">
                  <code className="copy-box">{encodeLook(l.name, l.look)}</code>
                  <CopyButton text={encodeLook(l.name, l.look)} what="look code" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!locked && (
        <div className="row wrap my-looks-import">
          <TextField className="grow" icon={ClipboardPaste} value={code} onChange={(v) => (setCode(v), setNote(''))} placeholder="Paste a look code (RU1.…)" onEnter={addFromCode} />
          <button type="button" className="btn" disabled={!code.trim()} onClick={addFromCode}>
            Add from code
          </button>
        </div>
      )}
      {note && (
        <p className="dim small" role="status">
          {note}
        </p>
      )}
    </SetSection>
  );
}
