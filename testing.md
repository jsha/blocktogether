Manual tests to run before a release:

## Initial setup

- With @twestact3, visit https://twitter.com/settings/applications and revoke
  Block Together if present. This ensures that @twestact3 is not enrolled in the
  production instance of Block Together.

## Sign up and log on

- Sign up for Block Together using @twestact3 and the default settings. Visit
  settings page and ensure those settings are there.
- Enable block_new_accounts.
- Default settings should include 'follow @blocktogether' = true.
- Visit https://mobile.twitter.com/twestact3 and ensure @twestact3 follows
  @blocktogether or the configured userToFollow, and vice versa.
- Log Off from Block Together.
- From the home page, Log On to Block together.
- Visit settings page and ensure settings are: block_new_accounts=true,
  block_low_followers=false, follow_blocktogether=true, share_blocks=false.
- Log Off from Block Together.
- From the home page, select share_blocks=true, leave "block young
  accounts"=false, and click 'Sign Up'.
- Visit /settings.
- Verify share_blocks is enabled, and there is a valid
  show-blocks URL.
- Verify "block young accounts" = false.

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
- Visit /actions and verify that an unblock of @new shows up.
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
     (delete from Actions where source_uid = 596973693 and type = 'unblock';)
     and reuse @new.
- Use @new2 to mention @twestact3.
- Visit /actions, verify there is not an additional block of @new.
- Visit /my-blocks, verify that @new is not listed as blocked.

## Blocking low follower users

- Log on with @twestact3, enable block_low_followers.
- Ensure @twestact6 has < 15 followers.
- Using @twestact6, @-mention @twestact3.
- Verify that @twestact3 blocks @twestact6.

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
- Verify MySQL BtUsers table lists @twestact3 with deactivatedAt=current date.
- Reload /settings, verify redirected to /.
