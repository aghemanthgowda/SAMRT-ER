import { describe, expect, it } from 'vitest';
import { testJunctions } from '../testing/fixtures.js';
import type { Junction, JunctionAllocation, SignalCommand } from '../types/domain.js';
import { JunctionState, SignalAspect } from '../types/enums.js';
import { isoAdd, isoNow } from '../util/time.js';
import { MIN_GREEN_SECONDS, validateBatch, validateSignalCommand, type SafetyContext } from './safetyValidator.js';

const junction: Junction = testJunctions().find((entry) => entry.id === 'J2')!;

function command(overrides: Partial<SignalCommand> = {}): SignalCommand {
  return {
    id: 'CMD-1',
    junctionId: 'J2',
    deviceId: 'HW-J2',
    approachId: 'J2-N',
    aspect: SignalAspect.GREEN,
    holdSeconds: 12,
    corridorId: 'COR-1',
    vehicleId: 'AMB-01',
    issuedAt: isoNow(),
    safetyApproved: false,
    safetyNotes: [],
    ...overrides,
  };
}

function context(overrides: Partial<SafetyContext> = {}): SafetyContext {
  return {
    junction,
    activeAllocations: [],
    currentAspects: new Map(junction.approaches.map((approach) => [approach.id, SignalAspect.RED])),
    lastChangeAt: new Map(junction.approaches.map((approach) => [approach.id, isoAdd(isoNow(), -60)])),
    deviceOffline: false,
    ...overrides,
  };
}

function allocation(overrides: Partial<JunctionAllocation> = {}): JunctionAllocation {
  const now = isoNow();
  return {
    id: 'ALC-1',
    junctionId: 'J2',
    corridorId: 'COR-2',
    vehicleId: 'FIRE-01',
    approachId: 'J2-E',
    priority: 120,
    startsAt: isoAdd(now, -2),
    endsAt: isoAdd(now, 20),
    state: JunctionState.GREEN,
    timeSlotted: false,
    ...overrides,
  };
}

describe('safety validator', () => {
  it('approves a green on a clear junction', () => {
    const verdict = validateSignalCommand(command(), context());
    expect(verdict.approved).toBe(true);
  });

  it('rejects a green while a conflicting approach is still green', () => {
    const verdict = validateSignalCommand(
      command(),
      context({
        currentAspects: new Map([
          ['J2-N', SignalAspect.RED],
          ['J2-E', SignalAspect.GREEN],
          ['J2-S', SignalAspect.RED],
          ['J2-W', SignalAspect.RED],
        ]),
        lastChangeAt: new Map([['J2-E', isoNow()]]),
      }),
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.notes[0]).toContain('J2-E');
    expect(verdict.requiredClearanceSeconds).toBeGreaterThan(0);
  });

  it('approves the same green once clearance has elapsed', () => {
    const verdict = validateSignalCommand(
      command(),
      context({
        currentAspects: new Map([['J2-E', SignalAspect.AMBER]]),
        lastChangeAt: new Map([['J2-E', isoAdd(isoNow(), -30)]]),
      }),
    );
    expect(verdict.approved).toBe(true);
  });

  it('rejects a green for an approach that does not exist', () => {
    const verdict = validateSignalCommand(command({ approachId: 'J2-NE' }), context());
    expect(verdict.approved).toBe(false);
    expect(verdict.notes[0]).toContain('not registered');
  });

  it('rejects a green when the junction controller is offline', () => {
    const verdict = validateSignalCommand(command(), context({ deviceOffline: true }));
    expect(verdict.approved).toBe(false);
    expect(verdict.notes[0]).toContain('offline');
  });

  it('never lets two emergency vehicles hold the same junction at once', () => {
    const verdict = validateSignalCommand(
      command({ vehicleId: 'AMB-01', approachId: 'J2-N' }),
      context({ activeAllocations: [allocation({ vehicleId: 'FIRE-01', approachId: 'J2-E' })] }),
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.notes[0]).toContain('already reserved for FIRE-01');
  });

  it('allows the same vehicle to re-assert its own green', () => {
    const verdict = validateSignalCommand(
      command({ vehicleId: 'AMB-01', approachId: 'J2-N' }),
      context({ activeAllocations: [allocation({ vehicleId: 'AMB-01', approachId: 'J2-N' })] }),
    );
    expect(verdict.approved).toBe(true);
  });

  it('enforces a minimum green before the aspect may be taken away', () => {
    const verdict = validateSignalCommand(
      command({ aspect: SignalAspect.RED }),
      context({
        currentAspects: new Map([['J2-N', SignalAspect.GREEN]]),
        lastChangeAt: new Map([['J2-N', isoNow()]]),
      }),
    );
    expect(verdict.approved).toBe(false);
    expect(verdict.notes[0]).toContain(`Minimum green is ${MIN_GREEN_SECONDS}`);
  });

  it('requires amber between green and red once minimum green has passed', () => {
    const verdict = validateSignalCommand(
      command({ aspect: SignalAspect.RED }),
      context({
        currentAspects: new Map([['J2-N', SignalAspect.GREEN]]),
        lastChangeAt: new Map([['J2-N', isoAdd(isoNow(), -20)]]),
      }),
    );
    expect(verdict.approved).toBe(true);
    expect(verdict.requiredClearanceSeconds).toBeGreaterThan(0);
  });

  it('rejects an out-of-range hold', () => {
    expect(validateSignalCommand(command({ holdSeconds: 400 }), context()).approved).toBe(false);
    expect(validateSignalCommand(command({ holdSeconds: -1 }), context()).approved).toBe(false);
  });

  it('rejects a command addressed to a different junction', () => {
    const verdict = validateSignalCommand(command({ junctionId: 'J5' }), context());
    expect(verdict.approved).toBe(false);
  });

  it('validateBatch separates approved from rejected and stamps the notes', () => {
    const good = command({ id: 'CMD-OK' });
    const bad = command({ id: 'CMD-BAD', approachId: 'J2-NOPE' });

    const result = validateBatch([good, bad], () => context());

    expect(result.approved.map((entry) => entry.id)).toEqual(['CMD-OK']);
    expect(result.rejected.map((entry) => entry.command.id)).toEqual(['CMD-BAD']);
    expect(result.approved[0]!.safetyApproved).toBe(true);
    expect(result.approved[0]!.safetyNotes.length).toBeGreaterThan(0);
    expect(result.rejected[0]!.command.safetyApproved).toBe(false);
  });
});
