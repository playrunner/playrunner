import type { Integration } from '@playrunner/integration-sdk';
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
  nodeSelectorOrder: 30,
  showInputPanel: false,
  ConfigPanel: ScheduleConfigPanel,
};

export { ScheduleConfigPanel } from './ScheduleConfigPanel';
