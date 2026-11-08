-- SWISH: preserve unclassified history in exact workspace report totals.
-- Schema-only output-scope correction; preserve owner/tenant/paid guards, inspectors and all data.
begin;
do $migration$
declare d text; old_scope text := '''unclassifiedInventory'',case when p_platform and p_niche_id is null then (select count(*) from public.items where public.swish_specialist_niche(specialist_id) is null) else 0 end,';
begin
 d:=pg_get_functiondef('public.swish_command_snapshot(uuid,boolean,text,text)'::regprocedure);
 if position('workspace-canonical-v1' in d)>0 then return; end if;
 if position(old_scope in d)=0 or position('with physical as materialized(select * from public.swish_inventory_canonical_rows)' in d)=0 or position('Tenant membership required' in d)=0 then raise exception 'Unreviewed workspace report contract'; end if;
 d:=replace(d,old_scope,$output$
'scopeCountsVersion','workspace-canonical-v1',
'unclassifiedInventory',case when v_owner and p_niche_id is null then (select count(*) from public.items i where (p_platform or i.tenant_id=p_tenant_id) and public.swish_specialist_niche(i.specialist_id) is null) else 0 end,
$output$);
 d:=replace(d,'''canonicalCounts'',case when p_platform and p_niche_id is null then (','''canonicalCounts'',case when p_niche_id is null then (');
 d:=replace(d,'with physical as materialized(select * from public.swish_inventory_canonical_rows)',
 'with physical as materialized(select * from public.swish_inventory_canonical_rows where (p_platform or tenant_id=p_tenant_id) and (niche_id=any(v_allowed) or (v_owner and niche_id is null)))');
 execute d;
end $migration$;
notify pgrst,'reload schema';
commit;
