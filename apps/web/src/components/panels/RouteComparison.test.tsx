import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteSource } from '@smart-er/core';
import { route } from '@/test/fixtures';
import { RouteComparison } from './RouteComparison';

describe('RouteComparison', () => {
  it('shows the selected route with its distance and ETA', () => {
    render(<RouteComparison route={route('RTE-1')} />);

    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(screen.getByText(/6\.0 km · 06:45/)).toBeInTheDocument();
    expect(screen.getByText('J1 → J2 → J3')).toBeInTheDocument();
  });

  it('makes "shorter but slower" explicit on a rejected alternative', () => {
    render(<RouteComparison route={route('RTE-1')} />);

    // The rejected option is 800 m shorter and 85 s slower.
    expect(screen.getByText('Alternative 1')).toBeInTheDocument();
    expect(screen.getByText(/\+85 s/)).toBeInTheDocument();
    expect(screen.getByText(/shorter but slower; response time is the objective/)).toBeInTheDocument();
  });

  it('flags a rejected alternative that contends for a junction', () => {
    render(<RouteComparison route={route('RTE-1')} />);
    expect(screen.getByText(/contends for J6/)).toBeInTheDocument();
  });

  it('renders the routing engine explanation verbatim', () => {
    const explanation = 'Selected fastest route via J1 → J2 → J3 because it saves 85 s against the shorter option.';
    render(<RouteComparison route={route('RTE-1', { explanation })} />);

    expect(screen.getByText('Why this route')).toBeInTheDocument();
    expect(screen.getByText(explanation)).toBeInTheDocument();
  });

  it('reports which provider supplied the geometry', () => {
    const { rerender } = render(<RouteComparison route={route('RTE-1')} />);
    expect(screen.getByText('SMART-ER network')).toBeInTheDocument();

    rerender(<RouteComparison route={route('RTE-1', { source: RouteSource.GOOGLE_ROUTES })} />);
    expect(screen.getByText('Google Routes')).toBeInTheDocument();

    rerender(<RouteComparison route={route('RTE-1', { source: RouteSource.GOOGLE_DIRECTIONS })} />);
    expect(screen.getByText('Google Directions')).toBeInTheDocument();
  });
});
