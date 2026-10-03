const ROLE_ID = '1551168459159896166';
function formatStaffList(staff) {
  const members = staff.map(member => `<@${member.id}>`);
  const list = members.length ? members.join('\n') : 'No verified staff members currently.';
  const noun = members.length === 1 ? 'member' : 'members';
  return `🐧 PikaStudio Staff\n\nThese are the currently verified PikaStudio staff members.\n\n${list}\n\n${members.length} verified staff ${noun}`;
}
module.exports = { ROLE_ID, formatStaffList };
