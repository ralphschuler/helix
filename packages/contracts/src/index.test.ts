import { describe, expect, it } from 'vitest';

import { workspaceName } from './index.js';

describe('@helix/contracts validation smoke', () => {
  it('runs workspace tests through Vitest', () => {
    expect(workspaceName).toBe('@helix/contracts');
  });
});
