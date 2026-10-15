import { getNodeDimensions } from '../../../../runners/shared/workflow-geometry';
export type PortPosition = 'top' | 'right' | 'bottom' | 'left';
export type AttachmentKind = 'agent' | 'memory' | 'tool';
type PositionedNode = { nodeType?: string; x: number; y: number };
export const getPortCoordinates = (
  node: PositionedNode,
  port: PortPosition,
  offset: number = 0,
) => {
  const dimensions = getNodeDimensions(node);
  switch (port) {
    case 'top':
      return { x: node.x + dimensions.width / 2, y: node.y - offset };
    case 'right':
      return {
        x: node.x + dimensions.width + offset,
        y: node.y + dimensions.height / 2,
      };
    case 'bottom':
      return {
        x: node.x + dimensions.width / 2,
        y: node.y + dimensions.height + offset,
      };
    case 'left':
      return { x: node.x - offset, y: node.y + dimensions.height / 2 };
  }
};

export const getAttachmentPortCoordinates = (
  node: PositionedNode,
  attachmentKind: AttachmentKind,
  offset = 0,
) => {
  const dimensions = getNodeDimensions(node);
  const ratio =
    attachmentKind === 'agent'
      ? 0.18
      : attachmentKind === 'memory'
        ? 0.5
        : 0.82;
  return {
    x: node.x + dimensions.width * ratio,
    y: node.y + dimensions.height + offset,
  };
};

// Helper context to render curves
export const renderCurve = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sourcePort: PortPosition,
  targetPort: PortPosition,
  style: 'step' | 'bezier',
) => {
  if (style === 'step') {
    const offset = 32;
    const getOffsetPt = (x: number, y: number, port: PortPosition) => {
      switch (port) {
        case 'top':
          return { x, y: y - offset };
        case 'bottom':
          return { x, y: y + offset };
        case 'left':
          return { x: x - offset, y };
        case 'right':
          return { x: x + offset, y };
      }
    };

    const p0 = { x: x1, y: y1 };
    const p4 = { x: x2, y: y2 };
    const p1 = getOffsetPt(x1, y1, sourcePort);
    const p3 = getOffsetPt(x2, y2, targetPort);

    const isHorizontal = (port: PortPosition) =>
      port === 'left' || port === 'right';
    const isVertical = (port: PortPosition) =>
      port === 'top' || port === 'bottom';

    let points = [p0];

    if (isHorizontal(sourcePort) && isHorizontal(targetPort)) {
      if (sourcePort === targetPort) {
        const outerX =
          sourcePort === 'left' ? Math.min(p1.x, p3.x) : Math.max(p1.x, p3.x);
        points.push({ x: outerX, y: p1.y });
        points.push({ x: outerX, y: p3.y });
      } else {
        const midX = (p1.x + p3.x) / 2;
        points.push(p1);
        points.push({ x: midX, y: p1.y });
        points.push({ x: midX, y: p3.y });
        points.push(p3);
      }
    } else if (isVertical(sourcePort) && isVertical(targetPort)) {
      const midY = (p1.y + p3.y) / 2;
      points.push(p1);
      points.push({ x: p1.x, y: midY });
      points.push({ x: p3.x, y: midY });
      points.push(p3);
    } else if (isHorizontal(sourcePort) && isVertical(targetPort)) {
      // Just one corner to connect horizontal out to vertical in
      points.push(p1);
      points.push({ x: p4.x, y: p1.y });
    } else if (isVertical(sourcePort) && isHorizontal(targetPort)) {
      // Just one corner to connect vertical out to horizontal in
      points.push(p1);
      points.push({ x: p1.x, y: p4.y });
    }
    points.push(p4);

    // Clean up duplicate points
    points = points.filter((p, i, arr) => {
      if (i === 0) return true;
      const prev = arr[i - 1];
      return Math.abs(p.x - prev.x) > 1 || Math.abs(p.y - prev.y) > 1;
    });

    // Build path with rounded corners
    let path = `M ${points[0].x} ${points[0].y}`;
    const radius = 16;

    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];

      const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);

      const r = Math.min(radius, dPrev / 2, dNext / 2);

      if (r < 1) {
        path += ` L ${curr.x} ${curr.y}`;
        continue;
      }

      const startX = curr.x - (r * (curr.x - prev.x)) / dPrev;
      const startY = curr.y - (r * (curr.y - prev.y)) / dPrev;

      const endX = curr.x + (r * (next.x - curr.x)) / dNext;
      const endY = curr.y + (r * (next.y - curr.y)) / dNext;

      path += ` L ${startX} ${startY}`;
      path += ` Q ${curr.x} ${curr.y} ${endX} ${endY}`;
    }

    const last = points[points.length - 1];
    path += ` L ${last.x} ${last.y}`;

    return path;
  }

  const getControlPoint = (x: number, y: number, port: PortPosition) => {
    const offset = 80;
    switch (port) {
      case 'top':
        return { x, y: y - offset };
      case 'bottom':
        return { x, y: y + offset };
      case 'left':
        return { x: x - offset, y };
      case 'right':
        return { x: x + offset, y };
    }
  };

  const cp1 = getControlPoint(x1, y1, sourcePort);
  const cp2 = getControlPoint(x2, y2, targetPort);

  return `M ${x1} ${y1} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${x2} ${y2}`;
};
