import { randomBytes } from 'node:crypto';
import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req,res){
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(req.method==='GET'){
      if(user.role==='admin'){
        const rows=await sql`SELECT w.*,u.name AS seller_name FROM withdrawal_requests w JOIN users u ON u.id=w.seller_id ORDER BY requested_at DESC`;
        return json(res,200,{withdrawals:rows});
      }
      if(user.role!=='seller')return json(res,403,{error:'Seller or admin access required.'});
      const rows=await sql`SELECT * FROM withdrawal_requests WHERE seller_id=${user.id} ORDER BY requested_at DESC`;
      return json(res,200,{withdrawals:rows});
    }
    if(req.method==='POST'){
      if(user.role!=='seller')return json(res,403,{error:'Only sellers can request withdrawals.'});
      const amount=Number(req.body?.amount);
      if(!Number.isSafeInteger(amount)||amount<=0)return json(res,400,{error:'A positive withdrawal amount is required.'});
      const [seller]=await sql`SELECT balance,bank_name,account_number,account_holder FROM users WHERE id=${user.id}`;
      const [pending]=await sql`SELECT coalesce(sum(amount),0) AS amount FROM withdrawal_requests WHERE seller_id=${user.id} AND status='pending'`;
      if(!seller||amount>Number(seller.balance)-Number(pending.amount)||!seller.bank_name||!seller.account_number||!seller.account_holder)return json(res,409,{error:'Insufficient available balance or payout details are incomplete.'});
      const id=`wd_${randomBytes(16).toString('hex')}`;
      const [row]=await sql`INSERT INTO withdrawal_requests (id,seller_id,amount,bank_name,account_number,account_holder) VALUES (${id},${user.id},${amount},${seller.bank_name},${seller.account_number},${seller.account_holder}) RETURNING *`;
      return json(res,201,{withdrawal:row});
    }
    if(req.method==='PATCH'){
      if(user.role!=='admin')return json(res,403,{error:'Admin access required.'});
      const {id,status,note=''}=req.body||{};
      if(typeof id!=='string'||!['paid','rejected'].includes(status))return json(res,400,{error:'A valid request id and status are required.'});
      const [row]=await sql`SELECT * FROM withdrawal_requests WHERE id=${id} AND status='pending'`;
      if(!row)return json(res,404,{error:'Pending request not found.'});
      if(status==='paid'){
        const [seller]=await sql`UPDATE users SET balance=balance-${row.amount} WHERE id=${row.seller_id} AND balance>=${row.amount} RETURNING id`;
        if(!seller)return json(res,409,{error:'Seller balance changed; reload and review the request again.'});
      }
      await sql`UPDATE withdrawal_requests SET status=${status},reviewed_by=${user.id},reviewed_at=now(),admin_note=${String(note).slice(0,1000)} WHERE id=${id}`;
      return json(res,200,{ok:true});
    }
    return methodNotAllowed(res,['GET','POST','PATCH']);
  }catch(error){return handleError(res,error);}
}
