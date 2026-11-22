import { getDb, json, methodNotAllowed, handleError, currentUser } from '../db.js';

export default async function handler(req,res){
  if(req.method!=='POST')return methodNotAllowed(res,['POST']);
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(user.role!=='admin')return json(res,403,{error:'Admin access required.'});
    await sql`DELETE FROM commission_payment_rentals`;
    await sql`DELETE FROM commission_payments`;
    await sql`DELETE FROM reviews`;
    await sql`DELETE FROM chat_messages`;
    await sql`DELETE FROM notifications`;
    await sql`DELETE FROM withdrawal_requests`;
    await sql`DELETE FROM rentals`;
    await sql`DELETE FROM motors`;
    await sql`DELETE FROM audit_logs`;
    await sql`DELETE FROM legacy_imports`;
    await sql`DELETE FROM users WHERE role<>'admin'`;
    await sql`UPDATE platform_settings SET commission_rate=0.10,due_day=5,bank_name='',account_number='',account_holder='',updated_at=now() WHERE id=1`;
    return json(res,200,{ok:true});
  }catch(error){return handleError(res,error);}
}
