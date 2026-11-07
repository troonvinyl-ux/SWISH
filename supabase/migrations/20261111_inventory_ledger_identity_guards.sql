-- Guard future duplicate eBay order/sale line identities. Existing duplicate
-- ledgers are preserved for review; distinct legitimate item lines remain allowed.
begin;
create or replace function public.swish_guard_ledger_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_external text;v_market text;
begin
 v_market:=case when lower(btrim(new.marketplace_id)) in ('ebay','ebay_gb') then 'ebay' else lower(btrim(new.marketplace_id)) end;
 if v_market<>'ebay' then return new; end if;
 if tg_table_name='orders' then
  v_external:=nullif(btrim(new.external_order_id),'');
  if v_external is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('order:'||new.tenant_id::text||':'||v_external||':'||coalesce(new.item_id::text,'unlinked'),0));
  if exists(select 1 from public.orders o where o.id<>new.id and o.tenant_id=new.tenant_id and lower(btrim(o.marketplace_id)) in ('ebay','ebay_gb') and btrim(o.external_order_id)=v_external and o.item_id is not distinct from new.item_id) then
   raise exception 'Order line already recorded; refresh existing canonical order' using errcode='23505';
  end if;
 else
  v_external:=coalesce(nullif(btrim(new.external_transaction_id),''),nullif(btrim(new.external_order_id),''));
  if v_external is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('sale:'||new.tenant_id::text||':'||v_external||':'||new.item_id::text,0));
  if exists(select 1 from public.sales s where s.id<>new.id and s.tenant_id=new.tenant_id and s.item_id=new.item_id and lower(btrim(s.marketplace_id)) in ('ebay','ebay_gb') and coalesce(nullif(btrim(s.external_transaction_id),''),nullif(btrim(s.external_order_id),''))=v_external) then
   raise exception 'Sale line already recorded; reconcile existing ledger entry' using errcode='23505';
  end if;
 end if;
 return new;
end; $$;
create or replace trigger guard_order_line_identity before insert on public.orders for each row execute function public.swish_guard_ledger_identity();
create or replace trigger guard_sale_line_identity before insert on public.sales for each row execute function public.swish_guard_ledger_identity();
revoke all on function public.swish_guard_ledger_identity() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
