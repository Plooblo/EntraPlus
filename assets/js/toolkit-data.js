/* Everyday jobs EntraPlus does, for the homepage search: name, area, plan, a plain-English summary and roughly how
   many minutes it saves compared with doing it by hand. Keep in step with the app. */
window.TOOLKIT = [
 {
  "id": "search-users",
  "title": "Find a user",
  "area": "Users",
  "plan": "Free",
  "summary": "Search by name, username or email across the whole tenant.",
  "mins": 3
 },
 {
  "id": "new-starter",
  "title": "Create a new starter",
  "area": "Users",
  "plan": "Free",
  "summary": "Name, username, domain, job title and a temporary password in one form. The sign-in name is built for you so it can't be mistyped.",
  "mins": 12
 },
 {
  "id": "edit-details",
  "title": "Edit names, job title and department",
  "area": "Users",
  "plan": "Free",
  "summary": "Every field shows where it is saved, and changed fields are highlighted until you save.",
  "mins": 3
 },
 {
  "id": "change-upn",
  "title": "Change someone's sign-in name",
  "area": "Users",
  "plan": "Free",
  "summary": "Pick the new name and choose the domain from a list of your verified domains.",
  "mins": 3
 },
 {
  "id": "disable",
  "title": "Disable or enable sign-in",
  "area": "Users",
  "plan": "Free",
  "summary": "Block or allow sign-in, with the account's live status shown at the top of the screen.",
  "mins": 3
 },
 {
  "id": "reset-password",
  "title": "Reset a password",
  "area": "Users",
  "plan": "Free",
  "summary": "Generates a readable temporary password, with copy and must-change options.",
  "mins": 4
 },
 {
  "id": "revoke",
  "title": "Sign out everywhere",
  "area": "Users",
  "plan": "Free",
  "summary": "Ends every session on every device. Useful after a password reset or a lost phone.",
  "mins": 3
 },
 {
  "id": "delete-user",
  "title": "Delete a user",
  "area": "Users",
  "plan": "Free",
  "summary": "Soft-deletes the account. It can be restored for 30 days.",
  "mins": 3
 },
 {
  "id": "restore-user",
  "title": "Restore a deleted user",
  "area": "Users",
  "plan": "Free",
  "summary": "Lists deleted accounts from Entra (and AD with Pro) and brings one back.",
  "mins": 8
 },
 {
  "id": "licences",
  "title": "Assign or remove licences",
  "area": "Users",
  "plan": "Pro",
  "summary": "See how many of each licence are free, and assign one when you create a starter.",
  "mins": 5
 },
 {
  "id": "leaver",
  "title": "Leaver in one step",
  "area": "Users",
  "plan": "Pro",
  "summary": "Block sign-in, sign out everywhere, reset the password, remove groups and licences, and convert the mailbox to shared.",
  "mins": 25
 },
 {
  "id": "bulk",
  "title": "Bulk new starters from a spreadsheet",
  "area": "Users",
  "plan": "Pro",
  "summary": "Load a CSV of a whole intake, check the preview, then create every account with one licence choice.",
  "mins": 45
 },
 {
  "id": "export-users",
  "title": "Export all users to CSV",
  "area": "Users",
  "plan": "Pro",
  "summary": "A spreadsheet of every account with names, roles, department and status.",
  "mins": 15
 },
 {
  "id": "add-member",
  "title": "Add someone to a group",
  "area": "Groups",
  "plan": "Free",
  "summary": "Works for security and Microsoft 365 groups. Dynamic groups are explained, not silently refused.",
  "mins": 4
 },
 {
  "id": "remove-member",
  "title": "Remove members from a group",
  "area": "Groups",
  "plan": "Free",
  "summary": "Select one or many members and remove them together.",
  "mins": 4
 },
 {
  "id": "new-group",
  "title": "Create a security or Microsoft 365 group",
  "area": "Groups",
  "plan": "Free",
  "summary": "Plain-English group types, so you pick the right one first time.",
  "mins": 6
 },
 {
  "id": "delete-group",
  "title": "Delete a group",
  "area": "Groups",
  "plan": "Free",
  "summary": "Microsoft 365 and security groups can be restored for 30 days.",
  "mins": 4
 },
 {
  "id": "dl",
  "title": "Distribution lists",
  "area": "Groups",
  "plan": "Pro",
  "summary": "Create lists and change their members. Graph can't edit these, so EntraPlus uses Exchange Online for you.",
  "mins": 8
 },
 {
  "id": "export-members",
  "title": "Export group members",
  "area": "Groups",
  "plan": "Pro",
  "summary": "A CSV of everyone in a group, for audits and reports.",
  "mins": 15
 },
 {
  "id": "devices",
  "title": "See every managed device",
  "area": "Devices",
  "plan": "Free",
  "summary": "Filter by user, model, serial number, operating system or compliance.",
  "mins": 4
 },
 {
  "id": "sync",
  "title": "Sync a device now",
  "area": "Devices",
  "plan": "Free",
  "summary": "Ask a laptop or iPad to check in with Intune straight away.",
  "mins": 3
 },
 {
  "id": "restart",
  "title": "Restart a device",
  "area": "Devices",
  "plan": "Pro",
  "summary": "Restart remotely, for stuck updates or a frozen kiosk.",
  "mins": 3
 },
 {
  "id": "retire",
  "title": "Retire a device",
  "area": "Devices",
  "plan": "Pro",
  "summary": "Removes school apps and data and stops managing the device. Personal data stays.",
  "mins": 6
 },
 {
  "id": "wipe",
  "title": "Wipe a lost or stolen device",
  "area": "Devices",
  "plan": "Pro",
  "summary": "Factory-resets the device and erases everything on it.",
  "mins": 6
 },
 {
  "id": "bitlocker",
  "title": "Find a BitLocker recovery key",
  "area": "Devices",
  "plan": "Pro",
  "summary": "Pick the laptop, read out the key. No more hunting through the admin centre.",
  "mins": 5
 },
 {
  "id": "laps",
  "title": "Show the local admin password (LAPS)",
  "area": "Devices",
  "plan": "Pro",
  "summary": "The current Windows LAPS password for a device, with a copy button.",
  "mins": 5
 },
 {
  "id": "export-devices",
  "title": "Export devices to CSV",
  "area": "Devices",
  "plan": "Pro",
  "summary": "Your filtered device list as a spreadsheet: serials, users, compliance, last check-in.",
  "mins": 15
 },
 {
  "id": "ca-view",
  "title": "Read Conditional Access in plain English",
  "area": "Policies",
  "plan": "Free",
  "summary": "Each policy summarised: who it applies to, which apps, and what it does.",
  "mins": 10
 },
 {
  "id": "ca-template",
  "title": "Create a recommended policy",
  "area": "Policies",
  "plan": "Pro",
  "summary": "Require MFA for admins, block legacy authentication and more, from tested templates.",
  "mins": 25
 },
 {
  "id": "ca-state",
  "title": "Switch a policy on, off or to report-only",
  "area": "Policies",
  "plan": "Pro",
  "summary": "Move a policy from report-only to on once you've checked what it would have done.",
  "mins": 10
 },
 {
  "id": "compliance",
  "title": "View device compliance policies",
  "area": "Policies",
  "plan": "Free",
  "summary": "The rules your devices are measured against, in one list.",
  "mins": 10
 },
 {
  "id": "ad-edit",
  "title": "Edit accounts that sync from AD",
  "area": "Hybrid AD",
  "plan": "Pro",
  "summary": "EntraPlus spots synced accounts and saves the change to AD for you, where Entra would refuse it.",
  "mins": 5
 },
 {
  "id": "ad-unlock",
  "title": "Unlock an AD account",
  "area": "Hybrid AD",
  "plan": "Pro",
  "summary": "See whether someone is locked out, live, and unlock them in one click.",
  "mins": 4
 },
 {
  "id": "ad-expiry",
  "title": "Set an account expiry date",
  "area": "Hybrid AD",
  "plan": "Pro",
  "summary": "Pick a date, or use the end of the academic year in one click.",
  "mins": 5
 },
 {
  "id": "ad-create",
  "title": "Create a new AD account",
  "area": "Hybrid AD",
  "plan": "Pro",
  "summary": "Choose the OU from a list. EntraPlus remembers the one you used last.",
  "mins": 5
 },
 {
  "id": "ad-restore",
  "title": "Restore from the AD Recycle Bin",
  "area": "Hybrid AD",
  "plan": "Pro",
  "summary": "Deleted AD accounts appear alongside Entra ones on the Restore screen.",
  "mins": 8
 },
 {
  "id": "aliases",
  "title": "Edit email aliases",
  "area": "Exchange",
  "plan": "Pro",
  "summary": "Add, remove or make an address primary. X500 and SIP entries are kept untouched.",
  "mins": 6
 },
 {
  "id": "shared",
  "title": "Convert a mailbox to shared",
  "area": "Exchange",
  "plan": "Pro",
  "summary": "Keep a leaver's mailbox for colleagues, without paying for a licence.",
  "mins": 6
 }
];
