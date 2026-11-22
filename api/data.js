import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req,res){
  if(req.method!=='GET')return methodNotAllowed(res,['GET']);
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    const admin=user.role==='admin';
    const [users,motors,rentals,reviews,chats,notifications,commissions,audit,settings,withdrawals]=await Promise.all([
      sql`SELECT id,name,email,role,phone,balance,bank_name AS "bankName",account_number AS "accountNumber",account_holder AS "accountHolder",photo_url AS photo,qris_photo_url AS "qrisPhoto",suspended,suspend_reason AS "suspendReason" FROM users WHERE role<>'admin' OR ${admin} ORDER BY name`,
      admin?sql`SELECT id,seller_id AS "sellerId",brand,name,year,price_per_hour AS "pricePerHour",price_per_day AS "pricePerDay",location,location_detail AS "locationDetail",description,photo,helm_included AS "helmIncluded",helm_count AS "helmCount",is_open AS "isOpen",admin_blocked AS "adminBlocked",block_reason AS "blockReason",created_at AS "createdAt" FROM motors WHERE is_deleted=false ORDER BY created_at DESC`:sql`SELECT id,seller_id AS "sellerId",brand,name,year,price_per_hour AS "pricePerHour",price_per_day AS "pricePerDay",location,location_detail AS "locationDetail",description,photo,helm_included AS "helmIncluded",helm_count AS "helmCount",is_open AS "isOpen",admin_blocked AS "adminBlocked",block_reason AS "blockReason",created_at AS "createdAt" FROM motors WHERE is_deleted=false AND (is_open=true OR seller_id=${user.id}) ORDER BY created_at DESC`,
      admin?sql`SELECT * FROM rentals ORDER BY created_at DESC`:sql`SELECT * FROM rentals WHERE buyer_id=${user.id} OR seller_id=${user.id} ORDER BY created_at DESC`,
      sql`SELECT id,rental_id AS "rentalId",motor_id AS "motorId",buyer_id AS "buyerId",seller_id AS "sellerId",rating,comment,created_at AS "createdAt" FROM reviews ORDER BY created_at DESC`,
      admin?sql`SELECT id,rental_id AS "rentalId",sender_id AS "senderId",receiver_id AS "receiverId",message_text AS text,photo_url AS photo,is_read AS read,created_at AS "createdAt" FROM chat_messages ORDER BY created_at`:sql`SELECT id,rental_id AS "rentalId",sender_id AS "senderId",receiver_id AS "receiverId",message_text AS text,photo_url AS photo,is_read AS read,created_at AS "createdAt" FROM chat_messages WHERE sender_id=${user.id} OR receiver_id=${user.id} ORDER BY created_at`,
      sql`SELECT id,user_id AS "userId",notification_type AS type,title,message,rental_id AS "rentalId",link,is_read AS read,created_at AS "createdAt" FROM notifications WHERE user_id=${user.id} ORDER BY created_at DESC LIMIT 500`,
      admin?sql`SELECT cp.*,u.name AS seller_name FROM commission_payments cp JOIN users u ON u.id=cp.seller_id ORDER BY cp.submitted_at DESC`:user.role==='seller'?sql`SELECT cp.*,u.name AS seller_name FROM commission_payments cp JOIN users u ON u.id=cp.seller_id WHERE cp.seller_id=${user.id} ORDER BY cp.submitted_at DESC`:Promise.resolve([]),
      admin?sql`SELECT id,admin_id AS "adminId",admin_name AS "adminName",action,detail,created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC LIMIT 1000`:Promise.resolve([]),
      sql`SELECT commission_rate AS "commissionRate",due_day AS "dueDay",bank_name AS "bankName",account_number AS "accountNumber",account_holder AS "accountHolder" FROM platform_settings WHERE id=1`,
      admin?sql`SELECT w.*,u.name AS seller_name FROM withdrawal_requests w JOIN users u ON u.id=w.seller_id ORDER BY w.requested_at DESC`:user.role==='seller'?sql`SELECT * FROM withdrawal_requests WHERE seller_id=${user.id} ORDER BY requested_at DESC`:Promise.resolve([])
    ]);
    const payments=[];
    for(const cp of commissions){
      const ids=await sql`SELECT rental_id FROM commission_payment_rentals WHERE commission_payment_id=${cp.id}`;
      payments.push({id:cp.id,sellerId:cp.seller_id,sellerName:cp.seller_name,period:cp.period,rentalIds:ids.map(x=>x.rental_id),amount:Number(cp.amount),proofPhoto:cp.proof_photo_url,status:cp.status,submittedAt:cp.submitted_at,reviewedAt:cp.reviewed_at,reviewedBy:cp.reviewed_by,adminNote:cp.admin_note,manual:cp.manual});
    }
    const mappedRentals=rentals.map(r=>({id:r.id,motorId:r.motor_id,buyerId:r.buyer_id,sellerId:r.seller_id,startTime:r.start_time,durationHours:r.duration_hours,paymentMethod:r.payment_method,totalPrice:Number(r.total_price),status:r.status,paymentStatus:r.payment_status,paymentProofPhoto:r.payment_proof_url,paymentSubmittedAt:r.payment_submitted_at,paymentVerifiedAt:r.payment_verified_at,completedAt:r.completed_at,cancelledAt:r.cancelled_at,cancelReason:r.cancel_reason,commission:Number(r.commission),commissionPaid:r.commission_paid,commissionPending:r.commission_pending,commissionPaidAt:r.commission_paid_at,commissionPaymentId:r.commission_payment_id,createdAt:r.created_at}));
    const safeUsers=users.map(u=>u.id===user.id||admin?u:{id:u.id,name:u.name,role:u.role,phone:u.phone,qrisPhoto:u.qrisPhoto,suspended:u.suspended});
    const [settingsRow]=settings;
    return json(res,200,{users:safeUsers,motors,rentals:mappedRentals,reviews,chats,notifications,commissionPayments:payments,auditLogs:audit,settings:settingsRow?{commissionRate:Number(settingsRow.commissionRate),dueDay:settingsRow.dueDay,bank:{bankName:settingsRow.bankName,accountNumber:settingsRow.accountNumber,accountHolder:settingsRow.accountHolder}}:null,withdrawals});
  }catch(error){return handleError(res,error);}
}
