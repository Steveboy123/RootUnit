import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Activity,
  Box,
  Brush,
  Ghost,
  HardDriveDownload,
  Image as ImageIcon,
  MonitorPlay,
  Music,
  Navigation,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Type,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { BootStudioSection } from './BootStudio';
import { ConnectivitySettings } from './Connectivity';
import { LooksSection } from './Looks';
import { MascotSection } from './Mascot';
import { BackgroundSection, BeatSection, ColoursSection, MotionSection, StyleSection, TypeSection } from './Studio';
import { DisplaySection, GeneralSection, MaintenanceSection, MusicServicesSection, NavigationSection } from './System';

interface SectionDef {
  id: string;
  label: string;
  icon: LucideIcon;
  Component: ComponentType;
}

/** The categories down the left, in two groups: how it looks, and the head unit itself. */
const GROUPS: ReadonlyArray<{ label: string; sections: readonly SectionDef[] }> = [
  {
    label: 'Look and feel',
    sections: [
      { id: 'looks', label: 'Looks & layouts', icon: Sparkles, Component: LooksSection },
      { id: 'colours', label: 'Colours', icon: Palette, Component: ColoursSection },
      { id: 'style', label: 'Cards & depth', icon: Box, Component: StyleSection },
      { id: 'background', label: 'Background', icon: ImageIcon, Component: BackgroundSection },
      { id: 'motion', label: '3D effects', icon: Brush, Component: MotionSection },
      { id: 'type', label: 'Type & gauges', icon: Type, Component: TypeSection },
      { id: 'beat', label: 'Music reactive', icon: Activity, Component: BeatSection },
      { id: 'mascot', label: 'Mascot', icon: Ghost, Component: MascotSection },
      { id: 'boot', label: 'Boot screen', icon: MonitorPlay, Component: BootStudioSection },
    ],
  },
  {
    label: 'Head unit',
    sections: [
      { id: 'nav', label: 'Navigation', icon: Navigation, Component: NavigationSection },
      { id: 'music', label: 'Music services', icon: Music, Component: MusicServicesSection },
      { id: 'connect', label: 'Wi-Fi & Bluetooth', icon: Wifi, Component: ConnectivitySettings },
      { id: 'display', label: 'Display & sound', icon: Sun, Component: DisplaySection },
      { id: 'general', label: 'General', icon: SlidersHorizontal, Component: GeneralSection },
      { id: 'system', label: 'Backup & update', icon: HardDriveDownload, Component: MaintenanceSection },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.sections);

/** The section last open, kept for this visit so coming back to Settings lands where you were. */
let lastSection = 'looks';

/** Settings: categories on the left, the chosen one on the right. Every change is saved at once and shows straight away. */
export function SettingsPage() {
  const [id, setId] = useState(lastSection);
  const body = useRef<HTMLDivElement>(null);
  const section = ALL.find((s) => s.id === id) ?? ALL[0]!;
  useEffect(() => {
    lastSection = section.id;
    body.current?.scrollTo({ top: 0 });
  }, [section.id]);
  const Section = section.Component;
  return (
    <div className="page fixed settings" data-no-swipe>
      <nav className="card set-nav" aria-label="Settings">
        {GROUPS.map((g) => (
          <div key={g.label} className="set-nav-group">
            <span className="eyebrow">{g.label}</span>
            {g.sections.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" className="set-nav-btn" data-active={s.id === section.id} aria-current={s.id === section.id ? 'page' : undefined} onClick={() => setId(s.id)}>
                  <Icon />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="set-body" ref={body}>
        <div className="set-content" key={section.id}>
          <ErrorBoundary fallback={<div className="card set-section">This part of Settings could not be shown.</div>}>
            <Section />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
