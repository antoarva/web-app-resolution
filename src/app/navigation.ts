/** Sidebar sections. Order here is the order shown. */

import type { ViewId } from '@/store/ui-store';

export interface NavItem {
  id: ViewId;
  label: string;
  /** lucide-react icon name, resolved in the sidebar. */
  icon: string;
  group: 'Model' | 'Analysis' | 'Reference';
  description: string;
  shortcut?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Overview', icon: 'LayoutDashboard', group: 'Model',
    description: 'Model summary, templates and project files', shortcut: '1' },
  { id: 'geometry', label: 'Geometry', icon: 'Box', group: 'Model',
    description: '3D view of zones, surfaces and shading', shortcut: '2' },
  { id: 'editor', label: 'IDF Editor', icon: 'FileCode', group: 'Model',
    description: 'Edit the input file as text', shortcut: '3' },
  { id: 'explorer', label: 'Objects', icon: 'ListTree', group: 'Model',
    description: 'Browse and edit objects by class', shortcut: '4' },
  { id: 'constructions', label: 'Constructions', icon: 'Layers', group: 'Model',
    description: 'Materials, assemblies and U-values', shortcut: '5' },
  { id: 'schedules', label: 'Schedules', icon: 'CalendarClock', group: 'Model',
    description: 'Operating profiles through the year', shortcut: '6' },
  { id: 'hvac', label: 'HVAC', icon: 'Workflow', group: 'Model',
    description: 'System schematic as a node graph', shortcut: '7' },

  { id: 'weather', label: 'Weather', icon: 'CloudSun', group: 'Analysis',
    description: 'Site climate and design conditions', shortcut: '8' },
  { id: 'simulation', label: 'Run', icon: 'Play', group: 'Analysis',
    description: 'Run the WebAssembly engine', shortcut: '9' },
  { id: 'results', label: 'Results', icon: 'BarChart3', group: 'Analysis',
    description: 'Loads, temperatures and energy use', shortcut: '0' },

  { id: 'docs', label: 'Documentation', icon: 'BookOpen', group: 'Reference',
    description: 'How the model and engine work' },
];

export const NAV_GROUPS: NavItem['group'][] = ['Model', 'Analysis', 'Reference'];

export function navItem(view: ViewId): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.id === view);
}
