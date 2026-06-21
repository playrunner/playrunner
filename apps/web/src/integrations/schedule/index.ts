import type { Integration } from '../types';
import { ScheduleConfigPanel } from './ScheduleConfigPanel';
import { AlarmClock } from 'lucide-react';

export const scheduleIntegration: Integration = {
  id: 'schedule',
  name: 'Schedule',
  category: 'Triggers',
  description: 'Schedule your workflow to run on a recurring basis',
  icon: AlarmClock,
  nodeType: 'trigger',
  color: 'text-white',
  requiresAuth: false,
  ConfigPanel: ScheduleConfigPanel,
};
