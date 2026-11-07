/** The journey on the TPL service for schools card: the loop, and that the steps read the same with no motion. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { nextStep } from './motion.tsx';
import { SCHOOL_TPL, SchoolSteps } from './Services.tsx';

describe('the steps of the school service', () => {
  it('go one after another and start over after the last', () => {
    expect(nextStep(null, 5)).toBe(0);
    expect(nextStep(0, 5)).toBe(1);
    expect(nextStep(3, 5)).toBe(4);
    expect(nextStep(4, 5)).toBe(0);
  });

  it('all show before anything moves, with no package, so a still device reads them the same', () => {
    const markup = renderToStaticMarkup(createElement(SchoolSteps, { steps: SCHOOL_TPL.steps }));
    for (const [title, text] of SCHOOL_TPL.steps) {
      expect(markup).toContain(title.replace(/'/g, '&#x27;'));
      expect(markup).toContain(text.replace(/'/g, '&#x27;'));
    }
    expect(markup.match(/data-step=""/g)).toHaveLength(SCHOOL_TPL.steps.length);
    expect(markup).not.toContain('tour-package');
  });
});
