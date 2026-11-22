import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

const rows=(v)=>Array.isArray(v)?v:[];
const photoOk=(v)=>v==null||(typeof v==='string'&&v.length<=1_000_000);

export default async function handler(req,res){
  if(req.method!=='PUT')return methodNotAllowed(res,['PUT']);
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    const body=req.body||{};
    if(JSON.stringify(body).length>4_000_000)return json(res,413,{error:'State update is too large. Reduce photo sizes and retry.'});

    const profile=rows(body.users).find(x=>x.id===user.id);
    if(profile){
      for(const k of ['photo','qrisPhoto'])if(!photoOk(profile[k]))return json(res,400,{error:'Profile images must be 1 MB or smaller.'});
      await sql`UPDATE users SET name=${String(profile.name||user.name).slice(0,100)},phone=${String(profile.phone||'').slice(0,40)},bank_name=${profile.bank?.bankName||null},account_number=${profile.bank?.accountNumber||null},account_holder=${profile.bank?.accountHolder||null},photo_url=${profile.photo||null},qris_photo_url=${profile.qrisPhoto||null} WHERE id=${user.id}`;
    }

    if(user.role==='seller'||user.role==='admin')for(const m of rows(body.motors)){
      if(user.role!=='admin'&&m.sellerId!==user.id)continue;
      if(!m.id||!m.brand||!m.name||!Number.isInteger(Number(m.year))||Number(m.pricePerHour)<=0||Number(m.pricePerDay)<=0||!photoOk(m.photo))continue;
      const ownerId=user.role==='admin'&&typeof m.sellerId==='string'?m.sellerId:user.id;
      await sql`INSERT INTO motors (id,seller_id,brand,name,year,price_per_hour,price_per_day,location,location_detail,description,photo,helm_included,helm_count,is_open,admin_blocked,block_reason) VALUES (${m.id},${ownerId},${String(m.brand).slice(0,100)},${String(m.name).slice(0,120)},${Number(m.year)},${Number(m.pricePerHour)},${Number(m.pricePerDay)},${String(m.location||'').slice(0,160)},${String(m.locationDetail||'').slice(0,300)},${String(m.description||'').slice(0,2000)},${m.photo||null},${Boolean(m.helmIncluded)},${Math.max(0,Math.min(10,Number(m.helmCount)||0))},${m.isOpen!==false},${user.role==='admin'&&Boolean(m.adminBlocked)},${user.role==='admin'?String(m.blockReason||'').slice(0,500):''}) ON CONFLICT (id) DO UPDATE SET brand=EXCLUDED.brand,name=EXCLUDED.name,year=EXCLUDED.year,price_per_hour=EXCLUDED.price_per_hour,price_per_day=EXCLUDED.price_per_day,location=EXCLUDED.location,location_detail=EXCLUDED.location_detail,description=EXCLUDED.description,photo=EXCLUDED.photo,helm_included=EXCLUDED.helm_included,helm_count=EXCLUDED.helm_count,is_open=EXCLUDED.is_open,admin_blocked=CASE WHEN ${user.role==='admin'} THEN EXCLUDED.admin_blocked ELSE motors.admin_blocked END,block_reason=CASE WHEN ${user.role==='admin'} THEN EXCLUDED.block_reason ELSE motors.block_reason END WHERE motors.seller_id=${ownerId}`;
    }

    for(const r of rows(body.rentals)){
      if(!r.id||!r.motorId)continue;
      const [existing]=await sql`SELECT * FROM rentals WHERE id=${r.id}`;
      if(!existing){
        if(user.role!=='buyer'||r.buyerId!==user.id)continue;
        const unit=r.durationUnit==='day'?'day':'hour';
        const value=Number(r.durationValue??r.durationHours);
        const hours=unit==='day'?value*24:value;
        const max=unit==='day'?30:24;
        if(!Number.isInteger(value)||value<1||value>max)continue;
        const [motor]=await sql`SELECT id,seller_id,price_per_hour,price_per_day,is_open,is_deleted FROM motors WHERE id=${r.motorId}`;
        if(!motor?.is_open||motor.is_deleted)continue;
        const amount=unit==='day'?value*Number(motor.price_per_day):value*Number(motor.price_per_hour);
        await sql`INSERT INTO rentals (id,motor_id,buyer_id,seller_id,duration_hours,duration_unit,duration_value,payment_method,total_price,status,payment_status,created_at) VALUES (${r.id},${motor.id},${user.id},${motor.seller_id},${hours},${unit},${value},'QRIS',${amount},'pending_payment','unpaid',coalesce(${r.createdAt}::timestamptz,now())) ON CONFLICT (id) DO NOTHING`;
        continue;
      }
      if(user.role==='admin'){
        const allowed=['pending_payment','pending_verification','booked','active','completed','cancelled'];
        if(!allowed.includes(r.status))continue;
        await sql`UPDATE rentals SET status=${r.status},payment_status=${String(r.paymentStatus||existing.payment_status)},payment_proof_url=${photoOk(r.paymentProofPhoto)?r.paymentProofPhoto:null},payment_submitted_at=${r.paymentSubmittedAt||null},payment_verified_at=${r.paymentVerifiedAt||null},start_time=${r.startTime||null},completed_at=${r.completedAt||null},cancelled_at=${r.cancelledAt||null},cancel_reason=${String(r.cancelReason||'').slice(0,500)},commission=${Math.max(0,Number(r.commission)||0)},commission_paid=${Boolean(r.commissionPaid)},commission_pending=${Boolean(r.commissionPending)},commission_paid_at=${r.commissionPaidAt||null} WHERE id=${r.id}`;
        continue;
      }
      if(user.role==='buyer'&&existing.buyer_id===user.id&&r.status==='pending_verification'&&existing.status==='pending_payment'&&photoOk(r.paymentProofPhoto)&&r.paymentProofPhoto){
        await sql`UPDATE rentals SET status='pending_verification',payment_status='pending',payment_proof_url=${r.paymentProofPhoto},payment_submitted_at=now() WHERE id=${r.id}`;
      }else if(user.role==='seller'&&existing.seller_id===user.id&&existing.status!==r.status){
        if(existing.status==='pending_verification'&&r.status==='booked')await sql`UPDATE rentals SET status='booked',payment_status='paid',payment_verified_at=now() WHERE id=${r.id}`;
        else if(existing.status==='booked'&&r.status==='active')await sql`UPDATE rentals SET status='active',start_time=coalesce(${r.startTime||null}::timestamptz,now()) WHERE id=${r.id}`;
        else if(existing.status==='active'&&r.status==='completed'){
          const [settings]=await sql`SELECT commission_rate FROM platform_settings WHERE id=1`;
          const commission=Math.round(Number(existing.total_price)*Number(settings?.commission_rate||0.1));
          await sql`UPDATE rentals SET status='completed',completed_at=now(),commission=${commission},commission_paid=false,commission_pending=false WHERE id=${r.id}`;
          await sql`UPDATE users SET balance=balance+${Number(existing.total_price)} WHERE id=${existing.seller_id}`;
        }
      }else if(user.role==='buyer'&&existing.buyer_id===user.id&&existing.status!==r.status&&r.status==='cancelled'){
        await sql`UPDATE rentals SET status='cancelled',cancelled_at=now(),cancel_reason=${String(r.cancelReason||'').slice(0,500)} WHERE id=${r.id} AND status IN ('pending_payment','pending_verification','booked')`;
      }
    }

    for(const c of rows(body.chats)){
      if(!c.id||!c.rentalId)continue;
      const [r]=await sql`SELECT buyer_id,seller_id FROM rentals WHERE id=${c.rentalId}`;
      if(!r||![r.buyer_id,r.seller_id].includes(user.id))continue;
      if(c.senderId===user.id){
        if(!photoOk(c.photo)||(!String(c.text||'').trim()&&!c.photo))continue;
        const receiver=r.buyer_id===user.id?r.seller_id:r.buyer_id;
        await sql`INSERT INTO chat_messages (id,rental_id,sender_id,receiver_id,message_text,photo_url,is_read,created_at) VALUES (${c.id},${c.rentalId},${user.id},${receiver},${String(c.text||'').slice(0,4000)},${c.photo||null},false,coalesce(${c.createdAt}::timestamptz,now())) ON CONFLICT (id) DO NOTHING`;
      }else if(c.receiverId===user.id&&c.read){
        await sql`UPDATE chat_messages SET is_read=true WHERE id=${c.id} AND receiver_id=${user.id}`;
      }
    }

    if(user.role==='buyer')for(const rv of rows(body.reviews)){
      if(rv.buyerId!==user.id)continue;
      const [r]=await sql`SELECT id,motor_id,buyer_id,seller_id,status FROM rentals WHERE id=${rv.rentalId}`;
      if(!r||r.buyer_id!==user.id||r.status!=='completed')continue;
      await sql`INSERT INTO reviews (id,rental_id,motor_id,buyer_id,seller_id,rating,comment,created_at) VALUES (${rv.id},${r.id},${r.motor_id},${r.buyer_id},${r.seller_id},${Math.max(1,Math.min(5,Number(rv.rating)||5))},${String(rv.comment||'').slice(0,2000)},coalesce(${rv.createdAt}::timestamptz,now())) ON CONFLICT (rental_id) DO NOTHING`;
    }

    for(const n of rows(body.notifications)){
      if(!n.id||typeof n.userId!=='string')continue;
      if(user.role!=='admin'&&n.userId!==user.id){
        if(!n.rentalId)continue;
        const [r]=await sql`SELECT buyer_id,seller_id FROM rentals WHERE id=${n.rentalId}`;
        if(!r||![r.buyer_id,r.seller_id].includes(user.id)||![r.buyer_id,r.seller_id].includes(n.userId))continue;
      }
      await sql`INSERT INTO notifications (id,user_id,notification_type,title,message,rental_id,link,is_read,created_at) VALUES (${n.id},${n.userId},${String(n.type||'info').slice(0,40)},${String(n.title||'').slice(0,120)},${String(n.message||'').slice(0,1000)},${n.rentalId||null},${n.link||null},${Boolean(n.read)},coalesce(${n.createdAt}::timestamptz,now())) ON CONFLICT (id) DO NOTHING`;
    }
    for(const n of rows(body.notifications))if(n.userId===user.id&&n.read)await sql`UPDATE notifications SET is_read=true WHERE id=${n.id} AND user_id=${user.id}`;

    for(const cp of rows(body.commissionPayments)){
      const [existing]=await sql`SELECT id,status,seller_id FROM commission_payments WHERE id=${cp.id}`;
      if(!existing){
        if(user.role==='admin'&&cp.manual===true&&cp.status==='verified'){
          const rs=await sql`SELECT id,commission FROM rentals WHERE seller_id=${cp.sellerId} AND status='completed' AND commission_paid=false AND commission_pending=false AND to_char(coalesce(completed_at,created_at),'YYYY-MM')=${cp.period}`;
          if(!rs.length)continue;
          const amount=rs.reduce((s,r)=>s+Number(r.commission),0);
          await sql`INSERT INTO commission_payments (id,seller_id,period,amount,status,reviewed_at,reviewed_by,admin_note,manual) VALUES (${cp.id},${cp.sellerId},${cp.period},${amount},'verified',coalesce(${cp.reviewedAt}::timestamptz,now()),${user.id},${String(cp.adminNote||'Ditandai lunas manual oleh admin').slice(0,1000)},true) ON CONFLICT (id) DO NOTHING`;
          for(const r of rs)await sql`INSERT INTO commission_payment_rentals (commission_payment_id,rental_id) VALUES (${cp.id},${r.id}) ON CONFLICT DO NOTHING`;
          await sql`UPDATE rentals SET commission_paid=true,commission_pending=false,commission_paid_at=now(),commission_payment_id=${cp.id} WHERE id=ANY(${rs.map(r=>r.id)})`;
          continue;
        }
        if(user.role!=='seller'||cp.sellerId!==user.id||cp.status!=='pending'||!photoOk(cp.proofPhoto)||!cp.proofPhoto)continue;
        const ids=Array.isArray(cp.rentalIds)?[...new Set(cp.rentalIds.filter(x=>typeof x==='string'))]:[];
        const rs=await sql`SELECT id,commission FROM rentals WHERE id=ANY(${ids}) AND seller_id=${user.id} AND status='completed' AND commission_paid=false AND commission_pending=false`;
        if(!rs.length||rs.length!==ids.length)continue;
        const amount=rs.reduce((s,r)=>s+Number(r.commission),0);
        await sql`INSERT INTO commission_payments (id,seller_id,period,amount,proof_photo_url,status,submitted_at,manual) VALUES (${cp.id},${user.id},${cp.period},${amount},${cp.proofPhoto},'pending',coalesce(${cp.submittedAt}::timestamptz,now()),false) ON CONFLICT (id) DO NOTHING`;
        for(const r of rs)await sql`INSERT INTO commission_payment_rentals (commission_payment_id,rental_id) VALUES (${cp.id},${r.id}) ON CONFLICT DO NOTHING`;
        await sql`UPDATE rentals SET commission_pending=true,commission_payment_id=${cp.id} WHERE id=ANY(${rs.map(r=>r.id)})`;
      }else if(user.role==='admin'&&existing.status==='pending'&&['verified','rejected'].includes(cp.status)){
        if(cp.status==='rejected'&&!String(cp.adminNote||'').trim())continue;
        await sql`UPDATE commission_payments SET status=${cp.status},reviewed_at=now(),reviewed_by=${user.id},admin_note=${String(cp.adminNote||'').slice(0,1000)} WHERE id=${cp.id}`;
        if(cp.status==='verified')await sql`UPDATE rentals SET commission_paid=true,commission_pending=false,commission_paid_at=now() WHERE commission_payment_id=${cp.id}`;
        else await sql`UPDATE rentals SET commission_pending=false,commission_payment_id=NULL WHERE commission_payment_id=${cp.id}`;
      }
    }

    if(user.role==='admin'){
      for(const log of rows(body.auditLogs))if(log.id&&log.action)await sql`INSERT INTO audit_logs (id,admin_id,admin_name,action,detail,created_at) VALUES (${log.id},${user.id},${user.name},${String(log.action).slice(0,160)},${String(log.detail||'').slice(0,2000)},coalesce(${log.createdAt}::timestamptz,now())) ON CONFLICT (id) DO NOTHING`;
      if(body.settings?.bank)await sql`INSERT INTO platform_settings (id,commission_rate,due_day,bank_name,account_number,account_holder) VALUES (1,${Number(body.settings.commissionRate)||0.1},${Number(body.settings.dueDay)||5},${String(body.settings.bank.bankName||'').slice(0,80)},${String(body.settings.bank.accountNumber||'').slice(0,80)},${String(body.settings.bank.accountHolder||'').slice(0,100)}) ON CONFLICT (id) DO UPDATE SET commission_rate=EXCLUDED.commission_rate,due_day=EXCLUDED.due_day,bank_name=EXCLUDED.bank_name,account_number=EXCLUDED.account_number,account_holder=EXCLUDED.account_holder,updated_at=now()`;
    }
    return json(res,200,{ok:true});
  }catch(error){return handleError(res,error);}
}
