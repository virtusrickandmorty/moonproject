/** The workshop's steps on the About us page: all of them read the same before anything moves, or on a still device. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WORKSHOP_STEPS, WorkshopFlow } from './Workshop.tsx';

describe('the workshop steps', () => {
  it('all show, numbered, with none lit and no glow, before the tour starts', () => {
    const markup = renderToStaticMarkup(createElement(WorkshopFlow));
    for (const s of WORKSHOP_STEPS) {
      expect(markup).toContain(`>${s.title}<`);
      expect(markup).toContain(s.text);
    }
    expect(markup.match(/data-step=""/g)).toHaveLength(WORKSHOP_STEPS.length);
    expect(markup.match(/data-dot=""/g)).toHaveLength(WORKSHOP_STEPS.length);
    expect(markup).not.toContain('data-active');
    expect(markup).not.toContain('workshop-glow');
  });
});
