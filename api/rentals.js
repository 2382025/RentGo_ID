import { randomBytes } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

const publicRental = (r) => ({
  id:r.id, motorId:r.motor_id, buyerId:r.buyer_id, sellerId:r.seller_id,
  startTime:r.start_time, durationHours:r.duration_hours, paymentMethod:r.payment_method,
  totalPrice:Number(r.total_price), status:r.status, paymentStatus:r.payment_status,
  paymentProofPhoto:r.payment_proof_url, paymentSubmittedAt:r.payment_submitted_at,
  paymentVerifiedAt:r.payment_verified_at, completedAt:r.completed_at,
  cancelledAt:r.cancelled_at, cancelReason:r.cancel_reason,
  commission:Number(r.commission), commissionPaid:r.commission_paid,
  commissionPending:r.commission_pending, commissionPaidAt:r.commission_paid_at,
  commissionPaymentId:r.commission_payment_id, createdAt:r.created_at
});

export default async function handler(req, res) {
  try {
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(req.method==='GET'){
      const rows=user.role==='admin'
        ? await sql`SELECT * FROM rentals ORDER BY created_at DESC`
        : await sql`SELECT * FROM rentals WHERE buyer_id=${user.id} OR seller_id=${user.id} ORDER BY created_at DESC`;
      return json(res,200,{rentals:rows.map(publicRental)});
    }
    if(req.method==='POST'){
      if(user.role!=='buyer')return json(res,403,{error:'Only buyers can create a booking.'});
      const {motorId,durationHours,paymentMethod='QRIS'}=req.body||{};
      const hours=Number(durationHours);
      if(typeof motorId!=='string'||!Number.isInteger(hours)||hours<1||hours>720)return json(res,400,{error:'A motor and valid rental duration are required.'});
      const [motor]=await sql`SELECT id,seller_id,price_per_hour,is_open FROM motors WHERE id=${motorId}`;
      if(!motor||!motor.is_open)return json(res,404,{error:'Motor is unavailable.'});
      const id=`r_${randomBytes(16).toString('hex')}`;
      const amount=hours*Number(motor.price_per_hour);
      const [rental]=await sql`INSERT INTO rentals (id,motor_id,buyer_id,seller_id,duration_hours,payment_method,total_price,status,payment_status) VALUES (${id},${motor.id},${user.id},${motor.seller_id},${hours},${String(paymentMethod).slice(0,30)},${amount},'pending_payment','unpaid') RETURNING *`;
      return json(res,201,{rental:publicRental(rental)});
    }
    if(req.method==='PATCH'){
      const {id,action,value}=req.body||{};
      if(typeof id!=='string'||typeof action!=='string')return json(res,400,{error:'Rental id and action are required.'});
      const [r]=await sql`SELECT * FROM rentals WHERE id=${id}`;
      if(!r)return json(res,404,{error:'Rental not found.'});
      let updated;
      if(action==='submitProof'&&user.role==='buyer'&&r.buyer_id===user.id&&r.status==='pending_payment'){
        if(typeof value!=='string'||value.length>1_000_000)return json(res,400,{error:'Payment proof is missing or too large (maximum 1 MB).'});
        [updated]=await sql`UPDATE rentals SET status='pending_verification',payment_status='pending',payment_proof_url=${value},payment_submitted_at=now() WHERE id=${id} RETURNING *`;
      }else if(action==='verifyPayment'&&user.role==='seller'&&r.seller_id===user.id&&r.status==='pending_verification'){
        [updated]=await sql`UPDATE rentals SET status='booked',payment_status='paid',payment_verified_at=now() WHERE id=${id} RETURNING *`;
      }else if(action==='rejectPayment'&&user.role==='seller'&&r.seller_id===user.id&&r.status==='pending_verification'){
        [updated]=await sql`UPDATE rentals SET status='pending_payment',payment_status='rejected',payment_proof_url=NULL,payment_submitted_at=NULL WHERE id=${id} RETURNING *`;
      }else if(action==='pickup'&&user.role==='seller'&&r.seller_id===user.id&&r.status==='booked'){
        [updated]=await sql`UPDATE rentals SET status='active',start_time=now() WHERE id=${id} RETURNING *`;
      }else if(action==='return'&&((user.role==='seller'&&r.seller_id===user.id)||(user.role==='buyer'&&r.buyer_id===user.id))&&r.status==='active'){
        const [settings]=await sql`SELECT commission_rate FROM platform_settings WHERE id=1`;
        const rate=settings?Number(settings.commission_rate):0.10;
        const commission=Math.round(Number(r.total_price)*rate);
        [updated]=await sql`UPDATE rentals SET status='completed',completed_at=now(),commission=${commission},commission_paid=false,commission_pending=false WHERE id=${id} AND status='active' RETURNING *`;
        if(!updated)return json(res,409,{error:'This rental has already been completed.'});
        if(updated)await sql`UPDATE users SET balance=balance+${Number(r.total_price)} WHERE id=${r.seller_id}`;
      }else if(action==='cancel'&&((user.role==='buyer'&&r.buyer_id===user.id)||user.role==='admin')&&['pending_payment','pending_verification','booked'].includes(r.status)){
        const reason=typeof value==='string'?value.slice(0,500):'';
        [updated]=await sql`UPDATE rentals SET status='cancelled',cancelled_at=now(),cancel_reason=${reason} WHERE id=${id} RETURNING *`;
      }else{
        return json(res,403,{error:'This account cannot perform that action on this rental.'});
      }
      return json(res,200,{rental:publicRental(updated)});
    }
    return methodNotAllowed(res,['GET','POST','PATCH']);
  }catch(error){return handleError(res,error);}
}
