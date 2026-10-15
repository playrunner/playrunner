import { createRoot } from 'react-dom/client';
import {
  WorkflowCanvas,
  type CanvasNode,
  type CanvasWorkflow,
} from './WorkflowCanvas';
import '../index.css';

const root = createRoot(document.getElementById('canvas')!);
let fitRevision = 0;
Object.assign(window, {
  renderWorkflowCanvas(
    workflow: CanvasWorkflow,
    fit: boolean,
    onSelect: (node: CanvasNode) => void,
  ) {
    if (fit) fitRevision++;
    root.render(
      <WorkflowCanvas
        workflow={workflow}
        fitRevision={fitRevision}
        onSelect={onSelect}
      />,
    );
  },
});
