import { createNodeTypeCatalog } from './nodeTypes';
import { INTEGRATIONS } from './registry';

const catalog = createNodeTypeCatalog(INTEGRATIONS);

export const ALL_NODE_TYPES = catalog.all;
export const NODE_TYPES = catalog.selectable;
