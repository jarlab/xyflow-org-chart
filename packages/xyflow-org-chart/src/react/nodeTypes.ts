import { OrgChartEdge } from './OrgChartEdge';
import { OrgChartNode, OrgChartPagingNode } from './OrgChartNode';

/** Default node types: { orgChart: OrgChartNode, orgChartPaging: OrgChartPagingNode }. Spread into your own nodeTypes (defined outside components). */
export const orgChartNodeTypes = { orgChart: OrgChartNode, orgChartPaging: OrgChartPagingNode } as const;

/** Default edge types: { orgChart: OrgChartEdge }. */
export const orgChartEdgeTypes = { orgChart: OrgChartEdge } as const;
