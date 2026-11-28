-- The e-invoice pill says the true state of an order's invoice (ADR-069, ADR-070; native-till.md section 17.6). It read
-- the newest sale or company invoice still on its way, so once a company invoice was asked for while the sale invoice
-- had failed, it said "Đang xuất…" for the company invoice, which waits for that sale invoice (app.einvoice_ready) and
-- does not move until the job or a manager sends the sale invoice again. Now the document that holds the order back
-- leads: one the job gave up on (failed), else one it will try again (retrying), else the newest one queued or being
-- made (pending), as before. The invoice, the attempts and the next attempt in the answer are that document's, so a
-- manager's retry (manager_retry_einvoice) names the one that failed. Nothing else of the answer changes, for the
-- counter (counter_order_einvoice) and for the customer (customer_invoice_status) alike.

create or replace function app.einvoice_pill(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_live public.e_invoices;
  v_head public.e_invoices;
  v_state text;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id;
  v_live := app.einvoice_live(p_order_id);
  -- the document the order waits on: given up first, then failing, then the newest on its way
  select e.* into v_head from public.e_invoices e
  where e.order_id = p_order_id and e.kind in ('sale', 'replacement') and e.state in ('queued', 'issuing', 'failed')
  order by (e.state = 'failed' and e.next_attempt_at is null) desc, (e.state = 'failed') desc, e.queued_at desc, e.id
  limit 1;
  v_state := case
    when v_live.id is not null then 'issued'
    when v_head.id is not null and v_head.state = 'failed' and v_head.next_attempt_at is null then 'failed'
    when v_head.id is not null and v_head.state = 'failed' then 'retrying'
    when v_head.id is not null then 'pending'
    when exists (select 1 from public.e_invoices e where e.order_id = p_order_id and e.kind in ('sale', 'replacement')) then 'cancelled'
    when (app.einvoice_provider_for(v_order.brand_id, v_order.store_id)).id is null then 'off'
    else 'none'
  end;
  return jsonb_build_object(
    'state', v_state,
    'invoice', app.einvoice_doc_json(coalesce(v_live, v_head)),
    'replacing', v_live.id is not null and v_head.id is not null and v_head.kind = 'replacement',
    'corrections_pending', (select count(*) from public.e_invoices e
      where e.order_id = p_order_id and e.kind in ('adjustment', 'cancellation') and e.state in ('queued', 'issuing', 'failed'))::integer,
    'attempts', coalesce(v_head.attempts, 0),
    'next_attempt_at', v_head.next_attempt_at);
end;
$$;

comment on function app.einvoice_pill(uuid) is 'the e-invoice state of an order for the counter''s pill (Q01) and the customer: issued ("Đã xuất": the provider holds a valid invoice), else the state of the sale or company invoice that holds the order back: failed (given up, a manager retries), retrying ("Chưa xuất được. Hệ thống tự thử lại, đơn vẫn hoàn tất."), pending ("Đang xuất…", the newest on its way); cancelled, off (no provider) or none (nothing to invoice); with that invoice, whether a company invoice is replacing an issued one and how many corrections wait';

-- Grants as before: the pill is closed to every API role; staff read it through public.counter_order_einvoice and
-- customers through public.customer_invoice_status (both unchanged), which only authenticated may execute.
revoke all on function app.einvoice_pill(uuid) from public, anon, authenticated, service_role;
