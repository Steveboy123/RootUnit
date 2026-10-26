import { describe, expect, it } from 'vitest';
import { REF_RE } from '@headunit/shared';
import { APPS, appById } from '../../apps/registry';

describe('AppDef integrity (the rail pins apps by these)', () => {
  it('ids are unique and valid app references (REF_RE: `gps` is 3 characters)', () => {
    const ids = APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(REF_RE);
  });

  it('an app that is a page (Phones, Vehicle) has a route and no Component; every other app has a Component and no route', () => {
    const pages = APPS.filter((a) => a.route);
    expect(pages.map((a) => a.id).sort()).toEqual(['devices', 'vehicle']);
    for (const a of APPS) {
      if (a.route) expect(a.Component, a.id).toBeUndefined();
      else expect(a.Component, a.id).toBeDefined();
    }
  });

  it('the route of a page app is its own id, so the rail can tell it is the current page', () => {
    for (const a of APPS.filter((x) => x.route)) expect(a.route, a.id).toBe(a.id);
  });

  it('every short name is at most 10 characters and no longer than the name it shortens', () => {
    for (const a of APPS) {
      if (a.short === undefined) continue;
      expect(a.short.trim(), a.id).toBe(a.short);
      expect(a.short.length, a.id).toBeGreaterThan(0);
      expect(Array.from(a.short).length, a.id).toBeLessThanOrEqual(10);
      expect(a.short.length, a.id).toBeLessThanOrEqual(a.name.length);
    }
  });

  it('the long names the rail could not fit have short ones', () => {
    expect(appById('findcar')?.short).toBe('Find car');
    expect(appById('perf')?.short).toBe('Perf');
    expect(appById('actions')?.short).toBe('Actions');
    // anything whose name is wider than the compact rail's label (about 8 characters) has a short name
    for (const a of APPS.filter((x) => Array.from(x.name).length > 8)) expect(a.short, a.id).toBeDefined();
  });

  it('names, descriptions and icons are all present', () => {
    for (const a of APPS) {
      expect(a.name.length, a.id).toBeGreaterThan(0);
      expect(a.description.length, a.id).toBeGreaterThan(0);
      expect(a.icon, a.id).toBeDefined();
    }
  });
});
