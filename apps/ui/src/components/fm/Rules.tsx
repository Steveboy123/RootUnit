import { ChevronDown } from 'lucide-react';
import { FM_NOTICE_POINTS } from '@headunit/shared';
import { HOW_IT_WORKS } from '../../lib/fm';

/** The notice, how it works and the aerial, kept out of the way until asked for. A native <details>: keyboard and screen readers already know it. */
export function Rules() {
  return (
    <details className="fm-rules">
      <summary>
        <span>How it works and the rules</span>
        <ChevronDown size={20} aria-hidden="true" />
      </summary>
      <div className="fm-rules-body">
        <h4>The rules you accept</h4>
        <ul>
          {FM_NOTICE_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <h4>How it works</h4>
        {HOW_IT_WORKS.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </details>
  );
}
