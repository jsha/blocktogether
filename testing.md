Manual tests to run before a release:

## Initial setup

- With @twestact3, visit https://twitter.com/settings/applications and revoke
  Block Together if present. This ensures that @twestact3 is not enrolled in the
  production instance of Block Together.

## Blocking new users.

- Log on with @twestact3.
- Visit /settings, ensure block_new_accounts is disabled.
- (other window) Create or reuse a <7 day old account, e.g. @new.
- (other window) Use @new to mention @twestact3.
- Visit /actions, verify no block of @new.
- Visit /my-blocks, verify no block of @new.


- With @twestact3, enable block_new_accounts. Verify "Saved" appears.
- Reload /settings and verify block_new_accounts still checked.
- (other window) Use @new to mention @twestact3 again.
- Visit /actions, verify that a block of @new shows up.
- Visit /my-blocks, verify that a block of @new shows up, and that screen name
   is listed.

- On Twitter, have @twestact3 unblock @new.
- Visit /my-unblocks and verify that an unblock of @new shows up.
- (other window) Use @new to mention @twestact3 a third time.
- Visit /actions, verify that there is a block of @new listed as 'pending' or
  'cancelled-unblocked'.
- Reload /actions until the block of @new becomes listed as
  'cancelled-unblocked'. If > 30 seconds, fail. Ensure actions.js is running.
- Visit /my-blocks, verify that @new is not listed as blocked.
- Visit https://mobile.twitter.com/@new/actions, verify that it says "Block
   @new" or "Hide @new". It should NOT say "Unblock @new" or "Unhide @new".

- With @twestact3, disable block_new_accounts. Verify "Saved" appears.
- Reload /settings and verify block_new_accounts is still unchecked.
- Create another new account, @new2. Alternately: Purge @twestact3's Unblocks
     (DELETE FROM UnblockedUsers;) and reuse @new.
- Use @new2 to mention @twestact3.
- Visit /actions, verify there is not an additional block of @new.
- Visit /my-blocks, verify that @new is not listed as blocked.

## Sharing blocks

- Log on with @blocksAlot.
- Visit /settings, ensure share blocks is disabled.
- Enable share blocks. Verify page reloads, link to /show-blocks/XYZ appears.
- Click link to /show-blocks/XYZ. Verify it says "User @blocksAlot is blocking ..."
- Verify @twestact3 is on the list.
- Verify @twestact5 is on the list.
- Verify @twestact6 is on the list.
- Verify @twestact8 is on the list.
- Visit /settings, right-click -> Copy link location on /show-blocks/XYZ.
- Log Off from Block Together.
- Log Off from Twitter.
- Log On to Twitter with @twestact3.
- On Twitter, have @twestact3 follow @twestact5.
- On Twitter, have @twestact3 block @twestact6.

- Paste link in URL bar.
- Verify list of blocks appears.
- Verify no username shows up in header.
- Verify "Log On" shows up in header.
- Click "Block all". Verify popup says "Please log on to block people."
- Click "Log On" link in header.
- If prompted, authorize Block Together app for @twestact3.
- Verify redirected to /settings. TODO: Fix this:
    https://github.com/jsha/blocktogether/issues/26
- Paste link in URL bar.
- Verify list of blocks appears.
- Verify username shows up in header.
- Verify "Log Off" shows up in header.
- Click "Block all". Verify line appears on page saying "...will
   now block N users using your account..."
- Visit /actions. Verify a list of blocks appears.
- Reload /actions until none are listed as pending anymore.
- Verify the action for @twestact3 is 'cancelled-self'.
- Verify the action for @twestact5 is 'cancelled-following'.
- Verify the action for @twestact6 is 'cancelled-duplicate'.
- Verify the action for @twestact8 is 'done'.

- TODO: Find a good way to test cancelled-suspended.

## Revoking the app

- Log on with @twestact3
- Enable 'block new accounts'.
- Visit https://twitter.com/settings/applications, and revoke Block Together.
- Verify logs indicate deletion of @twestact3.
- Verify MySQL BtUsers table no longer contains @twestact3.
- Reload /settings, verify redirected to /.
