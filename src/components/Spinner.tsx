export function Spinner({ sm }: { sm?: boolean }) {
  return <span className={`spinner${sm ? ' sm' : ''}`} aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="loading-wrap">
      <Spinner />
    </div>
  );
}
