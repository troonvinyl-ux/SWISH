-- Schema-only: reviewed SWISH identification for an existing active eBay item.
-- Installs an invoker command; installation does not modify application records.
-- Marketplace copy, seller price, status, external IDs and ledger records are untouched.
create or replace function public.swish_apply_live_reidentification(
 p_tenant_id uuid,p_listing_id uuid,p_niche_id text,p_item_version timestamptz,p_listing_version timestamptz,
 p_clues text,p_proposal jsonb,p_reviewed_title text,p_receipt text)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public set statement_timeout='10s' as $$
declare l public.listings%rowtype; i public.items%rowtype; a jsonb; m jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 m:=public.swish_current_module();
 if m is null or m->>'tenant_id' is distinct from p_tenant_id::text or m->>'niche_id' is distinct from p_niche_id or not public.swish_can_access_niche(p_tenant_id,p_niche_id) then raise exception 'Active listing workspace required' using errcode='42501'; end if;
 if p_clues is null or length(p_clues)>2000 or p_receipt is null or p_receipt !~ '^live-reid-[a-z0-9-]{1,100}$' then raise exception 'Invalid live identification evidence' using errcode='22023'; end if;
 if p_proposal is null and p_reviewed_title is not null then raise exception 'Review an identification before preparing a title' using errcode='22023'; end if;
 if p_reviewed_title is not null and (nullif(btrim(p_reviewed_title),'') is null or length(p_reviewed_title)>80) then raise exception 'Reviewed title must contain 1 to 80 characters' using errcode='22023'; end if;
 if p_proposal is not null then
  if jsonb_typeof(p_proposal) is distinct from 'object' or octet_length(p_proposal::text)>80000 or nullif(btrim(p_proposal->>'canonicalTitle'),'') is null or length(p_proposal->>'canonicalTitle')>500 or jsonb_typeof(p_proposal->'confidence') is distinct from 'number' then raise exception 'Invalid identification proposal' using errcode='22023'; end if;
  if (p_proposal->>'confidence')::numeric<0 or (p_proposal->>'confidence')::numeric>1 or jsonb_typeof(p_proposal->'warnings') is distinct from 'array' then raise exception 'Invalid identification confidence or warnings' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_proposal->'warnings') w where jsonb_typeof(w) is distinct from 'string') then raise exception 'Identification warnings must be text' using errcode='22023'; end if;
 end if;
 select * into l from public.listings where id=p_listing_id and tenant_id=p_tenant_id for update;
 if not found then raise exception 'Listing not found or access denied' using errcode='42501'; end if;
 select * into i from public.items where id=l.item_id and tenant_id=p_tenant_id for update;
 if not found or public.swish_specialist_niche(i.specialist_id) is distinct from p_niche_id then raise exception 'Item not found in this niche' using errcode='42501'; end if;
 if lower(btrim(coalesce(l.status,''))) not in ('active','live') or lower(coalesce(l.marketplace_id,''))<>'ebay' or nullif(btrim(l.external_listing_id),'') is null or l.ended_at is not null or l.publish_claim_id is not null or i.sold_at is not null or lower(i.status) in ('sold','archived','disposed') then raise exception 'Open an active linked eBay listing; sold, ended and pending submissions are excluded' using errcode='42501'; end if;
 if i.updated_at is distinct from p_item_version or l.updated_at is distinct from p_listing_version then raise exception 'Listing or item changed during review. Reload before applying' using errcode='40001'; end if;
 a:=coalesce(i.attributes,'{}'::jsonb)||jsonb_build_object('_live_reidentification',jsonb_build_object('clues',btrim(p_clues),'clueSource','seller_unverified','proposal',p_proposal,'reviewedTitle',p_reviewed_title,'receipt',p_receipt,'recordedAt',now(),'listingId',p_listing_id,'externalListingId',l.external_listing_id,'marketplaceChanged',false));
 if p_proposal is not null then
  a:=a||jsonb_build_object('_identification_evidence',jsonb_build_object('supporting',p_proposal->'supporting','contradictory',p_proposal->'contradictory','missing',p_proposal->'missing','candidates',p_proposal->'candidates','source','ai_proposal','recordedAt',now()),'identification_state',coalesce(p_proposal->>'identificationState','candidate'),'object_type',coalesce(p_proposal->>'objectType','unknown'),'_valuation_needs_review',true,'_live_copy_needs_review',true);
  if jsonb_typeof(p_proposal->'specialistAnalysis')='object' then a:=a||jsonb_build_object('_specialist_analysis',p_proposal->'specialistAnalysis'); end if;
 end if;
 -- Preserve physical identity, photos, condition, costs and previous risk warnings.
 update public.items set attributes=a,canonical_title=case when p_proposal is null then canonical_title else p_proposal->>'canonicalTitle' end,identification_confidence=case when p_proposal is null then identification_confidence else (p_proposal->>'confidence')::numeric end,identification_source=case when p_proposal is null then identification_source else 'researched' end,warnings=case when p_proposal is null then warnings else array(select distinct w from (select unnest(coalesce(i.warnings,'{}'::text[])) as w union all select jsonb_array_elements_text(p_proposal->'warnings')) caution order by w) end where id=i.id and tenant_id=p_tenant_id;
 if not found then raise exception 'Identification save denied' using errcode='42501'; end if;
 -- No listing update: reviewedTitle is private until selected in the existing editor.
 return l.id;
end;$$;
revoke all on function public.swish_apply_live_reidentification(uuid,uuid,text,timestamptz,timestamptz,text,jsonb,text,text) from public,anon;
grant execute on function public.swish_apply_live_reidentification(uuid,uuid,text,timestamptz,timestamptz,text,jsonb,text,text) to authenticated;
comment on function public.swish_apply_live_reidentification(uuid,uuid,text,timestamptz,timestamptz,text,jsonb,text,text) is 'Reviewed live item intelligence only; invoker RLS, current niche, locks and CAS. No seller revision, listing write, price change or duplicate inventory.';
notify pgrst,'reload schema';
