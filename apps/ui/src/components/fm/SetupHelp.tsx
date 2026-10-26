import { Wrench } from 'lucide-react';
import { FM_DOCS, type FmHelp } from '../../lib/fm';
import { Panel } from '../ui';

/** The next step, in words, with the exact commands. Shown only when something needs doing. */
export function SetupHelp({ help }: { help: FmHelp }) {
  return (
    <Panel title="What to do next" icon={Wrench} className="fm-help" tone={help.kind === 'error' ? 'danger' : 'warn'}>
      <h4 className="fm-help-title">{help.title}</h4>
      <p className="fm-lead">{help.intro}</p>
      <ol className="fm-steps-list">
        {help.steps.map((s, i) => (
          <li key={i}>
            <span>{s.text}</span>
            {s.command && <code className="fm-cmd">{s.command}</code>}
          </li>
        ))}
      </ol>
      <p className="fm-note">
        The full guide is in <code>{FM_DOCS}</code>.
      </p>
    </Panel>
  );
}
