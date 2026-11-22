import { createHash } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from '../_lib/db.js';

const rows=(value)=>Array.isArray(value)?value:[];
const id=(value)=>typeof value==='string'&&value.length>0&&value.length<=200?value:null;
const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const date=(value)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():new Date().toISOString();
const image=(value)=>typeof value==='string'&&value.length<=1_000_000?value:null;

export default async function handler(req,res){
  if(req.method!=='POST')return methodNotAllowed(res,['POST']);
  try{
    const sql=getDb();
    const admin=await currentUser(req,sql);
    if(!admin)return json(res,401,{error:'Sign in required.'});
    if(admin.role!=='admin')return json(res,403,{error:'Admin access required.'});
    const backup=req.body?.backup;
    if(!backup||typeof backup!=='object'||Array.isArray(backup))return json(res,400,{error:'Pilih file backup JSON RentGo yang valid.'});
    const raw=JSON.stringify(backup);
    if(raw.length>3_800_000)return json(res,413,{error:'File backup terlalu besar untuk satu kali impor. Ekspor data tanpa foto berukuran besar, lalu coba lagi.'});
    const sourceHash=createHash('sha256').update(raw).digest('hex');
    const [done]=await sql`SELECT source_hash FROM legacy_imports WHERE source_hash=${sourceHash}`;
    if(done)return json(res,200,{ok:true,alreadyImported:true,counts:{}});

    const [dbUsers,dbMotors]=await Promise.all([
      sql`SELECT id,email,role FROM users`,
      sql`SELECT id,seller_id FROM motors`
    ]);
    const byEmail=new Map(dbUsers.map(u=>[u.email.toLowerCase(),u]));
    const userById=new Map(dbUsers.map(u=>[u.id,u]));
    const userIds=new Map();
    let unmatchedUsers=0,matchedUsers=0;
    for(const oldUser of rows(backup.users)){
      if(!id(oldUser.id))continue;
      if(typeof oldUser.email!=='string'){unmatchedUsers++;continue;}
      const target=byEmail.get(oldUser.email.trim().toLowerCase());
      if(oldUser.role==='admin'){userIds.set(oldUser.id,admin.id);matchedUsers++;}
      else if(target&&target.role===oldUser.role){userIds.set(oldUser.id,target.id);userIds.set(target.id,target.id);matchedUsers++;}
      else unmatchedUsers++;
    }

    const counts={usersMapped:matchedUsers,usersUnmatched:unmatchedUsers,motors:0,rentals:0,commissionPayments:0,reviews:0,chats:0,notifications:0,auditLogs:0,withdrawals:0,photosOmitted:Math.max(0,number(backup._migrationPhotosOmitted)),rowsSkipped:0};
    const motorOwners=new Map(dbMotors.map(m=>[m.id,m.seller_id]));

    for(const m of rows(backup.motors)){
      const motorId=id(m.id),sellerId=userIds.get(m.sellerId);
      if(!motorId||!sellerId||!m.brand||!m.name||!Number.isInteger(number(m.year))||number(m.year)<1990||number(m.pricePerHour)<=0||number(m.pricePerDay)<=0){counts.rowsSkipped++;continue;}
      const seller=byEmail.get(rows(backup.users).find(u=>u.id===m.sellerId)?.email?.trim().toLowerCase());
      if(seller?.role!=='seller'){counts.rowsSkipped++;continue;}
      const photo=image(m.photo);if(m.photo&&!photo)counts.photosOmitted++;
      const result=await sql`INSERT INTO motors (id,seller_id,brand,name,year,price_per_hour,price_per_day,location,location_detail,description,photo,helm_included,helm_count,is_open,admin_blocked,block_reason,created_at) VALUES (${motorId},${sellerId},${String(m.brand).slice(0,100)},${String(m.name).slice(0,120)},${number(m.year)},${Math.round(number(m.pricePerHour))},${Math.round(number(m.pricePerDay))},${String(m.location||'').slice(0,160)},${String(m.locationDetail||'').slice(0,300)},${String(m.description||'').slice(0,2000)},${photo},${Boolean(m.helmIncluded)},${Math.max(0,Math.min(10,Math.round(number(m.helmCount))))},${m.isOpen!==false},${Boolean(m.adminBlocked)},${String(m.blockReason||'').slice(0,500)},${date(m.createdAt)}) ON CONFLICT (id) DO UPDATE SET photo=COALESCE(motors.photo,EXCLUDED.photo) WHERE motors.seller_id=EXCLUDED.seller_id RETURNING id`;
      if(result.length){counts.motors++;motorOwners.set(motorId,sellerId);}
    }

    const legacyCommissionIds=new Set();
    for(const cp of rows(backup.commissionPayments)){
      const cpId=id(cp.id),sellerId=userIds.get(cp.sellerId);
      if(!cpId||!sellerId||!/^\d{4}-\d{2}$/.test(String(cp.period||''))||!['pending','verified','rejected'].includes(cp.status)){counts.rowsSkipped++;continue;}
      const proof=image(cp.proofPhoto);if(cp.proofPhoto&&!proof)counts.photosOmitted++;
      const reviewedBy=cp.reviewedAt?admin.id:null;
      const result=await sql`INSERT INTO commission_payments (id,seller_id,period,amount,proof_photo_url,status,submitted_at,reviewed_at,reviewed_by,admin_note,manual) VALUES (${cpId},${sellerId},${cp.period},${Math.max(0,Math.round(number(cp.amount)))},${proof},${cp.status},${date(cp.submittedAt)},${cp.reviewedAt?date(cp.reviewedAt):null},${reviewedBy},${String(cp.adminNote||'').slice(0,1000)},${Boolean(cp.manual)}) ON CONFLICT (id) DO UPDATE SET proof_photo_url=COALESCE(commission_payments.proof_photo_url,EXCLUDED.proof_photo_url) WHERE commission_payments.seller_id=EXCLUDED.seller_id RETURNING id`;
      if(result.length){legacyCommissionIds.add(cpId);counts.commissionPayments++;}else counts.rowsSkipped++;
    }

    const legacyRentalIds=new Set();
    for(const r of rows(backup.rentals)){
      const rentalId=id(r.id),buyerId=userIds.get(r.buyerId),sellerId=userIds.get(r.sellerId),motorId=id(r.motorId);
      if(!rentalId||!buyerId||!sellerId||!motorId||motorOwners.get(motorId)!==sellerId){counts.rowsSkipped++;continue;}
      const status=['pending_payment','pending_verification','booked','active','completed','cancelled'].includes(r.status)?r.status:'pending_payment';
      const proof=image(r.paymentProofPhoto);if(r.paymentProofPhoto&&!proof)counts.photosOmitted++;
      const commissionId=legacyCommissionIds.has(r.commissionPaymentId)?r.commissionPaymentId:null;
      const result=await sql`INSERT INTO rentals (id,motor_id,buyer_id,seller_id,start_time,duration_hours,payment_method,total_price,status,payment_status,payment_proof_url,payment_submitted_at,payment_verified_at,completed_at,cancelled_at,cancel_reason,commission,commission_paid,commission_pending,commission_paid_at,commission_payment_id,created_at) VALUES (${rentalId},${motorId},${buyerId},${sellerId},${r.startTime?date(r.startTime):null},${Math.max(1,Math.min(720,Math.round(number(r.durationHours,1))))},${String(r.paymentMethod||'QRIS').slice(0,30)},${Math.max(0,Math.round(number(r.totalPrice)))},${status},${String(r.paymentStatus||'unpaid').slice(0,30)},${proof},${r.paymentSubmittedAt?date(r.paymentSubmittedAt):null},${r.paymentVerifiedAt?date(r.paymentVerifiedAt):null},${r.completedAt?date(r.completedAt):null},${r.cancelledAt?date(r.cancelledAt):null},${String(r.cancelReason||'').slice(0,500)},${Math.max(0,Math.round(number(r.commission)))},${Boolean(r.commissionPaid)},${Boolean(r.commissionPending)},${r.commissionPaidAt?date(r.commissionPaidAt):null},${commissionId},${date(r.createdAt)}) ON CONFLICT (id) DO UPDATE SET payment_proof_url=COALESCE(rentals.payment_proof_url,EXCLUDED.payment_proof_url) WHERE rentals.buyer_id=EXCLUDED.buyer_id AND rentals.seller_id=EXCLUDED.seller_id AND rentals.motor_id=EXCLUDED.motor_id RETURNING id`;
      if(result.length){legacyRentalIds.add(rentalId);counts.rentals++;}else counts.rowsSkipped++;
    }

    for(const cp of rows(backup.commissionPayments)){
      if(!legacyCommissionIds.has(cp.id))continue;
      for(const rentalId of rows(cp.rentalIds))if(legacyRentalIds.has(rentalId))await sql`INSERT INTO commission_payment_rentals (commission_payment_id,rental_id) VALUES (${cp.id},${rentalId}) ON CONFLICT DO NOTHING`;
    }

    for(const rv of rows(backup.reviews)){
      const reviewId=id(rv.id),rentalId=id(rv.rentalId);if(!reviewId||!legacyRentalIds.has(rentalId)){counts.rowsSkipped++;continue;}
      const [r]=await sql`SELECT id,motor_id,buyer_id,seller_id,status FROM rentals WHERE id=${rentalId}`;
      if(!r||r.status!=='completed'){counts.rowsSkipped++;continue;}
      const result=await sql`INSERT INTO reviews (id,rental_id,motor_id,buyer_id,seller_id,rating,comment,created_at) VALUES (${reviewId},${r.id},${r.motor_id},${r.buyer_id},${r.seller_id},${Math.max(1,Math.min(5,Math.round(number(rv.rating,5))))},${String(rv.comment||'').slice(0,2000)},${date(rv.createdAt)}) ON CONFLICT DO NOTHING RETURNING id`;
      if(result.length)counts.reviews++;
    }

    for(const c of rows(backup.chats)){
      const chatId=id(c.id),rentalId=id(c.rentalId);if(!chatId||!legacyRentalIds.has(rentalId)){counts.rowsSkipped++;continue;}
      const [r]=await sql`SELECT buyer_id,seller_id FROM rentals WHERE id=${rentalId}`;
      const senderId=userIds.get(c.senderId),receiverId=userIds.get(c.receiverId);if(!r||!senderId||!receiverId||![r.buyer_id,r.seller_id].includes(senderId)||![r.buyer_id,r.seller_id].includes(receiverId)){counts.rowsSkipped++;continue;}
      const photo=image(c.photo);if(c.photo&&!photo)counts.photosOmitted++;
      const result=await sql`INSERT INTO chat_messages (id,rental_id,sender_id,receiver_id,message_text,photo_url,is_read,created_at) VALUES (${chatId},${rentalId},${senderId},${receiverId},${String(c.text||'').slice(0,4000)},${photo},${Boolean(c.read)},${date(c.createdAt)}) ON CONFLICT (id) DO UPDATE SET photo_url=COALESCE(chat_messages.photo_url,EXCLUDED.photo_url) WHERE chat_messages.sender_id=EXCLUDED.sender_id AND chat_messages.rental_id=EXCLUDED.rental_id RETURNING id`;
      if(result.length)counts.chats++;
    }

    for(const n of rows(backup.notifications)){
      const notificationId=id(n.id),userId=userIds.get(n.userId);if(!notificationId||!userId){counts.rowsSkipped++;continue;}
      const rentalId=legacyRentalIds.has(n.rentalId)?n.rentalId:null;
      const result=await sql`INSERT INTO notifications (id,user_id,notification_type,title,message,rental_id,link,is_read,created_at) VALUES (${notificationId},${userId},${String(n.type||'info').slice(0,40)},${String(n.title||'').slice(0,120)},${String(n.message||'').slice(0,1000)},${rentalId},${typeof n.link==='string'?n.link.slice(0,300):null},${Boolean(n.read)},${date(n.createdAt)}) ON CONFLICT (id) DO NOTHING RETURNING id`;
      if(result.length)counts.notifications++;
    }

    for(const log of rows(backup.auditLogs)){
      const logId=id(log.id);if(!logId||!log.action)continue;
      const result=await sql`INSERT INTO audit_logs (id,admin_id,admin_name,action,detail,created_at) VALUES (${logId},${admin.id},${String(log.adminName||admin.name).slice(0,100)},${String(log.action).slice(0,160)},${String(log.detail||'').slice(0,2000)},${date(log.createdAt)}) ON CONFLICT (id) DO NOTHING RETURNING id`;
      if(result.length)counts.auditLogs++;
    }

    for(const w of rows(backup.withdrawals)){
      const withdrawalId=id(w.id),sellerId=userIds.get(w.sellerId||w.seller_id);
      const bankName=w.bankName||w.bank_name,accountNumber=w.accountNumber||w.account_number,accountHolder=w.accountHolder||w.account_holder;
      const amount=Math.round(number(w.amount));
      if(!withdrawalId||!sellerId||userById.get(sellerId)?.role!=='seller'||amount<=0||!bankName||!accountNumber||!accountHolder||!['pending','paid','rejected'].includes(w.status)){counts.rowsSkipped++;continue;}
      const result=await sql`INSERT INTO withdrawal_requests (id,seller_id,amount,bank_name,account_number,account_holder,status,requested_at,reviewed_by,reviewed_at,admin_note) VALUES (${withdrawalId},${sellerId},${amount},${String(bankName).slice(0,100)},${String(accountNumber).slice(0,100)},${String(accountHolder).slice(0,100)},${w.status},${date(w.requestedAt||w.requested_at)},${w.reviewedAt||w.reviewed_at?admin.id:null},${w.reviewedAt||w.reviewed_at?date(w.reviewedAt||w.reviewed_at):null},${String(w.adminNote||w.admin_note||'').slice(0,1000)}) ON CONFLICT (id) DO NOTHING RETURNING id`;
      if(result.length)counts.withdrawals++;
    }

    if(backup.settings?.bank){
      const rate=Math.min(0.5,Math.max(0.001,number(backup.settings.commissionRate,0.1)));
      const dueDay=Math.min(28,Math.max(1,Math.round(number(backup.settings.dueDay,5))));
      await sql`UPDATE platform_settings SET commission_rate=${rate},due_day=${dueDay},bank_name=${String(backup.settings.bank.bankName||'').slice(0,80)},account_number=${String(backup.settings.bank.accountNumber||'').slice(0,80)},account_holder=${String(backup.settings.bank.accountHolder||'').slice(0,100)},updated_at=now() WHERE id=1`;
    }

    for(const oldUser of rows(backup.users)){
      const dbUserId=userIds.get(oldUser.id);if(!dbUserId||oldUser.role==='admin')continue;
      const balance=Math.max(0,Math.round(number(oldUser.balance)));
      const photo=image(oldUser.photo),qris=image(oldUser.qrisPhoto);
      if(oldUser.photo&&!photo)counts.photosOmitted++;
      if(oldUser.qrisPhoto&&!qris)counts.photosOmitted++;
      await sql`UPDATE users SET name=COALESCE(NULLIF(${String(oldUser.name||'').slice(0,100)},''),name),phone=COALESCE(NULLIF(${String(oldUser.phone||'').slice(0,40)},''),phone),bank_name=COALESCE(NULLIF(${oldUser.bank?.bankName||''},''),bank_name),account_number=COALESCE(NULLIF(${oldUser.bank?.accountNumber||''},''),account_number),account_holder=COALESCE(NULLIF(${oldUser.bank?.accountHolder||''},''),account_holder),photo_url=COALESCE(photo_url,${photo}),qris_photo_url=COALESCE(qris_photo_url,${qris}),suspended=suspended OR ${Boolean(oldUser.suspended)},suspend_reason=CASE WHEN ${Boolean(oldUser.suspended)} THEN COALESCE(NULLIF(${String(oldUser.suspendReason||'').slice(0,500)},''),suspend_reason) ELSE suspend_reason END,balance=GREATEST(balance,${balance}) WHERE id=${dbUserId}`;
    }
    const retryRequired=counts.usersUnmatched>0;
    if(!retryRequired)await sql`INSERT INTO legacy_imports (source_hash,imported_by) VALUES (${sourceHash},${admin.id}) ON CONFLICT DO NOTHING`;
    return json(res,200,{ok:true,counts,retryRequired});
  }catch(error){return handleError(res,error);}
}
