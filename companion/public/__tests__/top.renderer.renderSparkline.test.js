import { describe, it, expect } from 'vitest';
import { renderSparkline } from '../top.renderer.js';

describe('EGTopRenderer.renderSparkline()', () => {
  it('returns inline SVG for valid series', () => {
    const series = [
      [0, 10],
      [1, 15],
      [2, 12],
      [3, 20],
    ];
    const svg = renderSparkline(series);
    expect(typeof svg).toBe('string');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path d="M');
  });

  it('returns empty string on invalid input', () => {
    const svg = renderSparkline(null);
    expect(svg).toBe('');
  });
});
