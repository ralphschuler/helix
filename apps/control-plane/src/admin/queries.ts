import { queryOptions } from '@tanstack/react-query';

export interface AdminOverview {
  readonly heading: 'Helix Admin';
  readonly routeStatus: 'Protected-ready admin route';
  readonly workspace: '@helix/control-plane';
}

export const adminOverviewQueryOptions = queryOptions({
  queryKey: ['admin', 'overview'] as const,
  queryFn: async (): Promise<AdminOverview> => ({
    heading: 'Helix Admin',
    routeStatus: 'Protected-ready admin route',
    workspace: '@helix/control-plane',
  }),
});
