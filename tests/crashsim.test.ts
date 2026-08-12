import { describe, it, expect } from 'vitest';
import {
  STAGES, outcomeAt, outcomeIfFinalizedFirst,
  duplicateWindowStages, lossStagesIfFinalizedFirst,
} from '../src/scripts/crashsim';

describe('crash outcomes under finalize-after-commit', () => {
  it('never loses data: the source survives any crash before commit', () => {
    for (const s of STAGES) {
      const o = outcomeAt(s);
      if (!o.rowsCommitted) {
        expect(o.sourceRemains, `crash at ${s} must leave the source in place`).toBe(true);
      }
    }
  });

  it('never leaves a state with no rows and no source — that would be loss', () => {
    for (const s of STAGES) {
      const o = outcomeAt(s);
      expect(o.rowsCommitted || o.sourceRemains, `crash at ${s} lost the data`).toBe(true);
    }
  });

  it('rolls back a COPY that was issued but never acked', () => {
    const o = outcomeAt('flushing');
    expect(o.rowsCommitted).toBe(false);
    expect(o.sourceRemains).toBe(true);
    expect(o.verdict).toBe('clean');
  });

  it('has exactly one duplicate window, between commit and finalize', () => {
    expect(duplicateWindowStages()).toEqual(['committed']);
  });

  it('is a no-op once the file is finalized', () => {
    const o = outcomeAt('finalized');
    expect(o.sourceRemains).toBe(false);
    expect(o.rowsCommitted).toBe(true);
    expect(o.verdict).toBe('nothing-to-do');
  });

  it('the reversed ordering trades duplicates for permanent loss', () => {
    const loss = lossStagesIfFinalizedFirst();
    expect(loss.length).toBeGreaterThan(0);
    for (const s of loss) {
      // Under the real ordering these same points are safe.
      expect(outcomeAt(s).rowsCommitted || outcomeAt(s).sourceRemains).toBe(true);
    }
  });

  it('describes every stage — no gaps in the model', () => {
    for (const s of STAGES) {
      const o = outcomeAt(s);
      expect(o.why.length).toBeGreaterThan(20);
      expect(o.nextRun.length).toBeGreaterThan(10);
      expect(['clean', 'duplicate-window', 'nothing-to-do']).toContain(o.verdict);
      expect(outcomeIfFinalizedFirst(s)).toBeDefined();
    }
  });
});
