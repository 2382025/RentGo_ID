import { getDb, json, methodNotAllowed, handleError, currentUser } from './_lib/db.js';

export default async function handler(req,res){
  try{
    const sql=getDb();
    const user=await currentUser(req,sql);
    if(!user)return json(res,401,{error:'Sign in required.'});
    if(req.method==='GET'){
      if(user.role!=='admin')return json(res,403,{error:'Admin access required.'});
      const users=await sql`SELECT id,name,email,role,phone,balance,bank_name AS "bankName",account_number AS "accountNumber",account_holder AS "accountHolder",photo_url AS photo,qris_photo_url AS "qrisPhoto",suspended,suspend_reason AS "suspendReason",created_at AS "createdAt" FROM users ORDER BY created_at DESC`;
      return json(res,200,{users});
    }
    if(req.method==='PATCH'){
      if(user.role!=='admin')return json(res,403,{error:'Admin access required.'});
      const {id,suspended,suspendReason}=req.body||{};
      if(typeof id!=='string'||typeof suspended!=='boolean')return json(res,400,{error:'User id and suspension state are required.'});
      const [updated]=await sql`UPDATE users SET suspended=${suspended},suspend_reason=${suspended?String(suspendReason||'').slice(0,500):null} WHERE id=${id} AND role<>'admin' RETURNING id,suspended,suspend_reason AS "suspendReason"`;
      return updated?json(res,200,{user:updated}):json(res,404,{error:'User not found.'});
    }
    if(req.method==='POST'){
      if(user.role!=='admin')return json(res,403,{error:'Admin access required.'});
      const {id,password}=req.body||{};
      if(typeof id!=='string'||typeof password!=='string'||password.length<8||password.length>72)return json(res,400,{error:'User id and temporary password (8–72 characters) are required.'});
      const bcrypt=(await import('bcryptjs')).default;
      const hash=await bcrypt.hash(password,12);
      const [updated]=await sql`UPDATE users SET password_hash=${hash} WHERE id=${id} AND role<>'admin' RETURNING id,name`;
      return updated?json(res,200,{user:updated}):json(res,404,{error:'User not found.'});
    }
    return methodNotAllowed(res,['GET','PATCH','POST']);
  }catch(error){return handleError(res,error);}
}
