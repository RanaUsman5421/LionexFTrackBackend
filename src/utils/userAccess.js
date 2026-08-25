const normalizeApprovalStatus = (user) => user?.approvalStatus || 'approved';
const normalizeAccountStatus = (user) => user?.accountStatus || 'active';

const userAccessState = (user) => ({
  approvalStatus: normalizeApprovalStatus(user),
  accountStatus: normalizeAccountStatus(user),
});

const canUserAccessApp = (user) => {
  const { approvalStatus, accountStatus } = userAccessState(user);
  return approvalStatus === 'approved' && accountStatus === 'active';
};

module.exports = {
  normalizeApprovalStatus,
  normalizeAccountStatus,
  userAccessState,
  canUserAccessApp,
};
