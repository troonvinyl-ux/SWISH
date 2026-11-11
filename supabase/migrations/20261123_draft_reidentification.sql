-- Schema-only: accept reviewed draft identification on existing items/listings.
-- Invoker RLS, current niche, publication locks and optimistic versions remain enforced.
create or replace function public.swish_apply_draft_reidentification(
 p_tenant_id uuid,p_listing_id uuid,p_niche_id text,p_item_version timestamptz,p_listing_version timestamptz,
 p_clues text,p_proposal jsonb,p_draft_title text,p_receipt text)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public set statement_timeout='10s' as $$
declare l public.listings%rowtype; i public.items%rowtype; a jsonb; m jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 m:=public.swish_current_module();
 if m is null or m->>'tenant_id' is distinct from p_tenant_id::text or m->>'niche_id' is distinct from p_niche_id or not public.swish_can_access_niche(p_tenant_id,p_niche_id) then raise exception 'Active draft workspace required' using errcode='42501'; end if;
 if p_clues is null or length(p_clues)>2000 or p_receipt is null or p_receipt !~ '^draft-reid-[a-z0-9-]{1,100}$' then raise exception 'Invalid draft evidence' using errcode='22023'; end if;
 if p_proposal is null and p_draft_title is not null then raise exception 'A reviewed identification is required for a title change' using errcode='22023'; end if;
 if p_draft_title is not null and (nullif(btrim(p_draft_title),'') is null or length(p_draft_title)>80) then raise exception 'Draft title must contain 1 to 80 characters' using errcode='22023'; end if;
 if p_proposal is not null then
  if jsonb_typeof(p_proposal) is distinct from 'object' or octet_length(p_proposal::text)>80000 or nullif(btrim(p_proposal->>'canonicalTitle'),'') is null or length(p_proposal->>'canonicalTitle')>500 or jsonb_typeof(p_proposal->'confidence') is distinct from 'number' then raise exception 'Invalid identification proposal' using errcode='22023'; end if;
  if (p_proposal->>'confidence')::numeric<0 or (p_proposal->>'confidence')::numeric>1 or jsonb_typeof(p_proposal->'warnings') is distinct from 'array' then raise exception 'Invalid identification confidence or warnings' using errcode='22023'; end if;
 end if;
 select * into l from public.listings where id=p_listing_id and tenant_id=p_tenant_id for update;
 if not found then raise exception 'Draft not found or access denied' using errcode='42501'; end if;
 select * into i from public.items where id=l.item_id and tenant_id=p_tenant_id for update;
 if not found or public.swish_specialist_niche(i.specialist_id) is distinct from p_niche_id then raise exception 'Item not found in this niche' using errcode='42501'; end if;
 if lower(btrim(coalesce(l.status,''))) not in ('draft','pending') or nullif(btrim(l.external_listing_id),'') is not null or l.published_at is not null or l.ended_at is not null or l.publish_claim_id is not null or i.sold_at is not null or i.status in ('listed','active','live','sold','archived','disposed') or exists(select 1 from public.listings x where x.tenant_id=p_tenant_id and x.item_id=i.id and (nullif(btrim(x.external_listing_id),'') is not null or x.published_at is not null or x.publish_claim_id is not null or x.status in ('active','live','publishing','published','sold'))) then raise exception 'Re-identification is restricted to unpublished drafts; no marketplace changes were sent' using errcode='42501'; end if;
 if i.updated_at is distinct from p_item_version or l.updated_at is distinct from p_listing_version then raise exception 'Draft changed during review. Reload before applying' using errcode='40001'; end if;
 a:=coalesce(i.attributes,'{}'::jsonb)||jsonb_build_object('_draft_reidentification',jsonb_build_object('clues',btrim(p_clues),'clueSource','seller_unverified','proposal',p_proposal,'receipt',p_receipt,'recordedAt',now(),'listingId',p_listing_id));
 if p_proposal is not null then
  a:=a||jsonb_build_object('_identification_evidence',jsonb_build_object('supporting',p_proposal->'supporting','contradictory',p_proposal->'contradictory','missing',p_proposal->'missing','candidates',p_proposal->'candidates','source','ai_proposal','recordedAt',now()),'identification_state',coalesce(p_proposal->>'identificationState','candidate'),'object_type',coalesce(p_proposal->>'objectType','unknown'),'_valuation_needs_review',true,'_draft_copy_needs_review',true);
  if jsonb_typeof(p_proposal->'specialistAnalysis')='object' then a:=a||jsonb_build_object('_specialist_analysis',p_proposal->'specialistAnalysis'); end if;
 end if;
 update public.items set attributes=a,canonical_title=case when p_proposal is null then canonical_title else p_proposal->>'canonicalTitle' end,identification_confidence=case when p_proposal is null then identification_confidence else (p_proposal->>'confidence')::numeric end,identification_source=case when p_proposal is null then identification_source else 'researched' end,warnings=case when p_proposal is null then warnings else array(select jsonb_array_elements_text(p_proposal->'warnings')) end where id=i.id and tenant_id=p_tenant_id;
 if not found then raise exception 'Draft identification save denied' using errcode='42501'; end if;
 -- Touch only the selected private draft; seller description/price/category/options are preserved.
 update public.listings set title=coalesce(btrim(p_draft_title),title),updated_at=now() where id=l.id and tenant_id=p_tenant_id;
 if not found then raise exception 'Draft save denied' using errcode='42501'; end if;
 return l.id;
end;$$;
revoke all on function public.swish_apply_draft_reidentification(uuid,uuid,text,timestamptz,timestamptz,text,jsonb,text,text) from public,anon;
grant execute on function public.swish_apply_draft_reidentification(uuid,uuid,text,timestamptz,timestamptz,text,jsonb,text,text) to authenticated;
comment on function public.swish_apply_draft_reidentification(uuid,uuid,text,timestamptz,timestamptz,text,jsonb,text,text) is 'Reviewed draft-only evidence. Invoker RLS, current module, row locks and CAS; no seller action, price reset or duplicate item.';
notify pgrst,'reload schema';
