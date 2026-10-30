import { useHeadUnit } from '../store';

export function Toast() {
  const message = useHeadUnit((s) => s.toast);
  if (!message) return null;
  return (
    <div className="toast" role="status" key={message}>
      {message}
    </div>
  );
}
