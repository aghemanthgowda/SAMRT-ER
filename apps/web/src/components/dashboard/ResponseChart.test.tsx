import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ResponseSample } from '@smart-er/core';
import { ResponseChart } from './ResponseChart';

function sample(date: string, improvementPercent: number, completedRuns: number): ResponseSample {
  return { date, improvementPercent, completedRuns, averageSecondsSaved: completedRuns > 0 ? 90 : 0 };
}

/**
 * The improvement figure is the one someone quotes to justify the system, so
 * these tests are about what the chart is entitled to claim: a day with no
 * runs is a gap, and a window with no runs at all is not a 0 % result.
 */
describe('ResponseChart', () => {
  it('says there is no data rather than drawing a flat zero line', () => {
    const week = ['2026-08-21', '2026-08-22', '2026-08-23'].map((date) => sample(date, 0, 0));

    render(<ResponseChart samples={week} loading={false} />);

    expect(screen.getByText(/no completed runs yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('draws the chart once at least one run has completed', () => {
    const week = [sample('2026-08-21', 0, 0), sample('2026-08-22', 30, 4), sample('2026-08-23', 26, 2)];

    render(<ResponseChart samples={week} loading={false} />);

    expect(screen.queryByText(/no completed runs yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
    // Mean over days that ran: (30 + 26) / 2 = 28. Days with no runs are
    // excluded, so an idle day cannot drag the headline figure down.
    expect(screen.getByText('28%')).toBeInTheDocument();
    expect(screen.getByText(/6 runs/)).toBeInTheDocument();
  });

  it('does not say "1 runs"', () => {
    render(<ResponseChart samples={[sample('2026-08-23', 37, 1)]} loading={false} />);

    expect(screen.getByText(/1 run$/)).toBeInTheDocument();
  });

  it('marks a day with no runs as a gap, not as zero improvement', () => {
    const week = [sample('2026-08-21', 30, 4), sample('2026-08-22', 0, 0), sample('2026-08-23', 26, 2)];

    const { container } = render(<ResponseChart samples={week} loading={false} />);
    const tooltips = [...container.querySelectorAll('title')].map((node) => node.textContent);

    expect(tooltips).toContain('2026-08-22: no completed runs');
    expect(tooltips).toContain('2026-08-21: 30% over 4 run(s)');

    // The line joins only the days that ran, so the gap is a break in the
    // series rather than a plunge to the axis and back.
    const line = container.querySelector('polyline');
    expect(line?.getAttribute('points')?.split(' ')).toHaveLength(2);
  });
});
