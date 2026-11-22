import { expect,it } from 'vitest';
import { isBlockedAirdropContent } from './airdrop-policy';
import fixtures from './fixtures/airdrop-policy.json';
it.each(fixtures)('$title: blocked=$blocked',row=>expect(isBlockedAirdropContent(row)).toBe(row.blocked));
