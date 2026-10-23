-- The legacy import wrote each colleague's sign-in address into `employees.display_name`: the
-- invitation path creates the retained employee row with no invented name, and every imported
-- account was created that way. The records' attribution itself is correct - `properties.created_by`
-- and `properties.updated_by` are `uuid` references to `employees.id`, and every one of them
-- resolves - but the name each reference resolves to is an address, which the application never
-- renders, or the source sheet's own `Admintrator` label.
--
-- This migration replaces that placeholder with the name the source workbook recorded for the
-- account. The evidence is the archived import rows (`staging-rows-archive.ndjson.gz`, sheet
-- `Thông tin dự án`, 20,148 staged rows): each row carries its `Email Người Tạo` and the
-- `Tên người tạo` cell beside it. Per creator address, the value below is the **modal** value of
-- that cell and the counts behind it are stated so the choice can be re-checked against the
-- archive without reading it. The name is used verbatim: trimmed, accents and spelling preserved,
-- nothing translated and nothing invented.
--
--   19 addresses create records. 15 of them carry a person's name in the sheet and are named here.
--   Four carry the secretarial label `Thư ký` and one the administrator label `Admintrator`: no
--   human name is invented for those, and the label their own source states is what they keep.
--   Three of the four `Thư ký` addresses are recorded as sales employees here (the secretary
--   worked those rows through a shared account), so the label states how the account was used
--   rather than a role; they are listed for the captain to name if he wants to.
--
-- The sheet has no editor-name column, so the 14 accounts that only ever modified records - and the
-- 926 archived rows whose creator address is blank - cannot be resolved this way. They are left
-- untouched: an address is not a name, the application states no name for them, and no owner is
-- invented. An employee whose display name is already something other than their own sign-in
-- address keeps it, so a name someone has already supplied is never overwritten.
begin;

update public.employees as e
set display_name = claim.display_name
from (
  values
    -- creator address                                display name  rows  of rows
    ('tansang.bt@gmail.com', 'Tấn Sang', 3843, 5473),
    ('hong.nhapho@gmail.com', 'Hồng', 1182, 1779),
    ('manager.sgnewhouse@gmail.com', 'Admintrator', 7328, 9242),
    ('thukysaigonnewhouse@gmail.com', 'Thư ký', 906, 1014),
    ('phamgianewhome@gmail.com', 'Tiến', 219, 346),
    ('hoangquysaigonnewhouse@gmail.com', 'Hoàng Quý', 200, 273),
    ('thanhtungnguyen111994@gmail.com', 'Thanh Tùng', 121, 209),
    ('han.saigonnewhouse@gmail.com', 'Phạm Hân', 119, 196),
    ('hoangnguyenbds1990@gmail.com', 'Sĩ Nguyên', 83, 130),
    ('thanhthuannguyen679@gmail.com', 'Thư ký', 71, 117),
    ('baoxuyenddr@gmail.com', 'Bảo Xuyến', 50, 94),
    ('nghiasgnh@gmail.com', 'Nghĩa', 51, 86),
    ('datchangsgnh@gmail.com', 'Tín Đạt', 55, 70),
    ('tranphuocdat1993@gmail.com', 'Đạt', 47, 62),
    ('hensaigonnewhouse@gmail.com', 'Văn Hên', 29, 47),
    ('nguyenngan92sgnh@gmail.com', 'Thùy Ngân', 21, 46),
    ('nhattansgnh@gmail.com', 'Thư ký', 8, 16),
    ('hungsgnh@gmail.com', 'Minh Hùng', 11, 13),
    ('khangsgnew@gmail.com', 'Thư ký', 5, 9)
) as claim(email, display_name, rows_named, rows_with_creator)
-- The account the archive names, matched on its own recorded address. `employees.email` is
-- unique and stored normalized, and the comparison normalizes anyway so the join cannot miss on
-- case or padding.
where lower(btrim(e.email)) = claim.email
  -- Only the import's placeholder is replaced: the display name is this account's own sign-in
  -- address and nothing else. An account someone has already named keeps that name.
  and lower(btrim(e.display_name)) = lower(btrim(e.email))
  and e.display_name <> claim.display_name;

commit;
