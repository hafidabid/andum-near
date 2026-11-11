/** Reason code -> readable copy (ANDUM-PLAN 8.3). */
export function reasonCopy(code: string | null, ctx: { unlockDate?: string; approvers?: string[]; approvals?: string[]; threshold?: number } = {}): string {
  const approvers = ctx.approvers ?? []; const approvals = ctx.approvals ?? []; const th = ctx.threshold ?? 1;
  switch (code) {
    case 'TIME_NOT_REACHED': return `Not yet: this part opens on ${ctx.unlockDate ?? 'a later date'}.`;
    case 'APPROVAL_MISSING': {
      if (approvers.length <= 1) return `${approvers[0] ?? 'The approver'} still has to approve this part.`;
      const more = Math.max(0, th - approvals.length);
      return `${more} more approval${more === 1 ? '' : 's'} needed.`;
    }
    case 'PACKAGE_NOT_ACTIVE': return 'Accept the package first.';
    case 'TRANSFER_PENDING': return 'Already on its way.';
    case 'ALREADY_TAKEN': return 'Already in your account.';
    case 'NOT_PASS_OWNER': return 'This package belongs to another account.';
    default: return 'Something went wrong. Please try again.';
  }
}
