module.exports = function checkBoxes() {
  return [
    document.querySelector('#block_new_accounts').checked,
    document.querySelector('#block_low_followers').checked,
    document.querySelector('#share_blocks').checked,
    document.querySelector('#follow_blocktogether').checked
  ];
}
