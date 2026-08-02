type AmbientDotBackgroundProps = {
  focus?: 'center' | 'form';
};

export function AmbientDotBackground({
  focus = 'center',
}: AmbientDotBackgroundProps) {
  return (
    <div
      className={`ambient-dot-background ambient-dot-background--${focus}`}
      aria-hidden="true"
    />
  );
}
