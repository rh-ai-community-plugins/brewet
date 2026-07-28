import { render } from '@testing-library/react';
import BrewetIcon from '../BrewetNavIcon';

describe('BrewetNavIcon Component', () => {
  it('should render the SVG icon', () => {
    const { container } = render(<BrewetIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should use PatternFly SVG conventions', () => {
    const { container } = render(<BrewetIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '1em');
    expect(svg).toHaveAttribute('height', '1em');
    expect(svg).toHaveAttribute('viewBox', '14 57 228 148');
    expect(svg).toHaveClass('pf-v6-svg');
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('should render the wheelbarrow tub', () => {
    const { container } = render(<BrewetIcon />);
    const paths = container.querySelectorAll('path');
    const tub = Array.from(paths).find((p) => p.getAttribute('fill') === '#E8382C');
    expect(tub).toBeInTheDocument();
  });

  it('should render the wheel', () => {
    const { container } = render(<BrewetIcon />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(3);
  });
});
