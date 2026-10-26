import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { WidgetInstance } from '@headunit/shared';

export interface WidgetProps {
  instance: WidgetInstance;
}

export interface ConfigField {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  default: string;
}

export interface WidgetDef {
  type: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Group in the Add widget sheet. */
  group: 'Driving' | 'Music' | 'Car' | 'Everyday';
  size: { w: number; h: number };
  min: { w: number; h: number };
  config?: ConfigField[];
  Component: ComponentType<WidgetProps>;
}
