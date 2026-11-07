-- Read-only installed two-step removal safeguards. Never ends/deletes any item.
begin;
select has_function_privilege('anon','public.swish_inventory_delete_issue(uuid,uuid)','execute') as anon_eligibility_access,
 has_table_privilege('authenticated','public.swish_listing_end_receipts','insert') as client_receipt_insert,
 has_table_privilege('authenticated','public.swish_listing_end_receipts','update') as client_receipt_update,
 has_table_privilege('authenticated','public.swish_listing_end_receipts','delete') as client_receipt_delete;
select tgname,pg_get_triggerdef(oid) as definition from pg_trigger
 where tgrelid in('public.items'::regclass,'public.listings'::regclass) and not tgisinternal
 and tgname in('guard_user_item_removal','guard_user_listing_removal','lock_listing_inventory_removal');
select count(*) as canonical_items from public.items;
select count(*) as canonical_rows from public.swish_inventory_canonical_rows;
rollback;
