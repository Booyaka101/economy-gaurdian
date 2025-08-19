import { describe, it, expect, beforeEach } from 'vitest';
import {
  nameCache,
  qualityCache,
  itemsToCSV,
  itemsToJSON,
  getRealmLabel,
  buildTsmGroupText,
} from '../top.services.js';

function resetCaches() {
  nameCache.clear();
  qualityCache.clear();
}

describe('EGTopServices utilities', () => {
  beforeEach(() => {
    resetCaches();
    // Clean DOM
    document.body.innerHTML = '';
    // Ensure localStorage is clean
    try {
      localStorage.clear();
    } catch {}
  });

  it('itemsToCSV formats header, uses nameCache and ceil(soldPerDay), and prints quality', () => {
    nameCache.set(101, 'Shiny Hammer');
    qualityCache.set(101, 3);
    const csv = itemsToCSV([{ itemId: 101, soldPerDay: 2.2 }]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Item ID,Name,Sold/Day,Quality');
    expect(lines[1]).toBe('101,Shiny Hammer,3,3');
  });

  it('itemsToJSON merges cache name and quality, keeps itemId numeric', () => {
    nameCache.set(202, ' Iron Nail ');
    qualityCache.set(202, 1);
    const arr = itemsToJSON([{ itemId: '202', soldPerDay: '5.9' }]);
    expect(arr).toEqual([{ itemId: 202, itemName: ' Iron Nail ', soldPerDay: 5.9, quality: 1 }]);
  });

  it('getRealmLabel prefers DOM content but falls back to localStorage', () => {
    const lbl = document.createElement('div');
    lbl.id = 'realmTop';
    lbl.textContent = 'Realm Proudmoore '; // will trim prefix
    document.body.appendChild(lbl);
    localStorage.setItem('eg_realm_label', 'IgnoredByDOM');
    expect(getRealmLabel()).toBe('Proudmoore');

    // Remove DOM to test fallback
    document.body.removeChild(lbl);
    localStorage.setItem('eg_realm_label', ' Area-52 ');
    expect(getRealmLabel()).toBe('Area-52');
  });

  it('buildTsmGroupText builds header and item lines from array', () => {
    const txt = buildTsmGroupText([
      { itemId: 1 },
      { itemId: 2 },
      { itemId: 2 }, // dedup
    ]);
    const lines = txt.split('\n');
    expect(lines[0].startsWith('# TSM Group')).toBe(true);
    expect(lines).toContain('tsm:item:1');
    expect(lines).toContain('tsm:item:2');
  });
});
