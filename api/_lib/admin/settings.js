import { getDb, json, methodNotAllowed, handleError, currentUser } from '../db.js';

export default async function handler(req,res){
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(user.role!=='admin')return json(res,403,{error:'Admin access required.'});
    if(req.method==='GET'){
      const [s]=await sql`SELECT commission_rate AS "commissionRate",due_day AS "dueDay",bank_name AS "bankName",account_number AS "accountNumber",account_holder AS "accountHolder" FROM platform_settings WHERE id=1`;
      return json(res,200,{settings:s||null});
    }
    if(req.method==='PUT'){
      const b=req.body||{};
      const rate=Number(b.commissionRate),due=Number(b.dueDay);
      if(!Number.isFinite(rate)||rate<=0||rate>0.5||!Number.isInteger(due)||due<1||due>28||typeof b.bankName!=='string'||typeof b.accountNumber!=='string'||typeof b.accountHolder!=='string')return json(res,400,{error:'Commission, due day, and bank details are invalid.'});
      const [s]=await sql`INSERT INTO platform_settings (id,commission_rate,due_day,bank_name,account_number,account_holder,updated_at) VALUES (1,${rate},${due},${b.bankName.slice(0,80)},${b.accountNumber.slice(0,80)},${b.accountHolder.slice(0,100)},now()) ON CONFLICT (id) DO UPDATE SET commission_rate=EXCLUDED.commission_rate,due_day=EXCLUDED.due_day,bank_name=EXCLUDED.bank_name,account_number=EXCLUDED.account_number,account_holder=EXCLUDED.account_holder,updated_at=now() RETURNING commission_rate AS "commissionRate",due_day AS "dueDay",bank_name AS "bankName",account_number AS "accountNumber",account_holder AS "accountHolder"`;
      return json(res,200,{settings:s});
    }
    return methodNotAllowed(res,['GET','PUT']);
  }catch(error){return handleError(res,error);}
}
