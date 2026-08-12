/** A file's journey through the writer, and what a hard kill costs at each
 *  point. DOM-free so the outcomes are asserted rather than asserted-at.
 *
 *  The rule the whole design turns on: the source file is finalized (deleted
 *  or quarantined) only AFTER its rows are committed. Everything below follows
 *  from that ordering. */

export type Stage =
  | 'claimed'
  | 'parsed'
  | 'buffered'
  | 'flushing'
  | 'committed'
  | 'finalized';

export const STAGES: Stage[] = [
  'claimed', 'parsed', 'buffered', 'flushing', 'committed', 'finalized',
];

export const STAGE_LABEL: Record<Stage, string> = {
  claimed: 'claimed by the scanner',
  parsed: 'decoded on the CPU pool',
  buffered: 'rows appended to the table buffer',
  flushing: 'COPY issued, not yet acked',
  committed: 'COPY acked — rows are durable',
  finalized: 'source deleted',
};

export type Verdict = 'clean' | 'duplicate-window' | 'nothing-to-do';

export interface Outcome {
  verdict: Verdict;
  /** Are the rows in the database after the crash? */
  rowsCommitted: boolean;
  /** Is the source file still sitting in the input directory? */
  sourceRemains: boolean;
  /** What the next run does with it. */
  nextRun: string;
  /** Why this is or isn't safe. */
  why: string;
}

export function outcomeAt(stage: Stage): Outcome {
  switch (stage) {
    case 'claimed':
    case 'parsed':
    case 'buffered':
      return {
        verdict: 'clean',
        rowsCommitted: false,
        sourceRemains: true,
        nextRun: 'picks the file up and processes it from the start',
        why:
          'Nothing reached the database. Buffered rows live in process memory only, ' +
          'so losing them loses nothing durable — the file is still the source of truth.',
      };
    case 'flushing':
      return {
        verdict: 'clean',
        rowsCommitted: false,
        sourceRemains: true,
        nextRun: 'picks the file up and processes it from the start',
        why:
          'The COPY was issued but never acked, so the transaction was never committed. ' +
          'Postgres rolls it back when the connection dies. The file was never finalized, ' +
          'so it is still there to retry.',
      };
    case 'committed':
      return {
        verdict: 'duplicate-window',
        rowsCommitted: true,
        sourceRemains: true,
        nextRun: 're-processes a file whose rows are already committed',
        why:
          'This is the one unavoidable window. Two facts — rows committed, source deleted — ' +
          'cannot be made atomic across a database and a filesystem. Finalize-after-commit ' +
          'chooses to risk a duplicate rather than risk data loss.',
      };
    case 'finalized':
      return {
        verdict: 'nothing-to-do',
        rowsCommitted: true,
        sourceRemains: false,
        nextRun: 'never sees the file — it is gone',
        why: 'Rows are durable and the source has been removed. Nothing is left to redo.',
      };
  }
}

/** Had the ordering been reversed — delete the source first, then COPY — the
 *  same crash points produce data loss instead of duplicates. This is the
 *  comparison that justifies the choice. */
export function outcomeIfFinalizedFirst(stage: Stage): Outcome {
  if (stage === 'claimed' || stage === 'parsed' || stage === 'buffered') {
    return {
      verdict: 'clean',
      rowsCommitted: false,
      sourceRemains: true,
      nextRun: 'reprocesses the file',
      why: 'Still before any irreversible step.',
    };
  }
  return {
    verdict: 'duplicate-window',
    rowsCommitted: stage === 'committed' || stage === 'finalized',
    sourceRemains: false,
    nextRun: 'never sees the file — it was deleted before the rows were durable',
    why:
      'Deleting first turns this window into permanent data loss: the source is gone ' +
      'and the rows never committed. There is nothing left to retry from.',
  };
}

/** The window is one stage wide, and shrinking it is the only lever available. */
export function duplicateWindowStages(): Stage[] {
  return STAGES.filter((s) => outcomeAt(s).verdict === 'duplicate-window');
}

/** Data-loss stages under the reversed ordering, for contrast. */
export function lossStagesIfFinalizedFirst(): Stage[] {
  return STAGES.filter(
    (s) => !outcomeIfFinalizedFirst(s).sourceRemains && !outcomeIfFinalizedFirst(s).rowsCommitted,
  );
}
