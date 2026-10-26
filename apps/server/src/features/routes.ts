import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '@headunit/shared';
import { createFmRoutes } from '../fm/routes';
import type { FmService } from '../fm/service';
import { BodyTooLarge, json, readJson } from '../http';
import { ActionError, type QuickActions } from './actions';
import { BACKUP_FILE_RE, BACKUP_MAX_BYTES, BackupError, backupFileName, createBackup, restoreBackup, type BackupSinks, type BackupSources } from './backup';
import { DocStore, isDocName } from './docs';
import { Garage, GarageError } from './garage';
import { LyricsService, sanitizeLyricsQuery } from './lyrics';
import { NoteError, NotesService } from './notes';
import { SceneError, ScenesService } from './scenes';
import { TimersError, TimersService } from './timers';
import type { TripRecorder } from './trips';
import type { WeatherService } from './weather';

export interface RouteContext {
  garage: Garage;
  trips: TripRecorder;
  weather: WeatherService;
  timers: TimersService;
  scenes: ScenesService;
  actions: QuickActions;
  notes: NotesService;
  lyrics: LyricsService;
  docs: DocStore;
  fm: FmService;
  settings: () => Settings;
  backupSources: BackupSources;
  backupSinks: BackupSinks;
  /** Where Chromium saves downloads (the easy way to restore a backup without a file picker). */
  downloadsDir: string;
  gpsTrack: () => unknown;
}

const ID = '([a-z0-9]{4,24})';
const NOTES_LIMIT = 64 * 1024;
const ACTIONS_LIMIT = 32 * 1024;

/** Errors the owner can act on: shown as they are, with a 4xx. Anything else is a bug and goes to the server's own handler. */
const friendly = (e: unknown): { status: number; message: string } | null => {
  if (e instanceof ActionError) return { status: e.status, message: e.message };
  if (e instanceof GarageError || e instanceof TimersError || e instanceof SceneError || e instanceof NoteError || e instanceof BackupError) return { status: 400, message: e.message };
  return null;
};

const csvCell = (v: string | number) => {
  const s = String(v);
  // A cell starting with = + - @ would be run as a formula by a spreadsheet: neutralise it.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * The HTTP side of the v2 features. Returns true when it answered the request. Host and Origin protection is applied by the caller
 * before this is reached, for every method that changes anything.
 */
export function createFeatureRoutes(ctx: RouteContext) {
  const fmRoutes = createFmRoutes(ctx.fm);
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> {
    const p = url.pathname;
    if (!p.startsWith('/api/')) return false;
    try {
      return await dispatch(req, res, url, method, p);
    } catch (e) {
      if (e instanceof BodyTooLarge) throw e;
      const f = friendly(e);
      if (!f) throw e;
      json(res, f.status, { error: f.message });
      return true;
    }
  };

  async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL, method: string, p: string): Promise<boolean> {
    let m: RegExpExecArray | null;
    const body = () => readJson(req) as Promise<Record<string, unknown>>;
    const ok = (data: unknown = { ok: true }) => (json(res, 200, data), true);

    // ---- Garage -------------------------------------------------------------
    if (p === '/api/garage' && method === 'GET') return ok(ctx.garage.state.get());
    if (p === '/api/garage/vehicle' && method === 'PUT') return await ctx.garage.setVehicle(await body()), ok(ctx.garage.state.get().vehicle);
    if (p === '/api/garage/fuel' && method === 'POST') return ok(await ctx.garage.addFuel(await body()));
    if ((m = new RegExp(`^/api/garage/fuel/${ID}$`).exec(p))) {
      if (method === 'PUT') return await ctx.garage.updateFuel(m[1]!, await body()), ok();
      if (method === 'DELETE') return await ctx.garage.deleteFuel(m[1]!), ok();
    }
    if (p === '/api/garage/services' && method === 'POST') return ok(await ctx.garage.addService(await body()));
    if ((m = new RegExp(`^/api/garage/services/${ID}/done$`).exec(p)) && method === 'POST') return await ctx.garage.markServiceDone(m[1]!, await body()), ok();
    if ((m = new RegExp(`^/api/garage/services/${ID}$`).exec(p))) {
      if (method === 'PUT') return await ctx.garage.updateService(m[1]!, await body()), ok();
      if (method === 'DELETE') return await ctx.garage.deleteService(m[1]!), ok();
    }
    if (p === '/api/garage/docs' && method === 'POST') return ok(await ctx.garage.addDoc(await body()));
    if ((m = new RegExp(`^/api/garage/docs/${ID}$`).exec(p))) {
      if (method === 'PUT') return await ctx.garage.updateDoc(m[1]!, await body()), ok();
      if (method === 'DELETE') return await ctx.garage.deleteDoc(m[1]!), ok();
    }

    // ---- Trips --------------------------------------------------------------
    if (p === '/api/trips' && method === 'GET') return ok(ctx.trips.state.get());
    if (p === '/api/trips.csv' && method === 'GET') {
      const rows = ctx.trips.all().map((t) => [new Date(t.startedAt).toISOString(), new Date(t.endedAt).toISOString(), t.distanceKm, t.durationS, t.movingS, t.avgSpeedKmh, t.maxSpeedKmh, t.fuelUsedPct ?? ''].map(csvCell).join(','));
      const csv = ['started,ended,distance_km,duration_s,moving_s,avg_kmh,max_kmh,fuel_used_pct', ...rows].join('\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=trips.csv', 'Content-Length': Buffer.byteLength(csv), 'Cache-Control': 'no-store' });
      res.end(csv);
      return true;
    }
    if (p === '/api/trips' && method === 'DELETE') {
      if (url.searchParams.get('confirm') !== '1') return json(res, 400, { error: 'Add ?confirm=1 to delete every trip.' }), true;
      return await ctx.trips.clear(), ok();
    }
    if ((m = new RegExp(`^/api/trips/${ID}$`).exec(p)) && method === 'DELETE') {
      return (await ctx.trips.deleteTrip(m[1]!)) ? ok() : (json(res, 404, { error: 'That trip no longer exists.' }), true);
    }
    if (p === '/api/gps/track.json' && method === 'GET') return ok(ctx.gpsTrack());

    // ---- Weather --------------------------------------------------------------
    if (p === '/api/weather' && method === 'GET') return ok(ctx.weather.state.get());
    if (p === '/api/weather/refresh' && method === 'POST') return await ctx.weather.refresh(true), ok(ctx.weather.state.get());
    if (p === '/api/weather/places' && method === 'GET') {
      try {
        return ok(await ctx.weather.searchPlaces(url.searchParams.get('q') ?? ''));
      } catch (e) {
        return json(res, 502, { error: e instanceof Error ? e.message : 'The place search failed.' }), true;
      }
    }
    if (p === '/api/weather/place' && method === 'PUT') {
      const b = await body();
      if (typeof b.lat !== 'number' || typeof b.lon !== 'number') return json(res, 400, { error: 'Send a latitude and a longitude.' }), true;
      try {
        await ctx.weather.setPlace(b.lat, b.lon, typeof b.name === 'string' ? b.name : undefined);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'That place cannot be used.' }), true;
      }
      return ok(ctx.weather.state.get());
    }
    if (p === '/api/weather/place' && method === 'DELETE') return await ctx.weather.clearPlace(), ok(ctx.weather.state.get());

    // ---- Timers ---------------------------------------------------------------
    if (p === '/api/timers' && method === 'POST') return ok(await ctx.timers.add(await body()));
    if ((m = new RegExp(`^/api/timers/${ID}$`).exec(p)) && method === 'DELETE') return await ctx.timers.remove(m[1]!), ok();

    // ---- Scenes -----------------------------------------------------------------
    if (p === '/api/scenes' && method === 'GET') return ok(ctx.scenes.state.get());
    if (p === '/api/scenes' && method === 'POST') return ok(await ctx.scenes.save(await body()));
    if ((m = new RegExp(`^/api/scenes/${ID}$`).exec(p))) {
      if (method === 'PUT') return ok(await ctx.scenes.save(await body(), m[1]!));
      if (method === 'DELETE') return (await ctx.scenes.remove(m[1]!)) ? ok() : (json(res, 404, { error: 'That scene no longer exists.' }), true);
    }

    // ---- Quick actions ------------------------------------------------------------
    if (p === '/api/actions/config' && method === 'GET') return ok(ctx.actions.config());
    if (p === '/api/actions/config' && method === 'PUT') return await ctx.actions.replace(await (readJson(req, ACTIONS_LIMIT) as Promise<unknown>)), ok(ctx.actions.config());
    if ((m = new RegExp(`^/api/actions/${ID}/run$`).exec(p)) && method === 'POST') return ok(await ctx.actions.run(m[1]!));

    // ---- Notes ----------------------------------------------------------------------
    if (p === '/api/notes' && method === 'GET') return ok(ctx.notes.list());
    if (p === '/api/notes' && method === 'POST') return ok(await ctx.notes.create(await (readJson(req, NOTES_LIMIT) as Promise<unknown>)));
    if ((m = new RegExp(`^/api/notes/${ID}$`).exec(p))) {
      if (method === 'PUT') return ok(await ctx.notes.update(m[1]!, await (readJson(req, NOTES_LIMIT) as Promise<unknown>)));
      if (method === 'DELETE') return (await ctx.notes.remove(m[1]!)) ? ok() : (json(res, 404, { error: 'That note no longer exists.' }), true);
    }

    // ---- Lyrics ----------------------------------------------------------------------
    if (p === '/api/lyrics' && method === 'GET') {
      // Looking a track up tells lrclib.net what is playing, so it only happens once the owner has switched it on.
      if (!ctx.settings().lyrics) return json(res, 403, { error: 'Lyrics are switched off in Settings.' }), true;
      const q = sanitizeLyricsQuery(Object.fromEntries(url.searchParams));
      if (!q) return json(res, 400, { error: 'A title and an artist are needed.' }), true;
      try {
        return ok((await ctx.lyrics.get(q)) ?? { synced: null, plain: null, instrumental: false });
      } catch (e) {
        return json(res, 502, { error: e instanceof Error ? e.message : 'Lyrics are not available right now.' }), true;
      }
    }

    // ---- Small client-owned documents ---------------------------------------------------
    if ((m = /^\/api\/doc\/([a-z]+)$/.exec(p))) {
      if (!isDocName(m[1])) return json(res, 404, { error: 'not found' }), true;
      if (method === 'GET') return ok(await ctx.docs.get(m[1]));
      if (method === 'PUT') {
        try {
          return ok(await ctx.docs.put(m[1], await readJson(req, 17 * 1024)));
        } catch (e) {
          if (e instanceof BodyTooLarge) throw e;
          return json(res, 400, { error: e instanceof Error ? e.message : 'That document was refused.' }), true;
        }
      }
    }

    // ---- FM transmitter ---------------------------------------------------------------------------
    if (p.startsWith('/api/fm/') && (await fmRoutes(req, res, method, p))) return true;

    // ---- Backup -----------------------------------------------------------------------------
    if (p === '/api/backup' && method === 'GET') {
      const text = JSON.stringify(createBackup(ctx.backupSources), null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename=${backupFileName()}`,
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store',
      });
      res.end(text);
      return true;
    }
    if (p === '/api/backup/available' && method === 'GET') return ok(await listBackups(ctx.downloadsDir));
    if (p === '/api/backup/restore' && method === 'POST') {
      const b = (await readJson(req, BACKUP_MAX_BYTES)) as { file?: unknown; bundle?: unknown };
      let bundle: unknown = b.bundle;
      if (bundle === undefined && typeof b.file === 'string') {
        if (!BACKUP_FILE_RE.test(b.file)) return json(res, 400, { error: 'That is not a backup file name.' }), true;
        const path = join(ctx.downloadsDir, b.file);
        const info = await stat(path).catch(() => null);
        if (!info?.isFile() || info.size > BACKUP_MAX_BYTES) return json(res, 404, { error: 'That backup file was not found in Downloads.' }), true;
        try {
          bundle = JSON.parse(await readFile(path, 'utf8'));
        } catch {
          return json(res, 400, { error: 'That file is not valid JSON.' }), true;
        }
      }
      return ok(await restoreBackup(bundle, ctx.backupSinks));
    }
    return false;
  }
}

/** Backup files waiting in Downloads, newest first: restoring one is a single tap on a touchscreen, no file picker. */
async function listBackups(dir: string): Promise<Array<{ file: string; size: number; modifiedAt: string }>> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: Array<{ file: string; size: number; modifiedAt: string; ms: number }> = [];
  for (const file of names.filter((n) => BACKUP_FILE_RE.test(n))) {
    const info = await stat(join(dir, file)).catch(() => null);
    if (info?.isFile() && info.size <= BACKUP_MAX_BYTES) out.push({ file, size: info.size, modifiedAt: info.mtime.toISOString(), ms: info.mtimeMs });
  }
  return out
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map(({ ms: _ms, ...rest }) => rest);
}
